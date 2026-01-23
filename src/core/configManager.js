const fs = require("fs");
const path = require("path");

const FILE_PATH = path.join(__dirname, "..", "..", "config", "servers.json");

let cache = null;
let dirty = false;

function ensureFile() {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE_PATH)) fs.writeFileSync(FILE_PATH, "{}", "utf8");
}

function loadAll() {
  if (cache) return cache;
  ensureFile();

  try {
    const raw = fs.readFileSync(FILE_PATH, "utf8");
    cache = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    cache = {};
  }
  dirty = false;
  return cache;
}

function saveAll() {
  ensureFile();
  const data = loadAll();
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), "utf8");
  dirty = false;
}

function getGuildConfig(guildId) {
  const all = loadAll();
  if (!all[guildId]) {
    all[guildId] = {
      name: null,
      colors: { primary: null },
      roles: {},
      channels: {},
      features: {}
    };
    dirty = true;
  }
  return all[guildId];
}

function setGuildConfig(guildId, patch) {
  const all = loadAll();
  const current = getGuildConfig(guildId);

  all[guildId] = {
    ...current,
    ...patch,
    colors: { ...(current.colors || {}), ...(patch.colors || {}) },
    roles: { ...(current.roles || {}), ...(patch.roles || {}) },
    channels: { ...(current.channels || {}), ...(patch.channels || {}) },
    features: { ...(current.features || {}), ...(patch.features || {}) }
  };

  dirty = true;
  return all[guildId];
}

function isDirty() {
  return dirty;
}

function getFilePath() {
  return FILE_PATH;
}

module.exports = {
  loadAll,
  saveAll,
  getGuildConfig,
  setGuildConfig,
  isDirty,
  getFilePath
};
