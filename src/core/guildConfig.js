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

function normalizeRootData(data) {
  const out = data && typeof data === "object" ? data : {};
  if (!out.version) out.version = DEFAULT_DATA.version;
  if (!out.guilds || typeof out.guilds !== "object") out.guilds = {};
  return out;
}

function readAll() {
  ensureConfigFile();

  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = safeParseJSON(raw);
    return normalizeRootData(parsed);
  } catch {
    // fallback safe
    return { ...DEFAULT_DATA };
  }
}

// write atomique (évite fichiers corrompus si crash pendant write)
function writeAll(data) {
  ensureConfigFile();

  const dir = path.dirname(CONFIG_PATH);
  const tmp = path.join(dir, `servers.tmp.${process.pid}.${Date.now()}.json`);

  const payload = normalizeRootData(data);

  try {
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    // Sur Linux (Railway), rename remplace atomiquement.
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (e) {
    // cleanup + fallback (au cas où)
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
    // fallback non-atomique (dernier recours)
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(payload, null, 2), "utf8");
    } catch {}
    throw e;
  }
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

  // normalisations simples (évite undefined / mauvais types)
  merged.automations.reportHours = Array.isArray(merged.automations.reportHours)
    ? merged.automations.reportHours
    : DEFAULT_GUILD_CONFIG.automations.reportHours;

  merged.pseudo.reminderHours = Array.isArray(merged.pseudo.reminderHours)
    ? merged.pseudo.reminderHours
    : DEFAULT_GUILD_CONFIG.pseudo.reminderHours;

  // heures en nombres si jamais
  merged.automations.reminderHour = Number.isFinite(merged.automations.reminderHour)
    ? merged.automations.reminderHour
    : DEFAULT_GUILD_CONFIG.automations.reminderHour;

  merged.automations.closeHour = Number.isFinite(merged.automations.closeHour)
    ? merged.automations.closeHour
    : DEFAULT_GUILD_CONFIG.automations.closeHour;

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
    return data.guilds[guildId];
  }

  // s'assure que les champs existent ET persiste si ça change (pour stabiliser au reboot)
  const before = data.guilds[guildId];
  const merged = mergeGuildDefaults(before);

  // compare minimal (évite JSON.stringify lourd)
  const changed =
    !before ||
    before.botLabel !== merged.botLabel ||
    before.updatedAt !== merged.updatedAt || // souvent null → string
    !before.automations ||
    !before.pseudo ||
    !before.mainRoles ||
    !Array.isArray(before.posts);

  data.guilds[guildId] = merged;

  if (changed) {
    data.guilds[guildId].updatedAt = new Date().toISOString();
    writeAll(data);
  }

  return data.guilds[guildId];
}

// patch shallow + merge defaults + updatedAt
function upsertGuildConfig(guildId, patch) {
  const data = readAll();

  const current = mergeGuildDefaults(data.guilds[guildId] || {});
  const p = patch && typeof patch === "object" ? patch : {};

  const merged = mergeGuildDefaults({
    ...current,
    ...p,
    automations: { ...current.automations, ...(p.automations || {}) },
    pseudo: { ...current.pseudo, ...(p.pseudo || {}) },
    mainRoles: { ...current.mainRoles, ...(p.mainRoles || {}) },
    posts: Array.isArray(p.posts) ? p.posts : current.posts,
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
