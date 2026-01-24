// src/events/client/interactionCreate.js
const { warn } = require("../../core/logger");
const { handleDispoButton } = require("../../core/disposWeekButtonsHandler");

module.exports = {
  name: "interactionCreate",
  once: false,
  async execute(interaction, client) {
    try {
      if (interaction.isButton() && interaction.customId?.startsWith("dispo:")) {
        await handleDispoButton(interaction);
        return;
      }

      if (!interaction.isChatInputCommand()) return;

      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;

      await cmd.execute(interaction, client);
    } catch (err) {
      warn("Erreur interactionCreate:", err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "⚠️", ephemeral: true });
        }
      } catch {}
    }
  },
};
