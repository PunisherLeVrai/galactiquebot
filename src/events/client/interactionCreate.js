// src/events/client/interactionCreate.js
const { warn } = require("../../core/logger");

const FLAGS_EPHEMERAL = 64;

module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
    try {
      if (!interaction.isChatInputCommand()) return;

      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;

      await cmd.execute(interaction, client);
    } catch (err) {
      warn("Erreur interactionCreate :", err);

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: "Erreur commande.", flags: FLAGS_EPHEMERAL });
        } else {
          await interaction.reply({ content: "Erreur commande.", flags: FLAGS_EPHEMERAL });
        }
      } catch {}
    }
  },
};
