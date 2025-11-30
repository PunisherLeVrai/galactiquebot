// commands/support.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');

const { getConfigFromInteraction, getGlobalConfig } = require('../utils/config');

const DEFAULT_COLOR = 0xff4db8;

function getEmbedColor(cfg) {
  const hex = cfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('support')
    .setDescription('Commande réservée au développeur du bot (support & diagnostic).'),

  async execute(interaction) {
    const OWNER_ID = process.env.OWNER_ID;

    // Sécurité dev
    if (!OWNER_ID || interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: '⛔ Cette commande est réservée au développeur du bot.',
        flags: MessageFlags.Ephemeral
      });
    }

    const client = interaction.client;

    // Récup config pour couleur + label
    const globalCfg = getGlobalConfig() || {};
    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};
    const color = getEmbedColor(guildCfg);
    const botLabel =
      guildCfg?.clubName ||
      globalCfg.botName ||
      client.user.username ||
      'GalactiqueBot';

    // Uptime : convertir en timestamp de démarrage
    const nowMs = Date.now();
    const startedAtUnix = Math.floor((nowMs - process.uptime() * 1000) / 1000);

    // Liste des serveurs (max 10 pour rester lisible)
    const guildLines = client.guilds.cache
      .map(g => `• **${g.name}** (\`${g.id}\`) — ${g.memberCount ?? '??'} membres`)
      .slice(0, 10);

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`🛠️ Support développeur — ${botLabel}`)
      .addFields(
        {
          name: '🤖 Bot',
          value: `Nom : **${client.user.username}**\nID : \`${client.user.id}\``,
          inline: false
        },
        {
          name: '🌍 Serveurs',
          value: `Connecté sur **${client.guilds.cache.size}** serveur(s).`,
          inline: true
        },
        {
          name: '🏓 Latence',
          value: `**${client.ws.ping} ms**`,
          inline: true
        },
        {
          name: '🖥️ Hébergement',
          value: '**Railway**',
          inline: true
        },
        {
          name: '👨‍💻 Développeur',
          value: `<@${OWNER_ID}>`,
          inline: false
        },
        {
          name: '📅 Uptime',
          value: `<t:${startedAtUnix}:R>`,
          inline: false
        },
        {
          name: '📂 Détail des serveurs (aperçu)',
          value: guildLines.join('\n') || '_Aucun serveur en cache_',
          inline: false
        }
      )
      .setFooter({ text: `${botLabel} • Support développeur` })
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
};
