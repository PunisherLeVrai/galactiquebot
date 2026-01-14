// events/interactionCreate.js
const { Events } = require('discord.js');
const { getGuildConfig } = require('../utils/config');

module.exports = {
  name: Events.InteractionCreate,

  /**
   * @param {import('discord.js').Interaction} interaction
   */
  async execute(interaction) {
    const client = interaction.client;

    /* ============================================================
       0) TON ANCIEN BOUTON : loge_accept
       - On le laisse PRIORITAIRE
    ============================================================ */
    if (interaction.isButton() && String(interaction.customId || '').startsWith('loge_accept:')) {
      try {
        // customId = "loge_accept:<guildId>:<userId>"
        const [, guildId, userId] = String(interaction.customId).split(':');

        // sécurité serveur
        if (!interaction.guild || interaction.guild.id !== guildId) {
          return interaction.reply({ content: '❌ Contexte invalide.', ephemeral: true }).catch(() => {});
        }

        // seul le joueur concerné peut valider
        if (interaction.user.id !== userId) {
          return interaction.reply({
            content: '❌ Ce bouton ne te concerne pas.',
            ephemeral: true
          }).catch(() => {});
        }

        // désactiver le bouton (clone propre)
        const disabledComponents = interaction.message.components?.map(row => {
          const newRow = row.toJSON();
          newRow.components = newRow.components.map(c => ({ ...c, disabled: true }));
          return newRow;
        }) || [];

        await interaction.update({
          content: `${interaction.message.content}\n\n✅ <@${userId}> a **lu et accepté le règlement officiel**.`,
          components: disabledComponents
        }).catch(() => {});

        // log staff (optionnel)
        const cfg = getGuildConfig(interaction.guild.id) || {};
        const logChannelId = cfg.logChannelId;

        if (logChannelId && logChannelId !== '0') {
          const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
          if (logChannel?.isTextBased()) {
            await logChannel.send(`📜 Validation règlement : <@${userId}>`).catch(() => {});
          }
        }

        return;
      } catch (e) {
        // Évite "This interaction failed"
        if (!interaction.deferred && !interaction.replied) {
          return interaction.reply({
            content: `❌ Erreur validation.\n\`${String(e?.message || e).slice(0, 180)}\``,
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }
    }

    /* ============================================================
       1) ROUTEUR GÉNÉRIQUE
       - nécessite client.commands (Collection)
       - tes commandes exportent :
         execute(interaction)
         handleComponentInteraction(interaction) [optionnel]
         handleModalSubmit(interaction)          [optionnel]
    ============================================================ */
    if (!client?.commands?.get) return;

    try {
      // SLASH
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command?.execute) {
          return interaction.reply({
            content: '⚠️ Commande introuvable ou non chargée.',
            ephemeral: true
          }).catch(() => {});
        }
        return await command.execute(interaction);
      }

      // MODALS
      if (interaction.isModalSubmit()) {
        const customId = String(interaction.customId || '');

        // Route directe si "<cmd>:..."
        const prefix = customId.includes(':') ? customId.split(':')[0] : null;
        if (prefix) {
          const cmd = client.commands.get(prefix);
          if (cmd?.handleModalSubmit) {
            const handled = await cmd.handleModalSubmit(interaction).catch(() => false);
            if (handled) return;
          }
        }

        // Fallback broadcast
        for (const cmd of client.commands.values()) {
          if (!cmd?.handleModalSubmit) continue;
          const handled = await cmd.handleModalSubmit(interaction).catch(() => false);
          if (handled) return;
        }

        return interaction.reply({
          content: '⚠️ Cette fenêtre n’est plus valide. Relance la commande.',
          ephemeral: true
        }).catch(() => {});
      }

      // COMPONENTS (boutons / menus)
      if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const customId = String(interaction.customId || '');

        // Route directe si "<cmd>:..."
        const prefix = customId.includes(':') ? customId.split(':')[0] : null;
        if (prefix) {
          const cmd = client.commands.get(prefix);
          if (cmd?.handleComponentInteraction) {
            const handled = await cmd.handleComponentInteraction(interaction).catch(() => false);
            if (handled) return;
          }
        }

        // Fallback broadcast
        for (const cmd of client.commands.values()) {
          if (!cmd?.handleComponentInteraction) continue;
          const handled = await cmd.handleComponentInteraction(interaction).catch(() => false);
          if (handled) return;
        }

        // Évite un fail si rien ne gère
        if (!interaction.deferred && !interaction.replied) {
          return interaction.reply({
            content: '⚠️ Interaction expirée ou non reconnue.',
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }
    } catch (err) {
      const msg = `❌ Une erreur est survenue.\n\`${String(err?.message || err).slice(0, 180)}\``;

      try {
        if (interaction.deferred) {
          await interaction.editReply({ content: msg }).catch(() => {});
          return;
        }
        if (interaction.replied) {
          await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
          return;
        }
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      } catch {
        // silence
      }
    }
  }
};
