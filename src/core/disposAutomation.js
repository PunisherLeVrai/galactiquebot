// src/core/disposAutomation.js
const { exportAll } = require("./configManager");
const { getGuildConfig } = require("./guildConfig");
const { getLastOpenSession, closeSession } = require("./disposWeekStore");
const { buildStaffReportEmbed } = require("./disposWeekRenderer");

const { warn, log } = require("./logger");

// Anti-double envoi par jour/heure
const lastRun = new Map(); // key: guildId:YYYY-MM-DD:hour:type -> true

function keyRun(guildId, dateKey, hour, type) {
  return `${guildId}:${dateKey}:${hour}:${type}`;
}

function getDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function computeNonRespondingPlayers(guild, cfg, session, dayKey) {
  if (!cfg.playerRoleId) return [];

  const dayVotes = session.votes?.[dayKey] || { present: [], absent: [] };
  const responded = new Set([...(dayVotes.present || []), ...(dayVotes.absent || [])]);

  // Récupère membres si nécessaire
  try {
    await guild.members.fetch();
  } catch {}

  const players = guild.members.cache.filter((m) => m.roles.cache.has(cfg.playerRoleId));
  const non = [];
  for (const m of players.values()) {
    if (!responded.has(m.user.id)) non.push(m);
  }
  return non;
}

async function sendDMReminders(nonRespondingMembers, dayLabel) {
  for (const m of nonRespondingMembers) {
    try {
      await m.send(`Rappel disponibilité : tu n’as pas répondu pour **${dayLabel}**. Merci d’indiquer Présent/Absent sur le message dispo.`);
    } catch {
      // DM fermés => ignorer
    }
  }
}

async function runOnce(client) {
  const now = new Date();
  const hour = now.getHours();
  const dateKey = getDateKey(now);

  const all = exportAll(); // servers.json
  const guildIds = Object.keys(all.guilds || {});

  for (const guildId of guildIds) {
    const cfg = getGuildConfig(guildId);
    if (!cfg?.automationsEnabled) continue;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    const session = getLastOpenSession(guildId);
    if (!session) continue;

    // Pour chaque jour de la session : tu peux choisir de n'automatiser que "aujourd'hui".
    // Ici on automatisera TOUS les jours créés (simple et robuste).
    for (const day of session.days) {
      // 1) Rappel 12h
      if ((cfg.automationReminderHours || []).includes(hour)) {
        const k = keyRun(guildId, dateKey, hour, `remind:${day.key}`);
        if (!lastRun.has(k)) {
          lastRun.set(k, true);
          try {
            const non = await computeNonRespondingPlayers(guild, cfg, session, day.key);
            await sendDMReminders(non, day.label);
            log(`[AUTO] remind sent ${guildId} ${day.key} (${non.length} players)`);
          } catch (e) {
            warn("[AUTO] remind error:", e);
          }
        }
      }

      // 2) Rapport 12h/17h -> salon staff reportChannelId requis
      if ((cfg.automationReportHours || []).includes(hour)) {
        const k = keyRun(guildId, dateKey, hour, `report:${day.key}`);
        if (!lastRun.has(k)) {
          lastRun.set(k, true);
          try {
            if (!cfg.reportChannelId) {
              warn(`[AUTO] report skipped: reportChannelId missing for guild ${guildId}`);
            } else {
              const channel = await client.channels.fetch(cfg.reportChannelId).catch(() => null);
              if (channel) {
                const nonMembers = await computeNonRespondingPlayers(guild, cfg, session, day.key);
                const nonMentions = nonMembers.map((m) => `<@${m.user.id}>`);

                const embed = buildStaffReportEmbed({
                  guildName: guild.name,
                  session,
                  day,
                  playersNonRespondingMentions: nonMentions,
                });

                await channel.send({ embeds: [embed] });
              }
            }
            log(`[AUTO] report sent ${guildId} ${day.key}`);
          } catch (e) {
            warn("[AUTO] report error:", e);
          }
        }
      }

      // 3) Fermeture 17h
      if ((cfg.automationCloseHours || []).includes(hour)) {
        const k = keyRun(guildId, dateKey, hour, `close:${day.key}`);
        if (!lastRun.has(k)) {
          lastRun.set(k, true);
          try {
            // ferme la session (une seule fois suffit)
            closeSession(guildId, session.sessionId, "automation");
            log(`[AUTO] session closed ${guildId} ${session.sessionId}`);
          } catch (e) {
            warn("[AUTO] close error:", e);
          }
        }
      }
    }
  }
}

function startAutomations(client) {
  // check toutes les 60 secondes
  setInterval(() => {
    runOnce(client).catch(() => {});
  }, 60 * 1000);

  log("[AUTO] automations loop started");
}

module.exports = { startAutomations };
