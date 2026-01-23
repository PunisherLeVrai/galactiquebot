const { Events } = require("discord.js");
const { warn } = require("../../core/logger");
const { handleDisposWeekButton } = require("../../core/disposWeekButtons");

const FLAGS_EPHEMERAL = 64;

module.exports = {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction, client) {
    try {
      // 1) Boutons dispos semaine
      if (interaction.isButton()) {
        const handled = await handleDisposWeekButton(interaction);
        if (handled) return;
      }

      // 2) Slash
      if (!interaction.isChatInputCommand()) return;

      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;

      await cmd.execute(interaction, client);
    } catch (err) {
      warn("Erreur interactionCreate :", err);
      const payload = { content: "Erreur.", flags: FLAGS_EPHEMERAL };
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch {}
    }
  },
};
