// src/core/guildConfig.js
// Config multi-serveur minimal (servers.json) — CommonJS
// ✅ staffRoleIds (multi) + playerRoleIds (multi)
// ✅ postRoleIds (multi 0..25) : utilisés par /pseudo (SANS label)
// ✅ compat anciennes clés (staffRoleId, playerRoleId) + ancien format posts [{roleId,label}]
// ✅ utilitaires export/import/reset

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "servers.json");

const DEFAULT_DATA = { version: 1, guilds: {} };

const DEFAULT_GUILD = {
  botLabel: "XIG BLAUGRANA FC Staff",

  // salons
  disposChannelId: null,
  staffReportsChannelId: null,
  pseudoScanChannelId: null,

  // rôles staff (1..n) : droits commandes + /pseudo
  staffRoleIds: [],

  // rôles joueurs (1..n) : filtre + /pseudo
  playerRoleIds: [],

  // ✅ postes (0..25) : utilisés par /pseudo (sans label)
  postRoleIds: [],

  // compat legacy : [{ roleId, label }]
  posts: [],

  // auto minimal
  automations: { enabled: false },

  setupBy: null,
  setupAt: null,
  updatedAt: null,
};

function ensureFile() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
  }
}

function safeReadJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readAll() {
  ensureFile();

  const data = safeReadJson(CONFIG_PATH, { ...DEFAULT_DATA });

  if (!data || typeof data !== "object") return { ...DEFAULT_DATA };
  if (!data.guilds || typeof data.guilds !== "object") data.guilds = {};
  if (!data.version) data.version = 1;

  return data;
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
}

function uniqIds(arr, { max = null } = {}) {
  const out = [];
  const seen = new Set();

  for (const v of Array.isArray(arr) ? arr : []) {
    const id = String(v || "").trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (typeof max === "number" && out.length >= max) break;
  }

  return out;
}

// legacy posts -> ids
function extractPostRoleIdsFromLegacyPosts(posts) {
  if (!Array.isArray(posts)) return [];
  return uniqIds(
    posts
      .filter((p) => p && typeof p === "object" && p.roleId)
      .map((p) => p.roleId),
    { max: 25 }
  );
}

// ids -> legacy posts (label neutre, pour compat)
function buildLegacyPostsFromIds(postRoleIds) {
  const ids = uniqIds(postRoleIds, { max: 25 });
  return ids.map((roleId) => ({ roleId: String(roleId), label: "POSTE" }));
}

function normalizeGuild(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};

  // base
  const out = {
    ...DEFAULT_GUILD,
    ...c,
    automations: { ...DEFAULT_GUILD.automations, ...(c.automations || {}) },
  };

  // roles arrays
  out.staffRoleIds = uniqIds(out.staffRoleIds);
  out.playerRoleIds = uniqIds(out.playerRoleIds);

  // ----- compat anciennes clés -----
  if (!out.staffRoleIds.length && c.staffRoleId) out.staffRoleIds = uniqIds([c.staffRoleId]);
  if (!out.playerRoleIds.length && c.playerRoleId) out.playerRoleIds = uniqIds([c.playerRoleId]);

  // ----- postes : source de vérité = postRoleIds -----
  // 1) si postRoleIds existe -> on l'utilise
  // 2) sinon, on convertit depuis l'ancien posts[]
  const fromPostRoleIds = Array.isArray(c.postRoleIds) ? c.postRoleIds : null;
  const fromLegacyPosts = extractPostRoleIdsFromLegacyPosts(c.posts);

  out.postRoleIds = uniqIds(fromPostRoleIds ?? fromLegacyPosts, { max: 25 });

  // legacy posts reconstruit (compat), même si vide
  out.posts = buildLegacyPostsFromIds(out.postRoleIds);

  return out;
}

function getGuildConfig(guildId) {
  if (!guildId) return null;
  const data = readAll();
  const cfg = data.guilds[String(guildId)];
  return cfg ? normalizeGuild(cfg) : null;
}

function upsertGuildConfig(guildId, patch) {
  if (!guildId) return null;

  const data = readAll();
  const gid = String(guildId);

  const current = normalizeGuild(data.guilds[gid] || {});
  const p = patch && typeof patch === "object" ? patch : {};

  // staff/player : si patch fournit explicitement des arrays, on prend, sinon current
  const staffRoleIds = Array.isArray(p.staffRoleIds) ? p.staffRoleIds : current.staffRoleIds;
  const playerRoleIds = Array.isArray(p.playerRoleIds) ? p.playerRoleIds : current.playerRoleIds;

  // postes :
  // priorité patch.postRoleIds (nouveau format)
  // sinon, si patch.posts (legacy) est fourni, on convertit
  // sinon current.postRoleIds
  let postRoleIds = current.postRoleIds;

  if (Array.isArray(p.postRoleIds)) {
    postRoleIds = p.postRoleIds;
  } else if (Array.isArray(p.posts)) {
    postRoleIds = extractPostRoleIdsFromLegacyPosts(p.posts);
  }

  const merged = normalizeGuild({
    ...current,
    ...p,
    automations: { ...current.automations, ...(p.automations || {}) },

    staffRoleIds,
    playerRoleIds,

    // ✅ nouveau format
    postRoleIds,
  });

  merged.updatedAt = new Date().toISOString();

  data.guilds[gid] = merged;
  writeAll(data);
  return merged;
}

function exportAllConfig() {
  const data = readAll();
  const out = { ...data, guilds: {} };

  for (const [gid, cfg] of Object.entries(data.guilds || {})) {
    out.guilds[gid] = normalizeGuild(cfg);
  }

  return out;
}

// Optionnel (utile pour importer un export_config)
function importAllConfig(payload, { replace = false } = {}) {
  const data = readAll();

  const incoming = payload && typeof payload === "object" ? payload : {};
  const incomingGuilds = incoming.guilds && typeof incoming.guilds === "object" ? incoming.guilds : {};

  if (replace) data.guilds = {};

  for (const [gid, cfg] of Object.entries(incomingGuilds)) {
    data.guilds[String(gid)] = normalizeGuild(cfg);
  }

  if (!data.version) data.version = 1;
  writeAll(data);
  return exportAllConfig();
}

function resetGuildConfig(guildId) {
  if (!guildId) return null;
  const data = readAll();
  const gid = String(guildId);

  delete data.guilds[gid];
  writeAll(data);
  return true;
}

module.exports = {
  CONFIG_PATH,

  DEFAULT_DATA,
  DEFAULT_GUILD,

  getGuildConfig,
  upsertGuildConfig,
  exportAllConfig,

  // utilitaires
  importAllConfig,
  resetGuildConfig,
};
