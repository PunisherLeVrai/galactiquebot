// src/core/configManager.js
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
    const parsed = JSON.parse(raw);

    // Hardening: structure minimale garantie
    if (!parsed || typeof parsed !== "object") return { version: 1, guilds: {} };
    if (!parsed.guilds || typeof parsed.guilds !== "object") parsed.guilds = {};
    if (!parsed.version) parsed.version = 1;

    return parsed;
  } catch {
    return { version: 1, guilds: {} };
  }
}

function writeAll(data) {
  ensureConfigFile();

  const safe = data && typeof data === "object" ? data : { version: 1, guilds: {} };
  if (!safe.guilds || typeof safe.guilds !== "object") safe.guilds = {};
  if (!safe.version) safe.version = 1;

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(safe, null, 2), "utf8");
}

// ✅ IMPORTANT: renvoie TOUJOURS un objet (jamais null)
function getGuildConfig(guildId) {
  const data = readAll();
  return data.guilds[guildId] || {};
}

function upsertGuildConfig(guildId, patch) {
  const data = readAll();
  if (!data.guilds[guildId] || typeof data.guilds[guildId] !== "object") {
    data.guilds[guildId] = {};
  }

  data.guilds[guildId] = {
    ...data.guilds[guildId],
    ...(patch && typeof patch === "object" ? patch : {}),
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
  CONFIG_PATH,
};
