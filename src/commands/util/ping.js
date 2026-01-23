// src/commands/util/ping.js
const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Test du bot."),
  async execute(interaction) {
    await interaction.reply({ content: "Pong!", flags: 64 });
  },
};
