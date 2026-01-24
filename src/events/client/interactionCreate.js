// src/events/client/interactionCreate.js
// Router interactions (slash + buttons) — CommonJS
// ✅ Dispo buttons
// ✅ Slash commands
// ✅ Anti "interaction failed" : on laisse les handlers buttons ACK eux-mêmes

const { warn } = require("../../core/logger");
const { handleDispoButton } = require("../../core/disposWeekButtonsHandler");

module.exports = {
  name: "interactionCreate",
  once: false,

  async execute(interaction, client) {
    try {
      // ----- BUTTONS (DISPOS) -----
      if (interaction.isButton()) {
        const cid = interaction.customId || "";

        // Dispos: tout ce qui commence par "dispo:"
        if (cid.startsWith("dispo:")) {
          await handleDispoButton(interaction);
          return;
        }

        // Autres boutons: on ignore (ne pas répondre pour éviter conflits)
        return;
      }

      // ----- SELECT MENUS / MODALS -----
      // /setup utilise des collectors locaux, donc on ignore ici volontairement
      if (interaction.isAnySelectMenu?.() || interaction.isModalSubmit?.()) return;

      // ----- SLASH COMMANDS -----
      if (!interaction.isChatInputCommand()) return;

      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) {
        // Commande supprimée / non déployée: réponse safe
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "⚠️", ephemeral: true });
          }
        } catch {}
        return;
      }

      await cmd.execute(interaction, client);
    } catch (err) {
      warn("Erreur interactionCreate:", err);

      // Réponse safe
      try {
        if (interaction.isRepliable?.() === false) return;

        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ content: "⚠️" }).catch(() => {});
          return;
        }

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "⚠️", ephemeral: true }).catch(() => {});
          return;
        }

        await interaction.followUp({ content: "⚠️", ephemeral: true }).catch(() => {});
      } catch {}
    }
  },
};
