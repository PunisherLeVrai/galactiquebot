// src/core/requireGuildConfig.js
// Helper pour toutes les commandes multi-serveur

const { getGuildConfig } = require("./configManager");

const FLAGS_EPHEMERAL = 64;

function isConfigured(cfg) {
  // Critère minimal: au moins 1 champ utile est défini
  // (tu peux durcir ensuite si tu veux)
  return !!(
    cfg &&
    (cfg.commandsChannelId ||
      cfg.disposChannelId ||
      cfg.planningChannelId ||
      cfg.annoncesChannelId ||
      cfg.staffRoleId ||
      cfg.playerRoleId ||
      cfg.trialRoleId)
  );
}

async function requireGuildConfig(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Cette commande doit être utilisée dans un serveur.",
      flags: FLAGS_EPHEMERAL,
    });
    return null;
  }

  const guildId = interaction.guildId;
  const cfg = getGuildConfig(guildId);

  if (!isConfigured(cfg)) {
    await interaction.reply({
      content:
        "Ce serveur n’est pas encore configuré.\n" +
        "Lance `/setup` (admin) puis réessaie.\n" +
        "Astuce : utilise `/export_config` pour sauvegarder `servers.json`.\n" +
        `Debug: guildId=\`${guildId}\``,
      flags: FLAGS_EPHEMERAL,
    });
    return null;
  }

  return cfg;
}

module.exports = { requireGuildConfig, isConfigured };
