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
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error(`❌ [config] mkdir failed: ${dir}`, e);
  }
}

ensureDir(repoDir);
ensureDir(persistDir);

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;

    const parsed = JSON.parse(raw);
    return parsed;
  } catch (e) {
    console.error(`⚠️ [config] read failed: ${filePath}`, e);
    return fallback;
  }
}

/**
 * ✅ écriture atomique robuste :
 * - tmp UNIQUE (évite collisions)
 * - rename, sinon fallback copy+unlink
 */
function writeJsonAtomic(filePath, obj) {
  try {
    ensureDir(path.dirname(filePath));

    const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');

    try {
      fs.renameSync(tmp, filePath);
    } catch (e) {
      // fallback si rename non possible
      try {
        fs.copyFileSync(tmp, filePath);
        fs.unlinkSync(tmp);
      } catch (e2) {
        // clean tmp si possible
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
        throw e2;
      }
    }

    return true;
  } catch (e) {
    console.error(`❌ [config] write failed: ${filePath}`, e);
    return false;
  }
}

// Persistant d'abord, sinon repo, sinon défaut + copie en persistant
function loadWithFallback(persistPath, repoPath, defaultValue) {
  const persisted = readJson(persistPath, null);
  if (isPlainObject(persisted)) return persisted;

  const fromRepo = readJson(repoPath, defaultValue);
  if (isPlainObject(fromRepo)) {
    writeJsonAtomic(persistPath, fromRepo);
    return fromRepo;
  }

  return defaultValue;
}

let globalConfig = loadWithFallback(globalPath, repoGlobalPath, {});
let serversConfig = loadWithFallback(serversPath, repoServersPath, {});

// ✅ Normalisation stricte
if (!isPlainObject(globalConfig)) globalConfig = {};
if (!isPlainObject(serversConfig)) serversConfig = {};

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
  if (!guildId) return null;
  return isPlainObject(serversConfig) ? (serversConfig[guildId] || null) : null;
}
function getConfigFromInteraction(interaction) {
  const gid = interaction.guild?.id;
  return {
    global: globalConfig,
    guild: gid ? (serversConfig[gid] || null) : null
  };
}

function setGuildConfig(guildId, newConfig) {
  if (!guildId) return false;
  serversConfig[guildId] = isPlainObject(newConfig) ? newConfig : {};
  return saveServersConfig();
}

function mergeObj(base, patch) {
  const b = isPlainObject(base) ? base : {};
  const p = isPlainObject(patch) ? patch : {};
  return { ...b, ...p };
}

/**
 * ✅ updateGuildConfig
 * - merge roles/dispoMessages/nickname/compo/planning (par jour)
 * - ne throw jamais (renvoie true/false si tu veux logger)
 */
function updateGuildConfig(guildId, patch) {
  try {
    if (!guildId || !isPlainObject(patch)) return false;

    const existing = isPlainObject(serversConfig[guildId]) ? serversConfig[guildId] : {};
    const next = { ...existing, ...patch };

    if (patch.roles) next.roles = mergeObj(existing.roles, patch.roles);
    if (patch.dispoMessages) next.dispoMessages = mergeObj(existing.dispoMessages, patch.dispoMessages);

    if (patch.nickname) {
      next.nickname = { ...(existing.nickname || {}), ...(patch.nickname || {}) };
    }

    if (patch.compo) next.compo = mergeObj(existing.compo, patch.compo);

    // ✅ planning : merge par jour
    if (patch.planning) {
      next.planning = mergeObj(existing.planning, patch.planning);
    }

    serversConfig[guildId] = next;
    return saveServersConfig();
  } catch (e) {
    console.error('❌ [config] updateGuildConfig failed:', e);
    return false;
  }
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
