// src/core/guildConfig.js
// Gestion config serveurs (servers.json) — CommonJS
// ✅ Safe read/write + auto-create + merge defaults par guild
// ✅ Export complet pour automations
// ✅ Helpers: getOrCreateGuildConfig, updateGuildConfig (alias), deleteGuildConfig, patchGuildConfig
// ✅ RAM/IO friendly (write atomique)

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "servers.json");

const DEFAULT_DATA = { version: 1, guilds: {} };

// Defaults par serveur (évite les undefined dans le bot)
const DEFAULT_GUILD_CONFIG = {
  botLabel: "XIG BLAUGRANA FC Staff",

  // salons
  disposChannelId: null,
  staffReportsChannelId: null,
  commandsChannelId: null,
  planningChannelId: null,
  annoncesChannelId: null,

  // rôles
  staffRoleId: null,
  playerRoleId: null,
  trialRoleId: null,

  // automations dispos
  automations: {
    enabled: false,
    reminderHour: 12,
    reportHours: [12, 17],
    closeHour: 17,
  },

  // pseudo (scan/sync/rappels) — si tu l'utilises
  pseudo: {
    scanChannelId: null,
    deleteMessages: false,
    syncEnabled: true,
    syncFetchMembers: true,
    reminderEnabled: false,
    reminderHours: [12, 17, 21],
  },

  // mainRoles / posts (si tu l'utilises)
  mainRoles: {
    president: { id: null },
    fondateur: { id: null },
    gm: { id: null },
    cogm: { id: null },
    staff: { id: null },
  },
  posts: [],

  // meta
  setupBy: null,
  setupAt: null,
  updatedAt: null,
};

function ensureConfigFile() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
  }
}

function safeParseJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readAll() {
  ensureConfigFile();

  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const data = safeParseJSON(raw);

  if (!data || typeof data !== "object") return { ...DEFAULT_DATA };
  if (!data.guilds || typeof data.guilds !== "object") data.guilds = {};
  if (!data.version) data.version = DEFAULT_DATA.version;

  return data;
}

// write atomique (évite fichiers corrompus si crash pendant write)
function writeAll(data) {
  ensureConfigFile();

  const dir = path.dirname(CONFIG_PATH);
  const tmp = path.join(dir, `servers.tmp.${Date.now()}.json`);

  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, CONFIG_PATH);
}

function mergeGuildDefaults(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const merged = {
    ...DEFAULT_GUILD_CONFIG,
    ...c,
    automations: {
      ...DEFAULT_GUILD_CONFIG.automations,
      ...(c.automations || {}),
    },
    pseudo: {
      ...DEFAULT_GUILD_CONFIG.pseudo,
      ...(c.pseudo || {}),
    },
    mainRoles: {
      ...DEFAULT_GUILD_CONFIG.mainRoles,
      ...(c.mainRoles || {}),
      president: { ...(DEFAULT_GUILD_CONFIG.mainRoles.president), ...(c.mainRoles?.president || {}) },
      fondateur: { ...(DEFAULT_GUILD_CONFIG.mainRoles.fondateur), ...(c.mainRoles?.fondateur || {}) },
      gm: { ...(DEFAULT_GUILD_CONFIG.mainRoles.gm), ...(c.mainRoles?.gm || {}) },
      cogm: { ...(DEFAULT_GUILD_CONFIG.mainRoles.cogm), ...(c.mainRoles?.cogm || {}) },
      staff: { ...(DEFAULT_GUILD_CONFIG.mainRoles.staff), ...(c.mainRoles?.staff || {}) },
    },
    posts: Array.isArray(c.posts) ? c.posts : [],
  };

  // normalisations simples
  merged.automations.reportHours = Array.isArray(merged.automations.reportHours)
    ? merged.automations.reportHours
    : DEFAULT_GUILD_CONFIG.automations.reportHours;

  merged.pseudo.reminderHours = Array.isArray(merged.pseudo.reminderHours)
    ? merged.pseudo.reminderHours
    : DEFAULT_GUILD_CONFIG.pseudo.reminderHours;

  return merged;
}

function getGuildConfig(guildId) {
  const data = readAll();
  const cfg = data.guilds[guildId];
  return cfg ? mergeGuildDefaults(cfg) : null;
}

function getOrCreateGuildConfig(guildId) {
  const data = readAll();
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = mergeGuildDefaults({});
    data.guilds[guildId].updatedAt = new Date().toISOString();
    writeAll(data);
  } else {
    // s'assure que les champs existent (sans réécrire systématiquement)
    data.guilds[guildId] = mergeGuildDefaults(data.guilds[guildId]);
  }
  return data.guilds[guildId];
}

// patch shallow + merge defaults + updatedAt
function upsertGuildConfig(guildId, patch) {
  const data = readAll();
  const current = mergeGuildDefaults(data.guilds[guildId] || {});
  const merged = mergeGuildDefaults({
    ...current,
    ...patch,
    automations: { ...current.automations, ...(patch?.automations || {}) },
    pseudo: { ...current.pseudo, ...(patch?.pseudo || {}) },
    mainRoles: { ...current.mainRoles, ...(patch?.mainRoles || {}) },
    posts: Array.isArray(patch?.posts) ? patch.posts : current.posts,
  });

  merged.updatedAt = new Date().toISOString();

  data.guilds[guildId] = merged;
  writeAll(data);
  return merged;
}

// alias pratique
function updateGuildConfig(guildId, patch) {
  return upsertGuildConfig(guildId, patch);
}

function patchGuildConfig(guildId, patch) {
  return upsertGuildConfig(guildId, patch);
}

function deleteGuildConfig(guildId) {
  const data = readAll();
  if (data.guilds[guildId]) {
    delete data.guilds[guildId];
    writeAll(data);
    return true;
  }
  return false;
}

function exportAllConfig() {
  const data = readAll();

  // normalise toutes les guilds à l'export (évite crash automations)
  const out = { ...data, guilds: {} };
  for (const [gid, cfg] of Object.entries(data.guilds || {})) {
    out.guilds[gid] = mergeGuildDefaults(cfg);
  }
  return out;
}

module.exports = {
  CONFIG_PATH,

  // file helpers
  ensureConfigFile,
  readAll,
  writeAll,

  // guild helpers
  getGuildConfig,
  getOrCreateGuildConfig,
  upsertGuildConfig,
  updateGuildConfig,
  patchGuildConfig,
  deleteGuildConfig,

  // export
  exportAllConfig,

  // defaults (utile tests/debug)
  DEFAULT_DATA,
  DEFAULT_GUILD_CONFIG,
};
