const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "servers.json");

function ensureConfigFile() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ version: 1, guilds: {} }, null, 2), "utf8");
  }
}

function readAll() {
  ensureConfigFile();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    // fallback safe
    return { version: 1, guilds: {} };
  }
}

function writeAll(data) {
  ensureConfigFile();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getGuildConfig(guildId) {
  const data = readAll();
  if (!data.guilds[guildId]) return null;
  return data.guilds[guildId];
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

function exportAll() {
  return readAll();
}

module.exports = {
  getGuildConfig,
  upsertGuildConfig,
  exportAll,
  CONFIG_PATH
};
