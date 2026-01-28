// src/core/guildConfig.js
// Config multi-serveur (servers.json) — CommonJS
// ✅ Chemin FORCÉ : <projet>/src/config/servers.json (AUCUN override)
//
// ✅ staffRoleIds (multi) + playerRoleIds (multi)
// ✅ postRoleIds (multi 0..25) : utilisés par /pseudo (SANS label)
// ✅ dispoMessageIds (7) : IDs des messages ✅/❌ (Lun..Dim) pour /check_dispo
// ✅ checkDispoChannelId (opt) : salon où sont les 7 messages (sinon disposChannelId)
// ✅ automations:
//    - enabled (global)
//    - pseudo: { enabled, minute }
//    - checkDispo: { enabled, times: ["HH:MM", ...] }
//    - reminderDispo: { enabled, mode, channelId, times: ["HH:MM", ...] }
// ✅ compat anciennes clés (staffRoleId, playerRoleId) + ancien format posts [{roleId,label}]
// ✅ utilitaires export/import/reset

const fs = require("fs");
const path = require("path");

// SRC_DIR = dossier src (car ce fichier est dans src/core)
const SRC_DIR = path.join(__dirname, "..");

// ✅ Direction OBLIGATOIRE: src/config/servers.json
const DATA_DIR = path.join(SRC_DIR, "config");
const CONFIG_PATH = path.join(DATA_DIR, "servers.json");

const DEFAULT_DATA = { version: 1, guilds: {} };

// -----------
// Defaults
// -----------
const DEFAULT_GUILD = {
  botLabel: "XIG BLAUGRANA FC Staff",

  // salons
  disposChannelId: null,
  staffReportsChannelId: null,
  pseudoScanChannelId: null,

  // (optionnel) salon où se trouvent les 7 messages de dispo (sinon disposChannelId)
  checkDispoChannelId: null,

  // IDs de messages (7) = Lundi..Dimanche (index 0..6)
  dispoMessageIds: [null, null, null, null, null, null, null],

  // rôles
  staffRoleIds: [],
  playerRoleIds: [],

  // postes (0..25) : utilisés par /pseudo (sans label)
  postRoleIds: [],
  posts: [], // compat legacy : [{ roleId, label }]

  // ✅ automations (format étendu)
  automations: {
    enabled: false, // switch global

    pseudo: {
      enabled: true,
      minute: 10, // HH:10 par défaut
    },

    checkDispo: {
      enabled: false,
      times: [], // ["21:10", ...]
    },

    // ✅ nouveau: rappel dispo (sans réaction ✅/❌)
    reminderDispo: {
      enabled: false,
      mode: "channel", // "channel" | "dm" | "both"
      channelId: null, // salon rappel (fallback: staffReportsChannelId)
      times: [], // ["HH:MM", ...]
    },
  },

  setupBy: null,
  setupAt: null,
  updatedAt: null,
};

// -----------
// IO helpers
// -----------
function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
}

function safeReadJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : fallback;
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

// --------------------
// ✅ Dispo message IDs (Lun..Dim) : tableau FIXE de 7
// --------------------
function isSnowflake(id) {
  const s = String(id || "").trim();
  return /^[0-9]{15,25}$/.test(s);
}

function normalizeDispoMessageIds(input) {
  const src = Array.isArray(input) ? input : [];
  const out = new Array(7).fill(null);
  for (let i = 0; i < 7; i++) {
    const v = src[i];
    const s = v === null || v === undefined ? "" : String(v).trim();
    out[i] = isSnowflake(s) ? s : null;
  }
  return out;
}

// --------------------
// ✅ Automations normalisation
// --------------------
function toBool(v, fallback = false) {
  if (v === true) return true;
  if (v === false) return false;
  return fallback;
}

function clampInt(n, { min = 0, max = 59, fallback = 0 } = {}) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const i = Math.trunc(x);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

