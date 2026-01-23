const { Events } = require("discord.js");
const { error } = require("../../core/logger");
const { handleDispoButton } = require("../../core/disposButtons");

module.exports = {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction, client) {
    try {
      // 1) Boutons DISPOS
      if (interaction.isButton()) {
        const handled = await handleDispoButton(interaction);
        if (handled) return;
      }

      // 2) Slash commands
      if (!interaction.isChatInputCommand()) return;

      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;

      await cmd.execute(interaction, client);
    } catch (e) {
      error("Erreur interactionCreate:", e);

      const payload = { content: "Une erreur est survenue.", flags: 64 };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },
};
