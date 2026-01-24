// src/core/guildConfig.js
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "servers.json");
const DEFAULT_DATA = { version: 1, guilds: {} };

function ensureConfigFile() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
  }
}

function readAll() {
  ensureConfigFile();
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
  ensureConfigFile();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getGuildConfig(guildId) {
  const data = readAll();
  return data.guilds[guildId] || null;
}

function upsertGuildConfig(guildId, patch) {
  const data = readAll();
  if (!data.guilds[guildId]) data.guilds[guildId] = {};

  data.guilds[guildId] = {
    ...data.guilds[guildId],
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  writeAll(data);
  return data.guilds[guildId];
}

function exportAllConfig() {
  return readAll();
}

module.exports = {
  CONFIG_PATH,
  ensureConfigFile,
  readAll,
  writeAll,
  getGuildConfig,
  upsertGuildConfig,
  exportAllConfig,
};
