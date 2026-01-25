// src/core/guildConfig.js
// Config multi-serveur minimal (servers.json) — CommonJS
// ✅ staffRoleIds (multi) + playerRoleIds (multi) + posts (multi)
// + compat anciennes clés (staffRoleId, playerRoleId)

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

function readAll() {
  ensureFile();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return { ...DEFAULT_DATA };
    if (!data.guilds || typeof data.guilds !== "object") data.guilds = {};
    if (!data.version) data.version = 1;
    return data;
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
}

function normalizeGuild(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};

  const out = {
    ...DEFAULT_GUILD,
    ...c,
    automations: { ...DEFAULT_GUILD.automations, ...(c.automations || {}) },

    staffRoleIds: Array.isArray(c.staffRoleIds) ? c.staffRoleIds.filter(Boolean) : [],
    playerRoleIds: Array.isArray(c.playerRoleIds) ? c.playerRoleIds.filter(Boolean) : [],
    posts: Array.isArray(c.posts) ? c.posts.filter((p) => p && p.roleId) : [],
  };

  // ----- compat anciennes clés -----
  // staffRoleId (single) -> staffRoleIds
  if (!out.staffRoleIds.length && c.staffRoleId) out.staffRoleIds = [c.staffRoleId];

  // playerRoleId (single) -> playerRoleIds
  if (!out.playerRoleIds.length && c.playerRoleId) out.playerRoleIds = [c.playerRoleId];

  return out;
}

function getGuildConfig(guildId) {
  const data = readAll();
  const cfg = data.guilds[guildId];
  return cfg ? normalizeGuild(cfg) : null;
}

function upsertGuildConfig(guildId, patch) {
  const data = readAll();
  const current = normalizeGuild(data.guilds[guildId] || {});
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

  data.guilds[guildId] = merged;
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

module.exports = {
  CONFIG_PATH,
  getGuildConfig,
  upsertGuildConfig,
  exportAllConfig,
};
