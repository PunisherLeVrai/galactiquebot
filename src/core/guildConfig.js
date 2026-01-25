// src/core/guildConfig.js
// Config multi-serveur minimal (servers.json) — CommonJS
// ✅ staffRoleIds (multi) + playerRoleIds (multi) + posts (multi)
// ✅ compat anciennes clés (staffRoleId, playerRoleId)
// ✅ fonctions utilitaires (export/import/reset) utiles pour la suite

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

  // postes (1..n) : utilisés par /pseudo (ex: MDC, BU, DD...)
  // [{ roleId, label }]
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

function normalizePosts(posts) {
  if (!Array.isArray(posts)) return [];

  const out = [];
  const seen = new Set();

  for (const p of posts) {
    if (!p || typeof p !== "object") continue;
    if (!p.roleId) continue;

    const roleId = String(p.roleId);
    if (seen.has(roleId)) continue;

    const label = String(p.label || "POSTE")
      .replace(/[`|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 16);

    out.push({ roleId, label: label || "POSTE" });
    seen.add(roleId);
  }

  return out;
}

function normalizeGuild(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};

  const out = {
    ...DEFAULT_GUILD,
    ...c,
    automations: { ...DEFAULT_GUILD.automations, ...(c.automations || {}) },

    staffRoleIds: Array.isArray(c.staffRoleIds) ? c.staffRoleIds.filter(Boolean) : [],
    playerRoleIds: Array.isArray(c.playerRoleIds) ? c.playerRoleIds.filter(Boolean) : [],
    posts: normalizePosts(c.posts),
  };

  // ----- compat anciennes clés -----
  // staffRoleId (single) -> staffRoleIds
  if (!out.staffRoleIds.length && c.staffRoleId) out.staffRoleIds = [String(c.staffRoleId)];

  // playerRoleId (single) -> playerRoleIds
  if (!out.playerRoleIds.length && c.playerRoleId) out.playerRoleIds = [String(c.playerRoleId)];

  // dédoublonnage final
  out.staffRoleIds = Array.from(new Set(out.staffRoleIds.map(String))).filter(Boolean);
  out.playerRoleIds = Array.from(new Set(out.playerRoleIds.map(String))).filter(Boolean);

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

  const merged = normalizeGuild({
    ...current,
    ...p,
    automations: { ...current.automations, ...(p.automations || {}) },

    // si patch fournit explicitement des arrays, on les prend, sinon on garde current
    staffRoleIds: Array.isArray(p.staffRoleIds) ? p.staffRoleIds : current.staffRoleIds,
    playerRoleIds: Array.isArray(p.playerRoleIds) ? p.playerRoleIds : current.playerRoleIds,
    posts: Array.isArray(p.posts) ? p.posts : current.posts,
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

// Optionnel mais utile pour la suite (ex: importer un export_config)
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
