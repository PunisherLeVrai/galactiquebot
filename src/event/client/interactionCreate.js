const { error } = require("../../core/logger");

module.exports = {
  name: "interactionCreate",

  async execute(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;

    try {
      await cmd.execute(interaction, client);
    } catch (err) {
      error(err);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: "Erreur interne.", ephemeral: true });
      } else {
        await interaction.reply({ content: "Erreur interne.", ephemeral: true });
      }
    }
  }
};
