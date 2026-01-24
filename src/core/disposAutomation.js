// src/core/disposAutomation.js
// Automations Dispo: rappel / rapport / fermeture selon config serveur — CommonJS

const { exportAllConfig, getGuildConfig } = require("./guildConfig");
const { getLastOpenSession, getSession, closeSession } = require("./disposWeekStore");
const { buildStaffReportEmbed } = require("./disposWeekRenderer");
const { buildRows } = require("./disposWeekButtons");
const { buildDayEmbed } = require("./disposWeekRenderer");
const { log, warn } = require("./logger");

const ran = new Set(); // anti double-run

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
  if (!ch || typeof ch.send !== "function") return null;
  return ch;
}

async function safeFetchMessage(channel, messageId) {
  if (!channel || !messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function computeNonRespondingPlayers(guild, cfg, session, dayKey) {
  if (!cfg?.playerRoleId) return [];

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

    const embed = buildDayEmbed({ guildName: guild.name, session, day });
    const rows = buildRows({
      sessionId: session.sessionId,
      dayKey: day.key,
      closed: session.closed,
      automationsEnabled: !!cfg?.automations?.enabled,
    });

    await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
  }
}

async function sendReminder(client, guild, cfg, session, day) {
  const channel = await fetchTextChannel(client, cfg.disposChannelId || session.channelId);
  if (!channel) return;

  const nonIds = await computeNonRespondingPlayers(guild, cfg, session, day.key);
  const mentions = nonIds.map((id) => `<@${id}>`);

  const content =
    `🔔 **Rappel disponibilités — ${day.label}**\n` +
    (mentions.length ? mentions.join(" ") : "Aucun non répondant (rôle Joueur).");

  await channel.send({ content }).catch(() => {});
}

async function sendReport(client, guild, cfg, session, day) {
  const staffChannel = await fetchTextChannel(client, cfg.staffReportsChannelId);
  if (!staffChannel) return;

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

  await staffChannel.send({ embeds: [embed] }).catch(() => {});
}

async function tick(client) {
  const now = new Date();
  const hour = now.getHours();
  const dKey = dateKey(now);

  const all = exportAllConfig();
  const guildIds = Object.keys(all.guilds || {});

  for (const guildId of guildIds) {
    const cfg = getGuildConfig(guildId);
    if (!cfg?.automations?.enabled) continue;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    const session = getLastOpenSession(guildId);
    if (!session) continue;

    const reminderHour = cfg.automations.reminderHour ?? 12;
    const reportHours = Array.isArray(cfg.automations.reportHours) ? cfg.automations.reportHours : [12, 17];
    const closeHour = cfg.automations.closeHour ?? 17;

    // Rappel
    if (hour === reminderHour) {
      for (const day of session.days || []) {
        const k = makeRunKey({ guildId, dateK: dKey, hour, type: "remind", sessionId: session.sessionId, dayKey: day.key });
        if (ran.has(k)) continue;
        ran.add(k);
        try {
          await sendReminder(client, guild, cfg, session, day);
          log(`[AUTO] remind guild=${guildId} session=${session.sessionId} day=${day.key} @${hour}h`);
        } catch (e) {
          warn("[AUTO] remind error:", e);
        }
      }
    }

    // Rapport
    if (reportHours.includes(hour)) {
      for (const day of session.days || []) {
        const k = makeRunKey({ guildId, dateK: dKey, hour, type: "report", sessionId: session.sessionId, dayKey: day.key });
        if (ran.has(k)) continue;
        ran.add(k);
        try {
          await sendReport(client, guild, cfg, session, day);
          log(`[AUTO] report guild=${guildId} session=${session.sessionId} day=${day.key} @${hour}h`);
        } catch (e) {
          warn("[AUTO] report error:", e);
        }
      }
    }

    // Fermeture
    if (hour === closeHour) {
      const k = makeRunKey({ guildId, dateK: dKey, hour, type: "close", sessionId: session.sessionId, dayKey: "ALL" });
      if (!ran.has(k)) {
        ran.add(k);
        try {
          closeSession(guildId, session.sessionId, "automation");
          const fresh = getSession(guildId, session.sessionId);
          await refreshAllMessages(client, guild, cfg, fresh);
          log(`[AUTO] close guild=${guildId} session=${session.sessionId} @${hour}h`);
        } catch (e) {
          warn("[AUTO] close error:", e);
        }
      }
    }
  }
}

function startAutomations(client) {
  setInterval(() => {
    tick(client).catch(() => {});
  }, 60 * 1000);

  log("[AUTO] Dispo automations started (every 60s)");
}

module.exports = { startAutomations };
