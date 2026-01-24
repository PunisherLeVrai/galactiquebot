// src/events/client/interactionCreate.js
// Router interactions (slash + buttons) — CommonJS
// ✅ Dispo buttons
// ✅ Slash commands
// ✅ Gestion erreurs + anti "interaction failed" (defer/reply safe)

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
          // Important : les handlers doivent répondre/defer eux-mêmes.
          await handleDispoButton(interaction);
          return;
        }

        // Autres boutons éventuels => ignore
        return;
      }

      // ----- SELECT MENUS / MODALS -----
      // Tes commandes (/setup) gèrent via collectors, donc rien ici.
      // On ignore volontairement pour éviter conflits.
      if (interaction.isAnySelectMenu?.() || interaction.isModalSubmit?.()) return;

      // ----- SLASH COMMANDS -----
      if (!interaction.isChatInputCommand()) return;

      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) {
        // évite "Unknown interaction" si la commande n'existe plus côté bot
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "⚠️", ephemeral: true });
          }
        } catch {}
        return;
      }

      // Exécution commande
      await cmd.execute(interaction, client);
    } catch (err) {
      warn("Erreur interactionCreate:", err);

      // Réponse safe (évite l'échec d'interaction)
      try {
        if (interaction.isRepliable?.() === false) return;

        if (interaction.deferred) {
          await interaction.followUp({ content: "⚠️", ephemeral: true }).catch(() => {});
          return;
        }

        if (!interaction.replied) {
          await interaction.reply({ content: "⚠️", ephemeral: true }).catch(() => {});
          return;
        }
      } catch {}
    }
  },
};
