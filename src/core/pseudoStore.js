// src/core/pseudoStore.js
// Stockage pseudos multi-serveur — CommonJS

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "..", "config", "pseudos.json");
const DEFAULT_DATA = { version: 1, guilds: {} };

function ensureFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
}

function readAll() {
  ensureFile();
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
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
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

function normalizeValue(v, max = 40) {
  if (!v) return "";
  return String(v)
    .replace(/[`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function ensureGuild(data, guildId) {
  if (!data.guilds[guildId]) data.guilds[guildId] = { users: {} };
  if (!data.guilds[guildId].users) data.guilds[guildId].users = {};
  return data.guilds[guildId];
}

function getUserPseudos(guildId, userId) {
  const data = readAll();
  return data.guilds?.[guildId]?.users?.[userId] || null;
}

function setUserPseudos(guildId, userId, patch) {
  const data = readAll();
  const g = ensureGuild(data, guildId);
  const cur = g.users[userId] || { psn: "", xbox: "", ea: "", updatedAt: null };

  const next = {
    psn: normalizeValue(patch?.psn ?? cur.psn),
    xbox: normalizeValue(patch?.xbox ?? cur.xbox),
    ea: normalizeValue(patch?.ea ?? cur.ea),
    updatedAt: new Date().toISOString(),
  };

  g.users[userId] = next;
  writeAll(data);
  return next;
}

module.exports = {
  STORE_PATH,
  getUserPseudos,
  setUserPseudos,
};
