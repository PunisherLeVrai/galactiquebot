// src/core/disposAutomation.js
// Automations Dispos: rappel/rapport/fermeture aux heures configurées
// CommonJS — discord.js v14

const { exportAll } = require("./configManager");
const { getGuildConfig } = require("./guildConfig");
const { getLastOpenSession, closeSession, getSession } = require("./disposWeekStore");
const { buildStaffReportEmbed } = require("./disposWeekRenderer");
const { buildRows } = require("./disposWeekButtons");
const { buildDayEmbed } = require("./disposWeekRenderer");

const { log, warn } = require("./logger");

const FLAGS_EPHEMERAL = 64;

// anti double-run
const ran = new Set(); // key = guildId|date|hour|type|sessionId|dayKey

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function makeRunKey({ guildId, dateK, hour, type, sessionId, dayKey }) {
  return `${guildId}|${dateK}|${hour}|${type}|${sessionId}|${dayKey || "-"}`;
}

async function fetchTextChannel(client, channelId) {
  if (!channelId) return null;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) return null;
  if (typeof ch.send !== "function") return null;
  return ch;
}

async function safeFetchMessage(channel, messageId) {
  if (!channel || !messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function computeNonRespondingPlayers(guild, cfg, session, dayKey) {
  if (!cfg.playerRoleId) return [];

  const dayVotes = session.votes?.[dayKey] || { present: [], absent: [] };
  const responded = new Set([...(dayVotes.present || []), ...(dayVotes.absent || [])]);

  try {
    await guild.members.fetch();
  } catch {}

  const players = guild.members.cache.filter((m) => m.roles.cache.has(cfg.playerRoleId));
  const nonIds = [];
  for (const m of players.values()) {
    if (!responded.has(m.user.id)) nonIds.push(m.user.id);
  }
  return nonIds;
}

async function refreshAllMessages(client, guild, cfg, session) {
  const channel = await fetchTextChannel(client, session.channelId);
  if (!channel) return;

  for (const day of session.days || []) {
    if (!day.messageId) continue;

    const msg = await safeFetchMessage(channel, day.messageId);
    if (!msg) continue;

    const embed = buildDayEmbed({
      guildName: guild.name,
      session,
      day,
      brandTitle: "Disponibilités",
    });

    const rows = buildRows({
      sessionId: session.sessionId,
      dayKey: day.key,
      closed: session.closed,
      automationsEnabled: cfg.automationsEnabled,
    });

    await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
  }
}

async function sendReminderInDispos(client, guild, cfg, session, day) {
  const disposChannel = await fetchTextChannel(client, cfg.disposChannelId || session.channelId);
  if (!disposChannel) return;

  const nonIds = await computeNonRespondingPlayers(guild, cfg, session, day.key);
  const mentions = nonIds.map((id) => `<@${id}>`);

  const content =
    `🔔 **Rappel disponibilités — ${day.label}**\n` +
    (mentions.length ? mentions.join(" ") : "Aucun non répondant (rôle Joueur).");

  await disposChannel.send({ content }).catch(() => {});
}

async function sendReportInStaffChannel(client, guild, cfg, session, day) {
  const reportChannel = await fetchTextChannel(client, cfg.reportChannelId);
  if (!reportChannel) return;

  const dayVotes = session.votes?.[day.key] || { present: [], absent: [] };
  const presentIds = dayVotes.present || [];
  const absentIds = dayVotes.absent || [];
  const nonIds = await computeNonRespondingPlayers(guild, cfg, session, day.key);

  const embed = buildStaffReportEmbed({
    guildName: guild.name,
    session,
    day,
    presentIds,
    absentIds,
    nonRespondingPlayerIds: nonIds,
  });

  await reportChannel.send({ embeds: [embed] }).catch(() => {});
}

/**
 * Exécute automations une fois (appelé toutes les 60s)
 */
async function tick(client) {
  const now = new Date();
  const hour = now.getHours();
  const dKey = dateKey(now);

  const all = exportAll();
  const guildIds = Object.keys(all.guilds || {});

  for (const guildId of guildIds) {
    const cfg = getGuildConfig(guildId);
    if (!cfg || !cfg.automationsEnabled) continue;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    const session = getLastOpenSession(guildId);
    if (!session) continue;

    // RAPPEL 12h
    if ((cfg.automationReminderHours || []).includes(hour)) {
      for (const day of session.days || []) {
        const k = makeRunKey({
          guildId,
          dateK: dKey,
          hour,
          type: "remind",
          sessionId: session.sessionId,
          dayKey: day.key,
        });
        if (ran.has(k)) continue;
        ran.add(k);

        try {
          await sendReminderInDispos(client, guild, cfg, session, day);
          log(`[AUTO] remind ${guildId} ${session.sessionId} ${day.key} @${hour}h`);
        } catch (e) {
          warn("[AUTO] remind error:", e);
        }
      }
    }

    // RAPPORT 12h/17h
    if ((cfg.automationReportHours || []).includes(hour)) {
      for (const day of session.days || []) {
        const k = makeRunKey({
          guildId,
          dateK: dKey,
          hour,
          type: "report",
          sessionId: session.sessionId,
          dayKey: day.key,
        });
        if (ran.has(k)) continue;
        ran.add(k);

        try {
          // si pas de reportChannelId => on ne peut pas faire "staff-only"
          if (!cfg.reportChannelId) {
            warn(`[AUTO] report skipped (reportChannelId missing) guild=${guildId}`);
          } else {
            await sendReportInStaffChannel(client, guild, cfg, session, day);
            log(`[AUTO] report ${guildId} ${session.sessionId} ${day.key} @${hour}h`);
          }
        } catch (e) {
          warn("[AUTO] report error:", e);
        }
      }
    }

    // FERMETURE 17h
    if ((cfg.automationCloseHours || []).includes(hour)) {
      const k = makeRunKey({
        guildId,
        dateK: dKey,
        hour,
        type: "close",
        sessionId: session.sessionId,
        dayKey: "ALL",
      });
      if (!ran.has(k)) {
        ran.add(k);
        try {
          closeSession(guildId, session.sessionId, "automation");

          // refresh composants pour désactiver les votes + mettre status "fermé"
          const fresh = getSession(guildId, session.sessionId);
          await refreshAllMessages(client, guild, cfg, fresh);

          log(`[AUTO] close ${guildId} ${session.sessionId} @${hour}h`);
        } catch (e) {
          warn("[AUTO] close error:", e);
        }
      }
    }
  }
}

function startAutomations(client) {
  // Loop légère (RAM friendly) : un tick par minute
  setInterval(() => {
    tick(client).catch(() => {});
  }, 60 * 1000);

  log("[AUTO] automations started (every 60s)");
}

module.exports = {
  startAutomations,
};
