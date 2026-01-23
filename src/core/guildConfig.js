// src/core/guildConfig.js
// Couche "core" multi-serveur : lecture/normalisation de la config par serveur
// Source: config/servers.json via src/core/configManager.js

const { getGuildConfig } = require("./configManager");

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
}

/**
 * Retourne la config normalisée d'une guild.
 * - Retourne null si pas configuré (pas de setup)
 * - Applique des defaults sûrs
 */
function getGuildConfigSafe(guildId) {
  const raw = getGuildConfig(guildId);
  if (!raw) return null;

  // Rôles autorisés pour cliquer sur les dispos :
  // - si vide => tout le monde peut cliquer
  // - si rempli => seuls ces rôles peuvent cliquer
  const allowedRoleIds = normalizeArray(raw.disposAllowedRoleIds);

  return {
    // salons
    commandsChannelId: raw.commandsChannelId || null,
    disposChannelId: raw.disposChannelId || null,
    planningChannelId: raw.planningChannelId || null,
    annoncesChannelId: raw.annoncesChannelId || null,

    // rôles
    staffRoleId: raw.staffRoleId || null,
    playerRoleId: raw.playerRoleId || null,
    trialRoleId: raw.trialRoleId || null,

    // dispo semaine
    disposAllowedRoleIds: allowedRoleIds, // [] => tout le monde
    disposPingRoleIds: normalizeArray(raw.disposPingRoleIds), // optionnel: rôles à mentionner à la création

    // meta
    guildName: raw.guildName || null,
    botLabel: raw.botLabel || null,
    updatedAt: raw.updatedAt || null,
  };
}

/**
 * Vérifie si un membre est autorisé à cliquer selon la config.
 * Règle demandée:
 * - Les réponses DOIVENT être comptées même si aucun rôle Joueur/Essai.
 * => Donc on ne filtre PAS Joueur/Essai.
 * - MAIS tu m'as dit vouloir "un ou des rôles spécifiques" :
 *   => Si disposAllowedRoleIds est défini, on restreint aux rôles listés.
 *   => Sinon tout le monde clique.
 */
function canClickDispos(member, guildCfg) {
  if (!member || !guildCfg) return false;
  const allowed = guildCfg.disposAllowedRoleIds || [];
  if (allowed.length === 0) return true; // tout le monde
  return member.roles?.cache?.some((r) => allowed.includes(r.id)) ?? false;
}

module.exports = {
  getGuildConfigSafe,
  canClickDispos,
};
