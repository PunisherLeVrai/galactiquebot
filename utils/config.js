// utils/config.js
const fs = require('fs');
const path = require('path');
const { DATA_BASE } = require('./paths');

// Dossiers
const repoDir = path.join(__dirname, '../config');
const persistDir = path.join(DATA_BASE, 'config');

const repoGlobalPath = path.join(repoDir, 'global.json');
const repoServersPath = path.join(repoDir, 'servers.json');

const globalPath = path.join(persistDir, 'global.json');
const serversPath = path.join(persistDir, 'servers.json');

function ensureDir(dir) {
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
  catch (e) { console.error(`❌ [config] mkdir failed: ${dir}`, e); }
}
ensureDir(repoDir);
ensureDir(persistDir);

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`⚠️ [config] read failed: ${filePath}`, e);
    return fallback;
  }
}

// écriture atomique: write tmp -> rename
function writeJsonAtomic(filePath, obj) {
  try {
    ensureDir(path.dirname(filePath));
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
    return true;
  } catch (e) {
    console.error(`❌ [config] write failed: ${filePath}`, e);
    return false;
  }
}

// Persistant d'abord, sinon repo, sinon défaut + copie en persistant
function loadWithFallback(persistPath, repoPath, defaultValue) {
  const persisted = readJson(persistPath, null);
  if (persisted && typeof persisted === 'object') return persisted;

  const fromRepo = readJson(repoPath, defaultValue);
  if (fromRepo && typeof fromRepo === 'object') {
    writeJsonAtomic(persistPath, fromRepo);
    return fromRepo;
  }

  return defaultValue;
}

let globalConfig = loadWithFallback(globalPath, repoGlobalPath, {});
let serversConfig = loadWithFallback(serversPath, repoServersPath, {});

if (!globalConfig || typeof globalConfig !== 'object') globalConfig = {};
if (!globalConfig.botName) globalConfig.botName = 'GalactiqueBot';

function saveGlobalConfig() {
  return writeJsonAtomic(globalPath, globalConfig);
}
function saveServersConfig() {
  return writeJsonAtomic(serversPath, serversConfig);
}

function getGlobalConfig() {
  return globalConfig;
}
function getGuildConfig(guildId) {
  return guildId ? (serversConfig[guildId] || null) : null;
}
function getConfigFromInteraction(interaction) {
  const gid = interaction.guild?.id;
  return { global: globalConfig, guild: gid ? (serversConfig[gid] || null) : null };
}

function setGuildConfig(guildId, newConfig) {
  if (!guildId) return;
  serversConfig[guildId] = (newConfig && typeof newConfig === 'object') ? newConfig : {};
  saveServersConfig();
}

function mergeObj(base, patch) {
  const b = (base && typeof base === 'object') ? base : {};
  const p = (patch && typeof patch === 'object') ? patch : {};
  return { ...b, ...p };
}

// ✅ merge roles/dispoMessages/nickname/compo si fournis
function updateGuildConfig(guildId, patch) {
  if (!guildId || !patch || typeof patch !== 'object') return;

  const existing = serversConfig[guildId] || {};
  const next = { ...existing, ...patch };

  if (patch.roles) next.roles = mergeObj(existing.roles, patch.roles);
  if (patch.dispoMessages) next.dispoMessages = mergeObj(existing.dispoMessages, patch.dispoMessages);

  if (patch.nickname) {
    next.nickname = { ...(existing.nickname || {}), ...(patch.nickname || {}) };
  }

  if (patch.compo) next.compo = mergeObj(existing.compo, patch.compo);

  serversConfig[guildId] = next;
  saveServersConfig();
}

module.exports = {
  getGlobalConfig,
  getGuildConfig,
  getConfigFromInteraction,
  setGuildConfig,
  updateGuildConfig,
  saveServersConfig,
  saveGlobalConfig
};
