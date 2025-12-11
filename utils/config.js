// utils/config.js
const fs = require('fs');
const path = require('path');
const { DATA_BASE } = require('./paths'); // même base que pour les snapshots

/**
 * Dossiers de config
 * - repoConfigDir       : dans le projet (fichiers versionnés)
 * - persistentConfigDir : dans /data/config (ou $DATA_DIR/config) → persistant
 */
const repoConfigDir = path.join(__dirname, '../config');
const persistentConfigDir = path.join(DATA_BASE, 'config');

// --- Sécurisation des dossiers ---
if (!fs.existsSync(repoConfigDir)) {
  fs.mkdirSync(repoConfigDir, { recursive: true });
}
if (!fs.existsSync(persistentConfigDir)) {
  fs.mkdirSync(persistentConfigDir, { recursive: true });
}

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
    console.error(`⚠️ Impossible de charger ${label || filePath} :`, err);
    return fallback;
  }
}

/**
 * Charge d'abord le fichier PERSISTANT.
 * Si absent / vide → charge le fichier du REPO en fallback,
 * puis le recopie dans le chemin persistant.
 */
function loadWithPersistentFallback(persistentPath, repoPath, defaultValue, label) {
  // 1) Essayer la version persistante
  const persisted = loadJsonSafe(persistentPath, null, label + ' (persistant)');
  if (persisted && typeof persisted === 'object') {
    return persisted;
  }

  // 2) Essayer le fichier du repo (valeurs par défaut versionnées)
  const fromRepo = loadJsonSafe(repoPath, defaultValue, label + ' (repo)');
  if (fromRepo && typeof fromRepo === 'object') {
    // 3) Le recopier en persistant pour la prochaine fois
    try {
      fs.writeFileSync(
        persistentPath,
        JSON.stringify(fromRepo, null, 2),
        'utf8'
      );
    } catch (err) {
      console.error(`❌ Impossible d’écrire ${label} persistant :`, err);
    }
    return fromRepo;
  }

  // 4) Rien trouvé → valeur par défaut
  return defaultValue;
}

// --- Chargement des configs ---
// Tout vit maintenant en PERSISTANT (/data/config),
// avec fallback sur les fichiers du repo à la première exécution.

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
if (!globalConfig || typeof globalConfig !== 'object') {
  globalConfig = {};
}
if (!globalConfig.botName) {
  globalConfig.botName = 'GalactiqueBot';
}

/**
 * Sauvegarde la config de tous les serveurs dans le fichier PERSISTANT
 */
function saveServersConfig() {
  try {
    fs.writeFileSync(
      serversPath,
      JSON.stringify(serversConfig, null, 2),
      'utf8'
    );
  } catch (err) {
    console.error('❌ Impossible d’écrire config/servers.json (persistant) :', err);
  }
}

/**
 * Sauvegarde la config globale dans le fichier PERSISTANT
 */
function saveGlobalConfig() {
  try {
    fs.writeFileSync(
      globalPath,
      JSON.stringify(globalConfig, null, 2),
      'utf8'
    );
  } catch (err) {
    console.error('❌ Impossible d’écrire config/global.json (persistant) :', err);
  }
}

/**
 * Retourne la config globale (nom du bot, options communes, etc.)
 */
function getGlobalConfig() {
  return globalConfig;
}

/**
 * Retourne la config d’une guilde (serveur) précise.
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
  serversConfig[guildId] = newConfig || {};
  saveServersConfig();
}

/**
 * Met à jour partiellement la config d’une guilde (merge superficiel).
 *
 * Exemple :
 *   updateGuildConfig(guildId, {
 *     logChannelId: '123',
 *     roles: { joueur: '456' }
 *   })
 */
function updateGuildConfig(guildId, patch) {
  if (!guildId || !patch || typeof patch !== 'object') return;

  const existing = serversConfig[guildId] || {};

  serversConfig[guildId] = {
    ...existing,
    ...patch,
    // merge superficiel pour roles si fourni
    ...(patch.roles
      ? { roles: { ...(existing.roles || {}), ...(patch.roles || {}) } }
      : {})
  };

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
