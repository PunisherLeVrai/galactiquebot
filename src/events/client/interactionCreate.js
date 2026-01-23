// src/events/client/interactionCreate.js
const { warn } = require("../../core/logger");
const { getGuildConfigSafe } = require("../../core/guildConfig");
const { handleDispoButton } = require("../../core/disposWeekButtons");

module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
    try {
      // 1) Boutons / menus
      if (interaction.isButton()) {
        const guildCfg = interaction.inGuild() ? getGuildConfigSafe(interaction.guildId) : null;

        // handle dispo buttons
        const handled = await handleDispoButton(interaction, guildCfg);
        if (handled) return;
      }

      // 2) Slash commands
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        await command.execute(interaction, client);
      }
    } catch (err) {
      warn("Erreur interactionCreate:", err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "Erreur interne.", flags: 64 });
        }
      } catch {}
    }
  },
};
