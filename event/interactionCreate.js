// events/interactionCreate.js
const { getGuildConfig } = require('../utils/config');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // ✅ Bouton validation loge
    if (interaction.isButton()) {
      if (!interaction.customId.startsWith('loge_accept:')) return;

      // customId = "loge_accept:<guildId>:<userId>"
      const [, guildId, userId] = interaction.customId.split(':');

      // sécurité serveur
      if (!interaction.guild || interaction.guild.id !== guildId) {
        return interaction.reply({ content: '❌ Contexte invalide.', ephemeral: true });
      }

      // seul le joueur concerné peut valider
      if (interaction.user.id !== userId) {
        return interaction.reply({
          content: '❌ Ce bouton ne te concerne pas.',
          ephemeral: true
        });
      }

      // désactiver le bouton
      const disabledRow = interaction.message.components?.map(row => {
        row.components.forEach(c => c.setDisabled(true));
        return row;
      });

      // update message original
      await interaction.update({
        content: `${interaction.message.content}\n\n✅ <@${userId}> a **lu et accepté le règlement officiel**.`,
        components: disabledRow || []
      });

      // log staff (optionnel)
      const cfg = getGuildConfig(interaction.guild.id) || {};
      const logChannelId = cfg.logChannelId;

      if (logChannelId) {
        const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
        if (logChannel?.isTextBased()) {
          await logChannel.send(`📜 Validation règlement : <@${userId}>`).catch(() => {});
        }
      }

      return;
    }

    // ⬇️ si tu as d’autres interactions (select menus, etc.), elles restent ici
  }
};
