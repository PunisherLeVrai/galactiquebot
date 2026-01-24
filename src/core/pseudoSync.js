// src/core/pseudoSync.js
// Sync 1 fois par heure (silencieux) — renomme les membres avec le format memberDisplay
// CommonJS

const { exportAllConfig, getGuildConfig } = require("./guildConfig");
const { buildMemberLine } = require("./memberDisplay");
const { log, warn } = require("./logger");

const ran = new Set();

function hourKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}`;
}

// limite Discord nickname: 32 chars
function clampNick(nick) {
  const s = String(nick || "").trim();
  if (!s) return null;
  return s.length > 32 ? s.slice(0, 32) : s;
}

function shouldTargetMember(member, cfg) {
  if (!member || member.user?.bot) return false;

  // On cible en priorité les gens "du roster" (player/trial/staff),
  // et aussi ceux qui ont un mainRole ou un poste configuré.
  const staffRoleId = cfg.staffRoleId || null;
  const playerRoleId = cfg.playerRoleId || null;
  const trialRoleId = cfg.trialRoleId || null;

  if (staffRoleId && member.roles.cache.has(staffRoleId)) return true;
  if (playerRoleId && member.roles.cache.has(playerRoleId)) return true;
  if (trialRoleId && member.roles.cache.has(trialRoleId)) return true;

  // mainRoles
  const mr = cfg.mainRoles || {};
  for (const key of ["president", "fondateur", "gm", "cogm", "staff"]) {
    const id = mr?.[key]?.id || null;
    if (id && member.roles.cache.has(id)) return true;
  }

  // posts
  const posts = Array.isArray(cfg.posts) ? cfg.posts : [];
  for (const p of posts) {
    if (p?.id && member.roles.cache.has(p.id)) return true;
  }

  // sinon on skip (évite de renommer tout le serveur)
  return false;
}

async function syncGuild(client, guildId) {
  const cfg = getGuildConfig(guildId) || {};
  const pseudoCfg = cfg.pseudo || {};

  // ON/OFF
  if (pseudoCfg.syncEnabled === false) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  // fetch membres (recommandé)
  const fetchMembers = pseudoCfg.syncFetchMembers !== false; // défaut true
  if (fetchMembers) {
    try {
      await guild.members.fetch();
    } catch (e) {
      warn(`[PSEUDO_SYNC] fetch failed guild=${guildId}`, e);
      return;
    }
  }

  let processed = 0;
  let changed = 0;

  for (const member of guild.members.cache.values()) {
    if (!shouldTargetMember(member, cfg)) continue;

    const targetNick = clampNick(buildMemberLine(member, cfg));
    if (!targetNick) continue;

    // nickname actuel (ou username fallback)
    const current = (member.nickname || "").trim();

    if (current === targetNick) {
      processed++;
      continue;
    }

    try {
      // NOTE: Discord refuse si le bot n'a pas permission / rôle au-dessus.
      await member.setNickname(targetNick, "Pseudo sync (hourly)");
      changed++;
    } catch (e) {
      // silencieux mais loggable
      warn(
        `[PSEUDO_SYNC] setNickname failed guild=${guildId} user=${member.user.id} (${member.user.tag})`,
        e?.message || e
      );
    }

    processed++;
    if (processed % 250 === 0) await new Promise((r) => setTimeout(r, 150));
  }

  log(`[PSEUDO_SYNC] guild=${guildId} processed=${processed} changed=${changed}`);
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
  // check toutes les minutes, mais exécute 1 fois/heure via hourKey()
  setInterval(() => {
    tick(client).catch(() => {});
  }, 60 * 1000);

  log("[PSEUDO_SYNC] started (hourly)");
}

module.exports = { startPseudoSync };
