// src/core/pseudoAutomation.js
// 3 rappels / 24h (sans mention) — CommonJS
// ✅ Anti-doublon par jour/heure/guild
// ✅ Heures configurables (reminderHours)
// ✅ Salon configurable (pseudo.scanChannelId)
// ✅ Nettoyage Set (évite grossir sur le long terme)
// ✅ Message clair + "où entre chaque plateforme"

// NOTE: La sync 1x/heure est gérée par pseudoSync.js (startPseudoSync).
// Ici: uniquement les rappels (optionnels).

const { exportAllConfig, getGuildConfig } = require("./guildConfig");
const { log, warn } = require("./logger");

const ran = new Set();
let lastCleanupDay = null;

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

function buildContent() {
  return (
    `🎮 **SYNC PSEUDOS (PRIORITÉ : PSN > XBOX > EA)**\n\n` +
    `Envoie **UNE SEULE** ligne (au choix) :\n\n` +
    `• \`PSN: TonPseudo\`\n` +
    `• \`XBOX: TonGamertag\`\n` +
    `• \`EA: TonEAID\`\n\n` +
    `⚠️ Mets bien **les deux-points** après la plateforme.\n` +
    `✅ Le bot enregistre et la sync se fait automatiquement.`
  );
}

// évite que le Set grossisse sur plusieurs jours
function cleanupIfNewDay(now) {
  const dk = dateKey(now);
  if (lastCleanupDay === dk) return;
  lastCleanupDay = dk;
  ran.clear();
}

async function tick(client) {
  const now = new Date();
  cleanupIfNewDay(now);

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

    const hours =
      Array.isArray(pseudoCfg.reminderHours) && pseudoCfg.reminderHours.length
        ? pseudoCfg.reminderHours
        : [12, 17, 21];

    if (!hours.includes(hour)) continue;

    const key = runKey(guildId, dK, hour);
    if (ran.has(key)) continue;
    ran.add(key);

    const ch = await fetchTextChannel(client, scanChannelId);
    if (!ch) continue;

    try {
      await ch.send({ content: buildContent() }); // ✅ sans mention
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
