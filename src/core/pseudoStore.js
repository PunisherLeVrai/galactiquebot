// src/core/pseudoStore.js
// Stockage pseudos multi-plateformes (PSN/XBOX/EA) par serveur et user
// CommonJS

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "..", "config", "pseudos.json");

function ensureFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ version: 2, guilds: {} }, null, 2), "utf8");
  }
}

function readAll() {
  ensureFile();
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return { version: 2, guilds: {} };
    if (!data.guilds || typeof data.guilds !== "object") data.guilds = {};
    if (!data.version) data.version = 2;
    return data;
  } catch {
    return { version: 2, guilds: {} };
  }
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

function ensureGuild(data, guildId) {
  if (!data.guilds[guildId]) data.guilds[guildId] = { users: {} };
  if (!data.guilds[guildId].users) data.guilds[guildId].users = {};
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
  return u;
}

/**
 * Retourne { psn, xbox, ea, updatedAt } (valeurs null si non définies)
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

module.exports = {
  STORE_PATH,
  setUserPseudo,
  getUserPseudos,
  clearUserPseudo,
};
