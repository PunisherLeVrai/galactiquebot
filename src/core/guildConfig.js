// src/core/guildConfig.js
// Helpers multi-serveur : récupérer/valider la config du serveur courant

const { getGuildConfig } = require("./configManager");

const FLAGS_EPHEMERAL = 64; // MessageFlags.Ephemeral

function isSnowflake(v) {
  return typeof v === "string" && /^[0-9]{15,20}$/.test(v);
}

/**
 * Récupère la config du serveur courant (objet, jamais null).
 * Si interaction n’est pas dans un serveur, renvoie null.
 */
function getConfig(interaction) {
  if (!interaction?.guildId) return null;
  return getGuildConfig(interaction.guildId) || {};
}

/**
 * Test si le setup minimum est présent (à ajuster selon tes besoins).
 * Par défaut : staffRoleId + logChannelId OU logsChannelId (si tu utilises logs).
 */
function hasMinimumConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return false;

  const staffOk = isSnowflake(cfg.staffRoleId) || isSnowflake(cfg.roles?.staff);
  const logsOk =
    isSnowflake(cfg.logChannelId) ||
    isSnowflake(cfg.channels?.logs) ||
    isSnowflake(cfg.logsChannelId);

  return staffOk && logsOk;
}

/**
 * Répond proprement “setup manquant” (ephemeral) et retourne null.
 */
async function replySetupMissing(interaction) {
  try {
    const content =
      "Ce serveur n’est pas encore configuré.\n" +
      "Lance **/setup** (admin) puis réessaie.\n" +
      "Astuce : utilise **/export_config** pour sauvegarder `servers.json`.";

    // interaction peut être déjà replied/deferred
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: FLAGS_EPHEMERAL }).catch(() => {});
    } else {
      await interaction.reply({ content, flags: FLAGS_EPHEMERAL }).catch(() => {});
    }
  } catch {}
  return null;
}

/**
 * Retourne la config si OK, sinon répond et retourne null.
 */
async function requireGuildConfig(interaction) {
  if (!interaction?.guildId) {
    const content = "Cette action doit être effectuée dans un serveur.";
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, flags: FLAGS_EPHEMERAL }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: FLAGS_EPHEMERAL }).catch(() => {});
      }
    } catch {}
    return null;
  }

  const cfg = getConfig(interaction);

  // Minimum requis (à ajuster)
  if (!hasMinimumConfig(cfg)) {
    return replySetupMissing(interaction);
  }

  // Normalisation pratique (alias)
  const normalized = normalizeConfig(cfg);
  return normalized;
}

/**
 * Normalise pour avoir une structure stable (roles/channels/features/couleurs)
 * même si tu utilises des champs plats.
 */
function normalizeConfig(cfg) {
  const roles = {
    staff: cfg.roles?.staff || cfg.staffRoleId || null,
    player: cfg.roles?.player || cfg.playerRoleId || null,
    test: cfg.roles?.test || cfg.trialRoleId || cfg.testRoleId || null,
  };

  const channels = {
    logs: cfg.channels?.logs || cfg.logChannelId || cfg.logsChannelId || null,
    dispos: cfg.channels?.dispos || cfg.disposChannelId || null,
    planning: cfg.channels?.planning || cfg.planningChannelId || null,
    effectif: cfg.channels?.effectif || cfg.effectifChannelId || null,
    annonces: cfg.channels?.annonces || cfg.annoncesChannelId || null,
    commands: cfg.channels?.commands || cfg.commandsChannelId || null,
  };

  const features = {
    dispos: cfg.features?.dispos ?? false,
    pseudos: cfg.features?.pseudos ?? false,
    effectif: cfg.features?.effectif ?? false,
    planning: cfg.features?.planning ?? false,
  };

  const colors = {
    primary: cfg.colors?.primary ?? null,
  };

  return {
    ...cfg,
    roles,
    channels,
    features,
    colors,
  };
}

/**
 * Guard optionnel : forcer une commande dans un salon configuré
 * Ex: await requireInChannel(interaction, "dispos");
 */
async function requireInChannel(interaction, channelKey /* ex: "dispos" */) {
  const cfg = await requireGuildConfig(interaction);
  if (!cfg) return null;

  const expectedId = cfg.channels?.[channelKey] || null;
  if (!isSnowflake(expectedId)) return cfg; // si pas configuré, on laisse passer

  if (interaction.channelId !== expectedId) {
    const content = `Cette commande doit être utilisée dans ${`<#${expectedId}>`}.`;
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, flags: FLAGS_EPHEMERAL }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: FLAGS_EPHEMERAL }).catch(() => {});
      }
    } catch {}
    return null;
  }

  return cfg;
}

/**
 * Guard optionnel : autoriser uniquement le rôle Staff configuré
 * Ex: await requireStaff(interaction)
 */
async function requireStaff(interaction) {
  const cfg = await requireGuildConfig(interaction);
  if (!cfg) return null;

  const staffRoleId = cfg.roles?.staff;
  if (!isSnowflake(staffRoleId)) return cfg; // si pas configuré, on laisse passer

  const member = interaction.member;
  const has = member?.roles?.cache?.has?.(staffRoleId);

  if (!has) {
    const content = "Accès refusé : réservé au **Staff**.";
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, flags: FLAGS_EPHEMERAL }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: FLAGS_EPHEMERAL }).catch(() => {});
      }
    } catch {}
    return null;
  }

  return cfg;
}

module.exports = {
  getConfig,
  requireGuildConfig,
  normalizeConfig,
  requireInChannel,
  requireStaff,
};
