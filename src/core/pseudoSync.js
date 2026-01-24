// src/core/pseudoSync.js
// Sync PSEUDO 1 fois par heure (silencieux) — CommonJS
// ✅ Priorité: PSN > XBOX > EA > Username
// ✅ Nick forcé: PSEUDO | RÔLE | POSTE1/POSTE2/POSTE3 (jamais vide)
// ✅ Pas de hiérarchie: on overwrite (si permissions OK)
// ✅ RAM-friendly: fetch members activable + yield
// Dépendances:
// - guildConfig: exportAllConfig/getGuildConfig
// - pseudoStore: getUserPseudos/setUserPseudo
// - cfg.mainRoles + cfg.posts (déjà dans guildConfig)
// - cfg.pseudo.syncEnabled / syncFetchMembers
// - cfg.playerRoleId (utilisé seulement si tu veux limiter — ici: NON, tout le monde)

const { exportAllConfig, getGuildConfig } = require("./guildConfig");
const { getUserPseudos, setUserPseudo } = require("./pseudoStore");
const { log, warn } = require("./logger");

const ran = new Set(); // hourKey

function hourKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}`;
}

function normalizeValue(v, max = 40) {
  if (!v) return "";
  return String(v)
    .replace(/[`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeUsername(username) {
  const raw = String(username || "");

  // retire accents
  const noAccents = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

  // supprime chiffres + caractères spéciaux (garde lettres + espaces)
  const lettersOnly = noAccents
    .replace(/[^a-zA-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!lettersOnly) return "User";

  // majuscule au début (le reste en minuscules)
  return lettersOnly.charAt(0).toUpperCase() + lettersOnly.slice(1).toLowerCase();
}

function pickPriorityPseudo(entry, fallbackUsername) {
  const psn = normalizeValue(entry?.psn, 40);
  const xbox = normalizeValue(entry?.xbox, 40);
  const ea = normalizeValue(entry?.ea, 40);

  if (psn) return psn;
  if (xbox) return xbox;
  if (ea) return ea;

  return normalizeUsername(fallbackUsername);
}

function pickRoleLabel(member, cfg) {
  const map = cfg?.mainRoles || {};
  const order = [
    { key: "president", label: "Président" },
    { key: "fondateur", label: "Fondateur" },
    { key: "gm", label: "GM" },
    { key: "cogm", label: "coGM" },
    { key: "staff", label: "Staff" },
  ];

  for (const it of order) {
    const id = map?.[it.key]?.id;
    if (id && member.roles.cache.has(id)) return it.label;
  }

  return "Membre";
}

function pickPostsLabel(member, cfg) {
  const posts = Array.isArray(cfg?.posts) ? cfg.posts : [];
  const found = [];

  for (const p of posts) {
    const roleId = p?.id;
    if (!roleId) continue;

    if (member.roles.cache.has(roleId)) {
      const label = String(p.label || "").trim() || "Poste";
      found.push(label);
      if (found.length >= 3) break;
    }
  }

  return found.length ? found.join("/") : "—";
}

function buildNick(pseudo, roleLabel, postsLabel) {
  const p = String(pseudo || "").trim() || "User";
  const r = String(roleLabel || "").trim() || "Membre";
  const po = String(postsLabel || "").trim() || "—";
  return `${p} | ${r} | ${po}`;
}

async function syncGuild(client, guildId) {
  const cfg = getGuildConfig(guildId) || {};
  const pseudoCfg = cfg.pseudo || {};

  if (!pseudoCfg.syncEnabled) return;

  const guild =
    client.guilds.cache.get(guildId) ||
    (await client.guilds.fetch(guildId).catch(() => null));

  if (!guild) return;

  // Option RAM: fetch complet activable (défaut true)
  const fetchMembers = pseudoCfg.syncFetchMembers !== false;
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
    if (!member || member.user?.bot) continue;

    const entry = getUserPseudos(guildId, member.user.id);

    // Normalise sans changer la plateforme (PSN/XBOX/EA restent prioritaires)
    if (entry?.psn) setUserPseudo(guildId, member.user.id, "psn", normalizeValue(entry.psn, 40));
    if (entry?.xbox) setUserPseudo(guildId, member.user.id, "xbox", normalizeValue(entry.xbox, 40));
    if (entry?.ea) setUserPseudo(guildId, member.user.id, "ea", normalizeValue(entry.ea, 40));

    const pseudo = pickPriorityPseudo(entry, member.user.username);
    const roleLabel = pickRoleLabel(member, cfg);
    const postsLabel = pickPostsLabel(member, cfg);
    const targetNick = buildNick(pseudo, roleLabel, postsLabel);

    const currentNick = member.nickname || null;
    if (currentNick !== targetNick) {
      // force le changement (si permissions OK)
      try {
        await member.setNickname(targetNick, "PSEUDO_SYNC");
        changed++;
      } catch {
        // pas de permissions / hiérarchie -> on ignore
      }
    }

    processed++;
    if (processed % 500 === 0) await new Promise((r) => setTimeout(r, 50));
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
  setInterval(() => {
    tick(client).catch(() => {});
  }, 60 * 1000);

  log("[PSEUDO_SYNC] started (hourly)");
}

module.exports = { startPseudoSync };