// "HH:MM" (24h) -> "HH:MM" ou null
function normalizeTimeStr(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;

  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;

  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

function normalizeTimes(arr, { max = 12 } = {}) {
  const src = Array.isArray(arr) ? arr : [];
  const out = [];
  const seen = new Set();

  for (const v of src) {
    const t = normalizeTimeStr(v);
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function normalizeReminderMode(v) {
  const s = String(v || "").toLowerCase().trim();
  if (s === "dm" || s === "mp") return "dm";
  if (s === "both" || s === "2") return "both";
  return "channel";
}

function normalizeAutomations(a) {
  const src = a && typeof a === "object" ? a : {};

  const globalEnabled = toBool(src.enabled, DEFAULT_GUILD.automations.enabled);

  const pseudoSrc = src.pseudo && typeof src.pseudo === "object" ? src.pseudo : {};
  const checkSrc = src.checkDispo && typeof src.checkDispo === "object" ? src.checkDispo : {};
  const remindSrc = src.reminderDispo && typeof src.reminderDispo === "object" ? src.reminderDispo : {};

  const pseudoMinute = clampInt(pseudoSrc.minute, {
    min: 0,
    max: 59,
    fallback: DEFAULT_GUILD.automations.pseudo.minute,
  });

  return {
    enabled: globalEnabled,

    pseudo: {
      enabled: toBool(pseudoSrc.enabled, DEFAULT_GUILD.automations.pseudo.enabled),
      minute: pseudoMinute,
    },

    checkDispo: {
      enabled: toBool(checkSrc.enabled, DEFAULT_GUILD.automations.checkDispo.enabled),
      times: normalizeTimes(checkSrc.times, { max: 12 }),
    },

    reminderDispo: {
      enabled: toBool(remindSrc.enabled, DEFAULT_GUILD.automations.reminderDispo.enabled),
      mode: normalizeReminderMode(remindSrc.mode ?? DEFAULT_GUILD.automations.reminderDispo.mode),
      channelId: remindSrc.channelId ? String(remindSrc.channelId) : null,
      times: normalizeTimes(remindSrc.times, { max: 12 }),
    },
  };
}

// --------------------
// legacy posts -> ids
// --------------------
function extractPostRoleIdsFromLegacyPosts(posts) {
  if (!Array.isArray(posts)) return [];
  return uniqIds(
    posts
      .filter((p) => p && typeof p === "object" && p.roleId)
      .map((p) => p.roleId),
    { max: 25 }
  );
}

// ids -> legacy posts (label neutre)
function buildLegacyPostsFromIds(postRoleIds) {
  const ids = uniqIds(postRoleIds, { max: 25 });
  return ids.map((roleId) => ({ roleId: String(roleId), label: "POSTE" }));
}

// --------------------
// Normalize guild
// --------------------
function normalizeGuild(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const out = { ...DEFAULT_GUILD, ...c };

  // ✅ automations
  out.automations = normalizeAutomations(c.automations);

  // ✅ roles multi
  out.staffRoleIds = uniqIds(out.staffRoleIds);
  out.playerRoleIds = uniqIds(out.playerRoleIds);

  // ✅ compat legacy roles (staffRoleId / playerRoleId)
  if (!out.staffRoleIds.length && c.staffRoleId) out.staffRoleIds = uniqIds([c.staffRoleId]);
  if (!out.playerRoleIds.length && c.playerRoleId) out.playerRoleIds = uniqIds([c.playerRoleId]);

  // ✅ postes
  const fromPostRoleIds = Array.isArray(c.postRoleIds) ? c.postRoleIds : null;
  const fromLegacyPosts = extractPostRoleIdsFromLegacyPosts(c.posts);
  out.postRoleIds = uniqIds(fromPostRoleIds ?? fromLegacyPosts, { max: 25 });
  out.posts = buildLegacyPostsFromIds(out.postRoleIds);

  // ✅ dispo ids (7)
  out.dispoMessageIds = normalizeDispoMessageIds(c.dispoMessageIds);

  // ✅ salons: toujours string ou null (évite bugs menus defaults)
  out.disposChannelId = c.disposChannelId ? String(c.disposChannelId) : null;
  out.staffReportsChannelId = c.staffReportsChannelId ? String(c.staffReportsChannelId) : null;
  out.pseudoScanChannelId = c.pseudoScanChannelId ? String(c.pseudoScanChannelId) : null;
  out.checkDispoChannelId = c.checkDispoChannelId ? String(c.checkDispoChannelId) : null;

  return out;
}

// --------------------
// CRUD
// --------------------
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

  const staffRoleIds = Array.isArray(p.staffRoleIds) ? p.staffRoleIds : current.staffRoleIds;
  const playerRoleIds = Array.isArray(p.playerRoleIds) ? p.playerRoleIds : current.playerRoleIds;

  let postRoleIds = current.postRoleIds;
  if (Array.isArray(p.postRoleIds)) postRoleIds = p.postRoleIds;
  else if (Array.isArray(p.posts)) postRoleIds = extractPostRoleIdsFromLegacyPosts(p.posts);

  const dispoMessageIds = Array.isArray(p.dispoMessageIds) ? p.dispoMessageIds : current.dispoMessageIds;

  const checkDispoChannelId = Object.prototype.hasOwnProperty.call(p, "checkDispoChannelId")
    ? p.checkDispoChannelId
    : current.checkDispoChannelId;

  const mergedAutomations = normalizeAutomations({
    ...current.automations,
    ...(p.automations || {}),
    pseudo: { ...(current.automations?.pseudo || {}), ...(p.automations?.pseudo || {}) },
    checkDispo: { ...(current.automations?.checkDispo || {}), ...(p.automations?.checkDispo || {}) },
    reminderDispo: { ...(current.automations?.reminderDispo || {}), ...(p.automations?.reminderDispo || {}) },
  });

  const merged = normalizeGuild({
    ...current,
    ...p,
    staffRoleIds,
    playerRoleIds,
    postRoleIds,
    dispoMessageIds,
    checkDispoChannelId,
    automations: mergedAutomations,
  });

  merged.updatedAt = new Date().toISOString();

  data.guilds[gid] = merged;
  writeAll(data);
  return merged;
}

// --------------------
// Export / Import / Reset
// --------------------
function exportAllConfig() {
  const data = readAll();
  const out = { ...data, guilds: {} };

  for (const [gid, cfg] of Object.entries(data.guilds || {})) {
    out.guilds[gid] = normalizeGuild(cfg);
  }

  return out;
}

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
  // chemins
  SRC_DIR,
  DATA_DIR,
  CONFIG_PATH,

  // defaults
  DEFAULT_DATA,
  DEFAULT_GUILD,

  // CRUD
  getGuildConfig,
  upsertGuildConfig,
  exportAllConfig,

  // utilitaires
  importAllConfig,
  resetGuildConfig,
};
