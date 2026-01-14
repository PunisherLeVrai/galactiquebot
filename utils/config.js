// utils/config.js
const fs = require('fs');
const path = require('path');

/* ============================================================
   ✅ RÉSOLUTION DU DOSSIER PERSISTANT (sans utils/paths.js)

   Priorité :
   1) CONFIG_DIR (env)
   2) /mnt/storage/config  (Railway Volume)
   3) ./config (repo)      (fallback)
============================================================ */
function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function resolvePersistDir() {
  const envDir = process.env.CONFIG_DIR?.trim();
  if (envDir) return envDir;

  // Railway volume (si tu utilises /mnt/storage)
  if (exists('/mnt/storage')) return path.join('/mnt/storage', 'config');

  // fallback (pas de persistant)
  return null;
}

/* ============================================================
   DOSSIERS & PATHS
============================================================ */
const repoDir = path.join(__dirname, '../config'); // dans ton repo
const repoGlobalPath = path.join(repoDir, 'global.json');
const repoServersPath = path.join(repoDir, 'servers.json');

const persistDir = resolvePersistDir(); // null si pas dispo
const globalPath = persistDir ? path.join(persistDir, 'global.json') : repoGlobalPath;
const serversPath = persistDir ? path.join(persistDir, 'servers.json') : repoServersPath;

function ensureDir(dir) {
  try {
    if (!dir) return;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error(`❌ [config] mkdir failed: ${dir}`, e);
  }
}

ensureDir(repoDir);
ensureDir(persistDir);

/* ============================================================
   HELPERS JSON
============================================================ */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function readJson(filePath, fallback = null) {
  try {
    if (!filePath) return fallback;
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
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
    if (!filePath) return false;
    ensureDir(path.dirname(filePath));

    const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');

    try {
      fs.renameSync(tmp, filePath);
    } catch (e) {
      try {
        fs.copyFileSync(tmp, filePath);
        fs.unlinkSync(tmp);
      } catch (e2) {
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

/**
 * Persistant d'abord, sinon repo, sinon défaut.
 * Si on a un persistDir, on copie le repo vers persistant au 1er run.
 */
function loadWithFallback(persistPath, repoPath, defaultValue) {
  // 1) persistant
  const persisted = readJson(persistPath, null);
  if (isPlainObject(persisted)) return persisted;

  // 2) repo
  const fromRepo = readJson(repoPath, defaultValue);
  if (isPlainObject(fromRepo)) {
    // si on a un vrai persistant différent du repo, on copie
    if (persistDir && persistPath !== repoPath) {
      writeJsonAtomic(persistPath, fromRepo);
    }
    return fromRepo;
  }

  return defaultValue;
}

/* ============================================================
   CHARGEMENT
============================================================ */
let globalConfig = loadWithFallback(globalPath, repoGlobalPath, {});
let serversConfig = loadWithFallback(serversPath, repoServersPath, {});

if (!isPlainObject(globalConfig)) globalConfig = {};
if (!isPlainObject(serversConfig)) serversConfig = {};

if (!globalConfig.botName) globalConfig.botName = 'GalactiqueBot';

/* ============================================================
   ✅ MIGRATION / NORMALISATION PLANNING
   Ancien format: planning[jour] = { times, comps, note: "..." }
   Nouveau format: planning[jour] = { times, comps, notes: { "22:20": "..." } }

   Règle: si "note" existe et "notes" absent -> on applique la note
   à tous les horaires cochés, puis on supprime "note".
============================================================ */
function normalizePlanningForGuild(guildObj) {
  if (!isPlainObject(guildObj)) return false;
  if (!isPlainObject(guildObj.planning)) return false;

  let changed = false;
  const planning = guildObj.planning;

  for (const [, day] of Object.entries(planning)) {
    if (!isPlainObject(day)) continue;

    // garantir structure
    if (!Array.isArray(day.times)) { day.times = []; changed = true; }
    if (!Array.isArray(day.comps)) { day.comps = []; changed = true; }

    if (!isPlainObject(day.notes)) {
      day.notes = {};
      changed = true;
    }

    // migration note -> notes
    if (typeof day.note === 'string' && day.note.trim()) {
      const legacy = day.note.trim().slice(0, 200);
      const times = day.times;

      if (times.length) {
        for (const t of times) {
          if (!day.notes[t]) day.notes[t] = legacy;
        }
      }

      delete day.note;
      changed = true;
    }
  }

  return changed;
}

function normalizeAllServersConfig() {
  if (!isPlainObject(serversConfig)) return false;
  let changed = false;

  for (const [, g] of Object.entries(serversConfig)) {
    if (!isPlainObject(g)) continue;
    if (normalizePlanningForGuild(g)) changed = true;
  }
  return changed;
}

// Normalise une fois au chargement
try {
  const changed = normalizeAllServersConfig();
  if (changed) {
    writeJsonAtomic(serversPath, serversConfig);
    console.log('✅ [config] Migration planning effectuée (note -> notes).');
  }
} catch (e) {
  console.error('⚠️ [config] Migration planning error:', e);
}

/* ============================================================
   API
============================================================ */
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
 * - ne throw jamais
 */
function updateGuildConfig(guildId, patch) {
  try {
    if (!guildId || !isPlainObject(patch)) return false;

    const existing = isPlainObject(serversConfig[guildId]) ? serversConfig[guildId] : {};
    const next = { ...existing, ...patch };

    if (patch.roles) next.roles = mergeObj(existing.roles, patch.roles);
    if (patch.dispoMessages) next.dispoMessages = mergeObj(existing.dispoMessages, patch.dispoMessages);
    if (patch.nickname) next.nickname = { ...(existing.nickname || {}), ...(patch.nickname || {}) };
    if (patch.compo) next.compo = mergeObj(existing.compo, patch.compo);

    // planning : merge par jour
    if (patch.planning) next.planning = mergeObj(existing.planning, patch.planning);

    serversConfig[guildId] = next;

    // re-normalise le planning du guild modifié (sécurité)
    try { normalizePlanningForGuild(serversConfig[guildId]); } catch {}

    return saveServersConfig();
  } catch (e) {
    console.error('❌ [config] updateGuildConfig failed:', e);
    return false;
  }
}

module.exports = {
  // chemins utiles (debug)
  repoDir,
  persistDir,
  globalPath,
  serversPath,

  getGlobalConfig,
  getGuildConfig,
  getConfigFromInteraction,
  setGuildConfig,
  updateGuildConfig,
  saveServersConfig,
  saveGlobalConfig
};
