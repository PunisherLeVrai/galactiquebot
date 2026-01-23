// src/core/guildConfig.js
// Normalisation de la config par serveur + helpers (staff/joueur)
// CommonJS

const { getGuildConfig: getRawGuildConfig, upsertGuildConfig } = require("./configManager");

function normalizeHours(value, fallback) {
  if (Array.isArray(value) && value.length) {
    return value
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 23);
  }
  return fallback;
}

function withDefaults(cfg = {}) {
  return {
    // Salons
    disposChannelId: cfg.disposChannelId || null,
    reportChannelId: cfg.reportChannelId || null, // salon staff dédié

    commandsChannelId: cfg.commandsChannelId || null,
    planningChannelId: cfg.planningChannelId || null,
    annoncesChannelId: cfg.annoncesChannelId || null,

    // Rôles
    staffRoleId: cfg.staffRoleId || null,
    playerRoleId: cfg.playerRoleId || null,
    trialRoleId: cfg.trialRoleId || null,

    // Automations (ON/OFF)
    automationsEnabled: cfg.automationsEnabled ?? false,

    // Heures (Europe/Paris côté Railway conseillé via env TZ)
    automationReminderHours: normalizeHours(cfg.automationReminderHours, [12]),       // rappel 12h
    automationReportHours: normalizeHours(cfg.automationReportHours, [12, 17]),       // rapport 12h/17h
    automationCloseHours: normalizeHours(cfg.automationCloseHours, [17]),             // fermeture 17h

    // Meta
    guildName: cfg.guildName || null,
    botLabel: cfg.botLabel || null,

    updatedAt: cfg.updatedAt || null,
    setupAt: cfg.setupAt || null,
    setupBy: cfg.setupBy || null,
  };
}

/**
 * Lecture config normalisée (ou null si pas configuré).
 */
function getGuildConfig(guildId) {
  const raw = getRawGuildConfig(guildId);
  if (!raw) return null;
  return withDefaults(raw);
}

/**
 * Assure la config avec defaults en l'écrivant (utile au démarrage).
 */
function ensureGuildConfig(guildId) {
  const raw = getRawGuildConfig(guildId) || {};
  const cfg = withDefaults(raw);

  // Écrit une fois pour persister les defaults si manquants
  upsertGuildConfig(guildId, cfg);
  return cfg;
}

/**
 * Patch config (écrit dans servers.json).
 */
function setGuildConfig(guildId, patch) {
  const existing = getRawGuildConfig(guildId) || {};
  const merged = withDefaults({ ...existing, ...patch });
  return upsertGuildConfig(guildId, merged);
}

function hasRole(member, roleId) {
  if (!member || !roleId) return false;
  return member.roles?.cache?.has(roleId) || false;
}

/**
 * Staff = rôle staff si défini, sinon fallback admin.
 */
function isStaff(member, cfg) {
  if (!member) return false;
  if (cfg?.staffRoleId) return hasRole(member, cfg.staffRoleId);

  // fallback si pas de rôle staff configuré
  return (
    member.permissions?.has?.("Administrator") ||
    member.permissions?.has?.("ManageGuild") ||
    false
  );
}

/**
 * Joueur = rôle playerRoleId (uniquement) — c'est la base "non répondants".
 */
function isPlayer(member, cfg) {
  if (!member || !cfg?.playerRoleId) return false;
  return hasRole(member, cfg.playerRoleId);
}

module.exports = {
  getGuildConfig,
  ensureGuildConfig,
  setGuildConfig,
  isStaff,
  isPlayer,
};
