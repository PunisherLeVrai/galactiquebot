// src/core/pseudoStore.js
// Stockage pseudos multi-plateformes (PSN/XBOX/EA) par serveur et user
// ✅ write atomique (anti corruption)
// ✅ RAM-friendly (pas de gros cache global)
// ✅ Helpers supplémentaires (listGuildUsers / getAllGuildPseudos)
// CommonJS

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "..", "config", "pseudos.json");
const DEFAULT_DATA = { version: 2, guilds: {} };

function ensureFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
  }
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeRoot(data) {
  const out = data && typeof data === "object" ? data : {};
  if (!out.version) out.version = DEFAULT_DATA.version;
  if (!out.guilds || typeof out.guilds !== "object") out.guilds = {};
  return out;
}

function readAll() {
  ensureFile();
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return normalizeRoot(safeParse(raw));
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function writeAll(data) {
  ensureFile();

  const dir = path.dirname(STORE_PATH);
  const tmp = path.join(dir, `pseudos.tmp.${process.pid}.${Date.now()}.json`);
  const payload = normalizeRoot(data);

  try {
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmp, STORE_PATH);
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
    // fallback dernier recours
    try {
      fs.writeFileSync(STORE_PATH, JSON.stringify(payload, null, 2), "utf8");
    } catch {}
    throw e;
  }
}

function ensureGuild(data, guildId) {
  if (!data.guilds[guildId]) data.guilds[guildId] = { users: {} };
  if (!data.guilds[guildId].users || typeof data.guilds[guildId].users !== "object") {
    data.guilds[guildId].users = {};
  }
  return data.guilds[guildId];
}

function ensureUser(guildObj, userId) {
  if (!guildObj.users[userId]) {
    guildObj.users[userId] = {
      psn: null,
      xbox: null,
      ea: null,
      updatedAt: null,
    };
  }
  return guildObj.users[userId];
}

function cleanValue(v) {
  if (!v) return "";
  return String(v)
    .replace(/[`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

/**
 * platform: "psn" | "xbox" | "ea"
 */
function setUserPseudo(guildId, userId, platform, value) {
  const p = String(platform || "").toLowerCase();
  if (!["psn", "xbox", "ea"].includes(p)) return null;

  const val = cleanValue(value);
  if (!val) return null;

  const data = readAll();
  const g = ensureGuild(data, guildId);
  const u = ensureUser(g, userId);

  u[p] = val;
  u.updatedAt = new Date().toISOString();

  writeAll(data);
  return { psn: u.psn, xbox: u.xbox, ea: u.ea, updatedAt: u.updatedAt };
}

/**
 * Retourne { psn, xbox, ea, updatedAt } ou null
 */
function getUserPseudos(guildId, userId) {
  const data = readAll();
  const u = data.guilds?.[guildId]?.users?.[userId];
  if (!u) return null;
  return {
    psn: u.psn || null,
    xbox: u.xbox || null,
    ea: u.ea || null,
    updatedAt: u.updatedAt || null,
  };
}

/**
 * Efface une plateforme spécifique, ou tout si platform absent
 */
function clearUserPseudo(guildId, userId, platform = null) {
  const data = readAll();
  const g = ensureGuild(data, guildId);
  const u = ensureUser(g, userId);

  if (!platform) {
    u.psn = null;
    u.xbox = null;
    u.ea = null;
  } else {
    const p = String(platform).toLowerCase();
    if (p === "psn") u.psn = null;
    if (p === "xbox") u.xbox = null;
    if (p === "ea") u.ea = null;
  }

  u.updatedAt = new Date().toISOString();
  writeAll(data);
  return true;
}

/**
 * Liste des users connus dans ce serveur (IDs)
 */
function listGuildUsers(guildId) {
  const data = readAll();
  const users = data.guilds?.[guildId]?.users;
  if (!users || typeof users !== "object") return [];
  return Object.keys(users);
}

/**
 * Retourne tout le store d'un serveur (users map)
 * Format: { [userId]: { psn, xbox, ea, updatedAt } }
 */
function getAllGuildPseudos(guildId) {
  const data = readAll();
  const users = data.guilds?.[guildId]?.users;
  if (!users || typeof users !== "object") return {};
  return users;
}

module.exports = {
  STORE_PATH,
  setUserPseudo,
  getUserPseudos,
  clearUserPseudo,
  listGuildUsers,
  getAllGuildPseudos,
};
