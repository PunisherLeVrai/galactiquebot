// src/events/client/interactionCreate.js
// Route interactions : boutons Dispo + Slash commands
// CommonJS — discord.js v14

const { warn } = require("../../core/logger");
const { handleDispoButton } = require("../../core/disposWeekButtonsHandler");

const FLAGS_EPHEMERAL = 64;

module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
    try {
      // 1) Boutons Dispo
      if (interaction.isButton() && interaction.customId?.startsWith("dispo:")) {
        const handled = await handleDispoButton(interaction);
        if (handled) return;
      }

      // 2) Slash commands
      if (!interaction.isChatInputCommand()) return;

      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      await command.execute(interaction, client);
    } catch (err) {
      warn("Erreur interactionCreate:", err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "Erreur interne.", flags: FLAGS_EPHEMERAL });
        }
      } catch {}
    }
  },
};
