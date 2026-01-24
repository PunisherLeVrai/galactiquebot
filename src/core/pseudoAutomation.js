// src/core/pseudoAutomation.js
// 3 rappels / 24h (sans mention) — CommonJS

const { exportAllConfig, getGuildConfig } = require("./guildConfig");
const { log, warn } = require("./logger");

const ran = new Set();

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function runKey(guildId, dKey, hour) {
  return `${guildId}|${dKey}|${hour}|pseudoReminder`;
}

async function fetchTextChannel(client, channelId) {
  if (!channelId) return null;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || typeof ch.send !== "function") return null;
  return ch;
}

function content() {
  return (
    `🎮 **SCAN PSEUDOS (PSN OU XBOX OU EA)**\n\n` +
    `Envoie **UNE SEULE** des 3 formes :\n\n` +
    `• \`PSN: TonPseudo\`\n` +
    `**OU**\n` +
    `• \`XBOX: TonGamertag\`\n` +
    `**OU**\n` +
    `• \`EA: TonEAID\`\n\n` +
    `Le bot détecte automatiquement et enregistre.`
  );
}

async function tick(client) {
  const now = new Date();
  const hour = now.getHours();
  const dK = dateKey(now);

  const all = exportAllConfig();
  const guildIds = Object.keys(all.guilds || {});

  for (const guildId of guildIds) {
    const cfg = getGuildConfig(guildId) || {};
    const pseudoCfg = cfg.pseudo || {};

    if (!pseudoCfg.reminderEnabled) continue;

    const scanChannelId = pseudoCfg.scanChannelId || null;
    if (!scanChannelId) continue;

    const hours = Array.isArray(pseudoCfg.reminderHours) && pseudoCfg.reminderHours.length
      ? pseudoCfg.reminderHours
      : [12, 17, 21];

    if (!hours.includes(hour)) continue;

    const key = runKey(guildId, dK, hour);
    if (ran.has(key)) continue;
    ran.add(key);

    const ch = await fetchTextChannel(client, scanChannelId);
    if (!ch) continue;

    try {
      await ch.send({ content: content() }); // ✅ sans mention
      log(`[PSEUDO_REMINDER] guild=${guildId} @${hour}h`);
    } catch (e) {
      warn("[PSEUDO_REMINDER] error:", e);
    }
  }
}

function startPseudoReminders(client) {
  setInterval(() => {
    tick(client).catch(() => {});
  }, 60 * 1000);

  log("[PSEUDO_REMINDER] started (3/day)");
}

module.exports = { startPseudoReminders };
