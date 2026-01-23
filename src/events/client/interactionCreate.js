// src/events/client/interactionCreate.js
const { warn } = require("../../core/logger");
const { handleDispoButton } = require("../../core/disposWeekButtonsHandler");

module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
    try {
      // Buttons dispo
      if (interaction.isButton() && interaction.customId?.startsWith("dispo:")) {
        const handled = await handleDispoButton(interaction);
        if (handled) return;
      }

      // Slash commands
      if (!interaction.isChatInputCommand()) return;

      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;

      await cmd.execute(interaction, client);
    } catch (e) {
      warn("Erreur interactionCreate:", e);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "Erreur interne.", flags: 64 });
        }
      } catch {}
    }
  },
};
