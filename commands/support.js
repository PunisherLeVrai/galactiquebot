const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('support')
    .setDescription('Commande réservée au développeur du bot (support & diagnostic).'),

  async execute(interaction) {
    const OWNER_ID = process.env.OWNER_ID;

    // 🔐 Sécurité développeur
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: '⛔ Cette commande est réservée au développeur du bot.',
        flags: MessageFlags.Ephemeral
      });
    }

    const client = interaction.client;

    const embed = new EmbedBuilder()
      .setColor(0xff4db8)
      .setTitle('🛠️ Support développeur — GalactiqueBot')
      .addFields(
        {
          name: '🤖 Bot',
          value: `Nom : **${client.user.username}**\nID : \`${client.user.id}\``,
          inline: false
        },
        {
          name: '🌍 Serveurs',
          value: `Connecté sur **${client.guilds.cache.size} serveur(s)**`,
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
          value: `<t:${Math.floor(process.uptime())}:R>`,
          inline: false
        }
      )
      .setFooter({ text: 'GalactiqueBot • Support développeur' })
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
};
