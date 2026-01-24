// src/events/client/interactionCreate.js
const { warn } = require("../../core/logger");

module.exports = {
  name: "interactionCreate",
  once: false,
  async execute(interaction, client) {
    try {
      if (!interaction.isChatInputCommand()) return;

      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;

      await cmd.execute(interaction, client);
    } catch (err) {
      warn("Erreur interactionCreate:", err);

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: "Erreur interne.", ephemeral: true });
        } else {
          await interaction.reply({ content: "Erreur interne.", ephemeral: true });
        }
      } catch {}
    }
  },
};
