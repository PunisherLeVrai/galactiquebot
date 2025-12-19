// utils/config.js
const fs = require('fs');
const path = require('path');
const { DATA_BASE } = require('./paths'); // même base que pour les snapshots

/**
 * Dossiers de config
 * - repoConfigDir       : dans le projet (fichiers versionnés)
 * - persistentConfigDir : dans DATA_BASE/config → persistant
 */
const repoConfigDir = path.join(__dirname, '../config');
const persistentConfigDir = path.join(DATA_BASE, 'config');

// --- Sécurisation des dossiers ---
function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error(`❌ [config] Impossible de créer le dossier: ${dir}`, e);
  }
}
ensureDir(repoConfigDir);
ensureDir(persistentConfigDir);

// Fichiers dans le repo (valeurs par défaut versionnées)
const repoGlobalPath = path.join(repoConfigDir, 'global.json');
const repoServersPath = path.join(repoConfigDir, 'servers.json');

// Fichiers persistants (Railway / Replit / local)
const globalPath = path.join(persistentConfigDir, 'global.json');
const serversPath = path.join(persistentConfigDir, 'servers.json');

/**
 * Chargement sécurisé d'un JSON
 */
function loadJsonSafe(filePath, fallback, label) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`⚠️ [config] Impossible de charger ${label || filePath} :`, err);
    return fallback;
  }
}

/**
 * Écriture atomique JSON (évite fichiers tronqués/corrompus)
 */
function writeJsonAtomic(filePath, obj, label) {
  try {
    const dir = path.dirname(filePath);
    ensureDir(dir);

    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
    return true;
  } catch (err) {
    console.error(`❌ [config] Impossible d’écrire ${label || filePath} :`, err);
    return false;
  }
}

/**
 * Charge d'abord le fichier PERSISTANT.
 * Si absent / vide → charge le fichier du REPO en fallback,
 * puis le recopie dans le chemin persistant.
 */
function loadWithPersistentFallback(persistentPath, repoPath, defaultValue, label) {
  // 1) Essayer la version persistante
  const persisted = loadJsonSafe(persistentPath, null, `${label} (persistant)`);
  if (persisted && typeof persisted === 'object') return persisted;

  // 2) Essayer le fichier du repo (valeurs par défaut versionnées)
  const fromRepo = loadJsonSafe(repoPath, defaultValue, `${label} (repo)`);
  if (fromRepo && typeof fromRepo === 'object') {
    // 3) Le recopier en persistant pour la prochaine fois
    writeJsonAtomic(persistentPath, fromRepo, `${label} persistant`);
    return fromRepo;
  }

  // 4) Rien trouvé → valeur par défaut
  return defaultValue;
}

// --- Chargement des configs ---
let globalConfig = loadWithPersistentFallback(
  globalPath,
  repoGlobalPath,
  {},
  'config/global.json'
);

let serversConfig = loadWithPersistentFallback(
  serversPath,
  repoServersPath,
  {},
  'config/servers.json'
);

// Valeurs par défaut soft pour la globale
if (!globalConfig || typeof globalConfig !== 'object') globalConfig = {};
if (!globalConfig.botName) globalConfig.botName = 'GalactiqueBot';

/**
 * Sauvegarde la config de tous les serveurs dans le fichier PERSISTANT
 */
function saveServersConfig() {
  return writeJsonAtomic(serversPath, serversConfig, 'config/servers.json (persistant)');
}

/**
 * Sauvegarde la config globale dans le fichier PERSISTANT
 */
function saveGlobalConfig() {
  return writeJsonAtomic(globalPath, globalConfig, 'config/global.json (persistant)');
}

/**
 * Retourne la config globale
 */
function getGlobalConfig() {
  return globalConfig;
}

/**
 * Retourne la config d’une guilde précise.
 */
function getGuildConfig(guildId) {
  if (!guildId) return null;
  return serversConfig[guildId] || null;
}

/**
 * Raccourci : récupère global + guild à partir d’une interaction
 */
function getConfigFromInteraction(interaction) {
  const guildId = interaction.guild?.id;
  return {
    global: getGlobalConfig(),
    guild: guildId ? getGuildConfig(guildId) : null
  };
}

/**
 * Remplace complètement la config d’une guilde.
 */
function setGuildConfig(guildId, newConfig) {
  if (!guildId) return;
  serversConfig[guildId] = (newConfig && typeof newConfig === 'object') ? newConfig : {};
  saveServersConfig();
}

/**
 * Merge “safe” pour objets (superficiel)
 */
function mergeObj(base, patch) {
  const b = (base && typeof base === 'object') ? base : {};
  const p = (patch && typeof patch === 'object') ? patch : {};
  return { ...b, ...p };
}

/**
 * Met à jour partiellement la config d’une guilde.
 * ✅ Merge aussi : roles / dispoMessages / nickname / compo
 */
function updateGuildConfig(guildId, patch) {
  if (!guildId || !patch || typeof patch !== 'object') return;

  const existing = serversConfig[guildId] || {};

  const next = {
    ...existing,
    ...patch
  };

  if (patch.roles) next.roles = mergeObj(existing.roles, patch.roles);
  if (patch.dispoMessages) next.dispoMessages = mergeObj(existing.dispoMessages, patch.dispoMessages);

  // nickname est un objet avec arrays (hierarchy/teams/postes). Ici on remplace ce qui est fourni.
  if (patch.nickname) next.nickname = {
    ...(existing.nickname || {}),
    ...(patch.nickname || {})
  };

  // compo (channelId/detectMode/etc.)
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

  // utilitaires
  saveServersConfig,
  saveGlobalConfig
};
