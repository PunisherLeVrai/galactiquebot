// utils/config.js
const fs = require('fs');
const path = require('path');

const configDir = path.join(__dirname, '../config');
const globalPath = path.join(configDir, 'global.json');
const serversPath = path.join(configDir, 'servers.json');

// --- Sécurisation du dossier config ---
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

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

// --- Chargement des configs ---
// ⚠️ Aucun ID n'est défini en dur ici : tout vient soit des fichiers JSON,
// soit des commandes qui mettront à jour ces fichiers.

let globalConfig = loadJsonSafe(globalPath, {}, 'config/global.json');
let serversConfig = loadJsonSafe(serversPath, {}, 'config/servers.json');

// Valeurs par défaut soft pour la globale
if (!globalConfig || typeof globalConfig !== 'object') {
  globalConfig = {};
}
if (!globalConfig.botName) {
  globalConfig.botName = 'GalactiqueBot';
}

/**
 * Sauvegarde la config de tous les serveurs dans config/servers.json
 */
function saveServersConfig() {
  try {
    fs.writeFileSync(
      serversPath,
      JSON.stringify(serversConfig, null, 2),
      'utf8'
    );
  } catch (err) {
    console.error('❌ Impossible d’écrire config/servers.json :', err);
  }
}

/**
 * Sauvegarde la config globale dans config/global.json
 * (au cas où tu ajoutes une commande /config global)
 */
function saveGlobalConfig() {
  try {
    fs.writeFileSync(
      globalPath,
      JSON.stringify(globalConfig, null, 2),
      'utf8'
    );
  } catch (err) {
    console.error('❌ Impossible d’écrire config/global.json :', err);
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
 * Exemple de contenu possible :
 * {
 *   "logChannelId": "...",
 *   "mainDispoChannelId": "...",
 *   "roles": { "joueur": "...", "essai": "..." },
 *   "nickname": { "hierarchy": [...], "teams": [...], "postes": [...] }
 * }
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
 * ⚠️ Utiliser plutôt updateGuildConfig pour des modifications partielles.
 */
function setGuildConfig(guildId, newConfig) {
  if (!guildId) return;
  serversConfig[guildId] = newConfig || {};
  saveServersConfig();
}

/**
 * Met à jour partiellement la config d’une guilde (merge superficiel).
 * Exemple : updateGuildConfig(guildId, { logChannelId: '123', roles: { joueur: '456' } })
 *
 * - Les autres propriétés existantes de la guilde sont conservées.
 * - Pour "roles", on fait un merge superficiel :
 *   ancien.roles + nouveaux roles fournis.
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
  // utilitaires au cas où tu en aies besoin plus tard
  saveServersConfig,
  saveGlobalConfig
};
