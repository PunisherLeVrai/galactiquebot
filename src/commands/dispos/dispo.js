const { SlashCommandBuilder } = require("discord.js");
const { ensureChannel } = require("../../core/guildConfig");

const FLAGS_EPHEMERAL = 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dispo")
    .setDescription("Indiquer ta disponibilité"),

  async execute(interaction) {
    try {
      // 🔒 vérifie config + bon salon
      ensureChannel(interaction, "commandsChannelId");

      await interaction.reply({
        content: "🟢 Système de disponibilités – à implémenter",
        flags: FLAGS_EPHEMERAL,
      });
    } catch (err) {
      if (err.code === "SERVER_NOT_CONFIGURED") {
        return interaction.reply({
          content:
            "Ce serveur n’est pas encore configuré.\n" +
            "Lance `/setup` (admin) puis réessaie.\n" +
            "Astuce : utilise `/export_config` pour sauvegarder `servers.json`.",
          flags: FLAGS_EPHEMERAL,
        });
      }

      if (err.code === "WRONG_CHANNEL") {
        return interaction.reply({
          content: `Cette commande doit être utilisée dans <#${err.expectedChannelId}>.`,
          flags: FLAGS_EPHEMERAL,
        });
      }

      console.error("[DISPO_ERROR]", err);
      return interaction.reply({
        content: "Erreur lors de l’exécution de la commande.",
        flags: FLAGS_EPHEMERAL,
      });
    }
  },
};
