// commands/reglement.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} = require('discord.js');

const { getConfigFromInteraction } = require('../utils/config');

const DEFAULT_COLOR = 0xff4db8; // couleur par défaut

function getEmbedColor(cfg) {
  const hex = cfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

// Anti-mentions
function sanitize(text) {
  return String(text || '').replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]');
}

function buildMention(mention, role) {
  if (mention === 'everyone') return '@everyone';
  if (mention === 'here') return '@here';
  if (mention === 'role' && role) return `<@&${role.id}>`;
  return '';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reglement')
    .setDescription('Publie le règlement officiel du club (sans bouton).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o =>
      o.setName('salon')
        .setDescription('Salon où publier (défaut : salon courant)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('mention')
        .setDescription('Qui mentionner au-dessus du règlement ?')
        .setRequired(false)
        .addChoices(
          { name: 'Aucune', value: 'none' },
          { name: '@everyone', value: 'everyone' },
          { name: '@here', value: 'here' },
          { name: 'Un rôle', value: 'role' },
        )
    )
    .addRoleOption(o =>
      o.setName('role')
        .setDescription('Rôle à mentionner si "Un rôle" est choisi')
        .setRequired(false)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('salon') || interaction.channel;
    const mention = interaction.options.getString('mention') || 'none';
    const role = interaction.options.getRole('role') || null;

    if (mention === 'role' && !role) {
      return interaction.reply({
        content: '❌ Tu as choisi **Un rôle** mais aucun `role` n’a été fourni.',
        ephemeral: true
      });
    }

    // Config dynamique (couleur + nom club)
    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};
    const color = getEmbedColor(guildCfg);
    const clubName =
      guildCfg?.clubName ||
      interaction.guild?.name ||
      'INTER GALACTIQUE';

    // 🔐 Vérifie les permissions avant publication
    const me = interaction.guild.members.me;
    if (!channel.permissionsFor?.(me)?.has(['ViewChannel', 'SendMessages'])) {
      return interaction.reply({
        content: '❌ Je ne peux pas écrire dans ce salon.',
        ephemeral: true
      });
    }

    await interaction.reply({
      content: '🛰️ Publication du règlement…',
      ephemeral: true
    });

    const intro = sanitize(
      '> ⚠️ En rejoignant le serveur, tu acceptes ce règlement.\n' +
      '> Tout manquement pourra entraîner **avertissement, suspension ou exclusion**.'
    );

    const fields = [
      {
        name: '🎯 1. RESPECT',
        value: sanitize(
          '- Respect **absolu** envers le **staff, les joueurs et adversaires**.\n' +
          '- Aucun propos **insultant, toxique, raciste, sexiste ou homophobe** ne sera toléré.\n' +
          '- Attitude **positive et professionnelle** exigée.'
        )
      },
      {
        name: '⏰ 2. PRÉSENCE',
        value: sanitize(
          '- Les matchs et sessions sont **obligatoires**.\n' +
          '- Préviens toute **absence au moins 2h à l’avance**.\n' +
          '- Une absence **non justifiée de 7 jours** peut mener à un retrait.'
        )
      },
      {
        name: '📅 3. DISPONIBILITÉS',
        value: sanitize(
          '- Indique tes **dispos avant 17h** chaque jour dans le salon prévu.\n' +
          '- Le non-respect peut impacter ta participation.'
        )
      },
      {
        name: '⚽ 4. COMPOS',
        value: sanitize(
          '- Publiées à partir de **17h**, validation avant **19h**.\n' +
          '- Les **horaires de validation peuvent varier** selon les événements.\n' +
          '- Les **compositions ne doivent pas être discutées**.\n' +
          '- Retard ou oubli répété = suivi négatif.'
        )
      },
      {
        name: '🎧 5. MATCHS',
        value: sanitize(
          '- **Micro obligatoire**.\n' +
          '- Reste **calme, concentré**, et **constructif**.\n' +
          '- Les décisions tactiques reviennent au **coach ou capitaine**.'
        )
      },
      {
        name: '🧩 6. DISCIPLINE',
        value: sanitize(
          '- Respecte **consignes, rôle et plan de jeu**.\n' +
          '- Reste **fair-play**, même en cas de défaite.\n' +
          '- L’**esprit d’équipe** prime sur tout.'
        )
      },
      {
        name: '🚨 7. SANCTIONS',
        value: '⚠️ **Avertissement** → ⛔ **Suspension** → 💀 **Exclusion**'
      },
      {
        name: '💬 8. DISCORD',
        value: sanitize(
          '- Pas de spam.\n' +
          '- **Pseudo clair et identique** à celui du jeu.\n' +
          '- Respect des salons et des vocaux.'
        )
      },
      {
        name: '🌌 CONCLUSION',
        value: `Ensemble, faisons briller **${clubName}** ! ✨`
      }
    ];

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`🪐 RÈGLEMENT DU SERVEUR & DU CLUB – ${clubName}`)
      .setDescription(intro)
      .addFields(fields)
      .setFooter({ text: `${clubName} ⚫ Règlement officiel` })
      .setTimestamp();

    const mentionLine = buildMention(mention, role);
    const allowedMentions =
      mention === 'everyone'
        ? { parse: ['everyone'] }
        : mention === 'here'
        ? { parse: ['everyone'] } // @here via parse everyone
        : mention === 'role'
        ? { roles: [role.id] }
        : { parse: [] };

    try {
      if (mentionLine) {
        await channel.send({ content: mentionLine, allowedMentions });
      }
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      await interaction.editReply(`✅ Règlement publié dans <#${channel.id}>.`);
    } catch (e) {
      console.error('Erreur publication règlement :', e);
      await interaction.editReply('❌ Impossible de publier le règlement (vérifie mes permissions dans ce salon).');
    }
  }
};
