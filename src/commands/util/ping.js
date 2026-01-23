const { SlashCommandBuilder } = require("discord.js");
const { requireGuildConfig } = require("../../core/guildConfig");

const FLAGS_EPHEMERAL = 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Test du bot + vérification config serveur"),
  async execute(interaction) {
    const cfg = await requireGuildConfig(interaction);
    if (!cfg) return; // réponse déjà envoyée

    await interaction.reply({
      content: `Pong.\nLogs: ${cfg.channels.logs ? `<#${cfg.channels.logs}>` : "—"}\nStaff: ${
        cfg.roles.staff ? `<@&${cfg.roles.staff}>` : "—"
      }`,
      flags: FLAGS_EPHEMERAL,
    });
  },
};
