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
    } catch (e) {
      warn("Erreur interactionCreate:", e);

      // Réponse safe
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "Une erreur est survenue.", ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: "Une erreur est survenue.", ephemeral: true }).catch(() => {});
      }
    }
  },
};
