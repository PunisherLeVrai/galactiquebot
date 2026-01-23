// src/core/guildConfig.js
// Core multi-serveur : normalisation + helpers (CommonJS)

const { getGuildConfig } = require("./configManager");

const FLAGS_EPHEMERAL = 64; // MessageFlags.Ephemeral

function isSnowflake(v) {
  return typeof v === "string" && /^[0-9]{15,20}$/.test(v);
}

/**
 * Normalise la config pour avoir une structure stable:
 * cfg.channels.dispos, cfg.channels.commands, cfg.channels.logs, cfg.roles.staff, etc.
 * Cela évite de dépendre de noms différents selon les commandes.
 */
function normalizeConfig(cfg) {
  const safe = cfg && typeof cfg === "object" ? cfg : {};

  const roles = {
    staff: safe.roles?.staff || safe.staffRoleId || null,
    player: safe.roles?.player || safe.playerRoleId || null,
    trial: safe.roles?.trial || safe.trialRoleId || safe.testRoleId || null,
  };

  const channels = {
    dispos: safe.channels?.dispos || safe.disposChannelId || null,
    commands: safe.channels?.commands || safe.commandsChannelId || null,
    logs: safe.channels?.logs || safe.logChannelId || safe.logsChannelId || null,
    planning: safe.channels?.planning || safe.planningChannelId || null,
    annonces: safe.channels?.annonces || safe.annoncesChannelId || null,
    effectif: safe.channels?.effectif || safe.effectifChannelId || null,
  };

  const colors = {
    primary: safe.colors?.primary ?? null,
  };

  const features = {
    dispos: safe.features?.dispos ?? false,
    planning: safe.features?.planning ?? false,
    pseudos: safe.features?.pseudos ?? false,
    effectif: safe.features?.effectif ?? false,
  };

  return {
    ...safe,
    roles,
    channels,
    colors,
    features,
  };
}

/**
 * Récupère la config du serveur courant.
 * - Retourne null hors serveur
 * - Retourne config normalisée si existe
 */
function getConfig(interaction) {
  if (!interaction?.guildId) return null;
  const cfg = getGuildConfig(interaction.guildId);
  if (!cfg) return null;
  return normalizeConfig(cfg);
}

/**
 * Critère "config présente".
 * On considère configuré si au moins un champ utile existe.
 * (Tu peux durcir plus tard)
 */
function isConfigured(cfg) {
  if (!cfg || typeof cfg !== "object") return false;
  return !!(
    cfg.channels?.dispos ||
    cfg.channels?.commands ||
    cfg.roles?.staff ||
    cfg.roles?.player ||
    cfg.roles?.trial ||
    cfg.channels?.logs
  );
}

async function replyEphemeral(interaction, content) {
  const payload = { content, flags: FLAGS_EPHEMERAL };
  try {
    if (interaction.deferred || interaction.replied) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch {
    return null;
  }
}

/**
 * Exige une config serveur, sinon répond et retourne null.
 */
async function requireGuildConfig(interaction) {
  if (!interaction?.guildId) {
    await replyEphemeral(interaction, "Cette commande doit être utilisée dans un serveur.");
    return null;
  }

  const cfg = getConfig(interaction);
  if (!cfg || !isConfigured(cfg)) {
    await replyEphemeral(
      interaction,
      "Ce serveur n’est pas encore configuré.\n" +
        "Lance **/setup** (admin) puis réessaie.\n" +
        "Astuce : utilise **/export_config** pour sauvegarder `servers.json`."
    );
    return null;
  }

  return cfg;
}

/**
 * Optionnel : exiger que la commande soit utilisée dans un salon configuré.
 * key: "dispos" | "commands" | "logs" | ...
 */
async function requireInChannel(interaction, key) {
  const cfg = await requireGuildConfig(interaction);
  if (!cfg) return null;

  const expectedId = cfg.channels?.[key] || null;
  if (!isSnowflake(expectedId)) return cfg; // si pas configuré, on ne bloque pas

  if (interaction.channelId !== expectedId) {
    await replyEphemeral(interaction, `Cette commande doit être utilisée dans <#${expectedId}>.`);
    return null;
  }

  return cfg;
}

/**
 * Optionnel : restreindre au rôle staff configuré.
 * (Tu peux l’utiliser pour /setup /dispo admin etc. si tu veux)
 */
async function requireStaff(interaction) {
  const cfg = await requireGuildConfig(interaction);
  if (!cfg) return null;

  const staffRoleId = cfg.roles?.staff;
  if (!isSnowflake(staffRoleId)) return cfg; // si pas configuré, on ne bloque pas

  const member = interaction.member;
  const has = member?.roles?.cache?.has?.(staffRoleId);

  if (!has) {
    await replyEphemeral(interaction, "Accès refusé : réservé au **Staff**.");
    return null;
  }

  return cfg;
}

module.exports = {
  FLAGS_EPHEMERAL,
  normalizeConfig,
  getConfig,
  requireGuildConfig,
  requireInChannel,
  requireStaff,
  isConfigured,
};
