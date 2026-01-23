// src/core/guildConfig.js
const { getGuildConfig: getRawGuildConfig, upsertGuildConfig } = require("./configManager");

function withDefaults(cfg = {}) {
  return {
    // salons
    disposChannelId: cfg.disposChannelId || null,        // où les messages de dispo sont postés
    reportChannelId: cfg.reportChannelId || null,        // salon staff pour rapports/rappels auto (recommandé)

    // rôles
    staffRoleId: cfg.staffRoleId || null,
    playerRoleId: cfg.playerRoleId || null,

    // automations
    automationsEnabled: cfg.automationsEnabled ?? false,

    // heures (heure locale du conteneur -> mets TZ=Europe/Paris sur Railway)
    automationReminderHours: Array.isArray(cfg.automationReminderHours) ? cfg.automationReminderHours : [12],
    automationReportHours: Array.isArray(cfg.automationReportHours) ? cfg.automationReportHours : [12, 17],
    automationCloseHours: Array.isArray(cfg.automationCloseHours) ? cfg.automationCloseHours : [17],
  };
}

function getGuildConfig(guildId) {
  const raw = getRawGuildConfig(guildId);
  if (!raw) return null;
  return withDefaults(raw);
}

function ensureGuildConfig(guildId) {
  const raw = getRawGuildConfig(guildId) || {};
  const cfg = withDefaults(raw);
  upsertGuildConfig(guildId, cfg);
  return cfg;
}

function setGuildConfig(guildId, patch) {
  return upsertGuildConfig(guildId, patch);
}

function hasRole(member, roleId) {
  if (!roleId) return false;
  return member?.roles?.cache?.has(roleId) || false;
}

function isStaff(member, cfg) {
  if (cfg?.staffRoleId) return hasRole(member, cfg.staffRoleId);
  // fallback si pas de rôle staff configuré
  return member?.permissions?.has?.("Administrator") || false;
}

function isPlayer(member, cfg) {
  if (!cfg?.playerRoleId) return false;
  return hasRole(member, cfg.playerRoleId);
}

module.exports = {
  getGuildConfig,
  ensureGuildConfig,
  setGuildConfig,
  isStaff,
  isPlayer,
};
