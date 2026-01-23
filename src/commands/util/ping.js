const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Test de latence du bot"),

  async execute(interaction) {
    const ms = Date.now() - interaction.createdTimestamp;
    return interaction.reply({ content: `Pong: ${ms}ms`, ephemeral: true });
  }
};
