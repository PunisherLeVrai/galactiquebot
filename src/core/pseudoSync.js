// src/core/pseudoSync.js
// Sync 1 fois par heure (silencieux) — CommonJS

const { exportAllConfig, getGuildConfig } = require("./guildConfig");
const { getUserPseudos, setUserPseudo } = require("./pseudoStore");
const { log, warn } = require("./logger");

const ran = new Set();

function hourKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}`;
}

function normalize(v) {
  if (!v) return "";
  return String(v).replace(/[`]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

async function syncGuild(client, guildId) {
  const cfg = getGuildConfig(guildId) || {};
  const pseudoCfg = cfg.pseudo || {};

  if (!pseudoCfg.syncEnabled) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  // Option RAM: fetch complet activable
  const fetchMembers = pseudoCfg.syncFetchMembers !== false; // défaut true
  if (fetchMembers) {
    try {
      await guild.members.fetch();
    } catch (e) {
      warn(`[PSEUDO_SYNC] fetch failed guild=${guildId}`, e);
      return;
    }
  }

  const playerRoleId = cfg.playerRoleId || null;
  let processed = 0;

  for (const m of guild.members.cache.values()) {
    // Si tu veux limiter aux joueurs uniquement : active playerRoleId
    if (playerRoleId && !m.roles.cache.has(playerRoleId)) continue;

    const entry = getUserPseudos(guildId, m.user.id);

    // Normalise sans changer la plateforme (PSN/XBOX/EA restent prioritaires)
    if (entry?.psn) setUserPseudo(guildId, m.user.id, "psn", normalize(entry.psn));
    if (entry?.xbox) setUserPseudo(guildId, m.user.id, "xbox", normalize(entry.xbox));
    if (entry?.ea) setUserPseudo(guildId, m.user.id, "ea", normalize(entry.ea));

    processed++;
    if (processed % 500 === 0) await new Promise((r) => setTimeout(r, 50));
  }

  log(`[PSEUDO_SYNC] guild=${guildId} processed=${processed}`);
}

async function tick(client) {
  const now = new Date();
  const key = hourKey(now);
  if (ran.has(key)) return;
  ran.add(key);

  const all = exportAllConfig();
  const guildIds = Object.keys(all.guilds || {});
  for (const guildId of guildIds) {
    try {
      await syncGuild(client, guildId);
    } catch (e) {
      warn(`[PSEUDO_SYNC] guild=${guildId} error`, e);
    }
  }
}

function startPseudoSync(client) {
  setInterval(() => {
    tick(client).catch(() => {});
  }, 60 * 1000);

  log("[PSEUDO_SYNC] started (hourly)");
}

module.exports = { startPseudoSync };
