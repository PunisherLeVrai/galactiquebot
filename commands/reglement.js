// commands/reglement.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  PermissionsBitField
} = require('discord.js');

const { getConfigFromInteraction } = require('../utils/config');

const DEFAULT_COLOR = 0xff4db8;

function getEmbedColor(cfg) {
  const hex = cfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

// Anti-mentions + trim
function sanitize(text) {
  return String(text || '')
    .replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]')
    .trim();
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
          { name: 'Un rôle', value: 'role' }
        )
    )
    .addRoleOption(o =>
      o.setName('role')
        .setDescription('Rôle à mentionner si "Un rôle" est choisi')
        .setRequired(false)
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ Cette commande doit être utilisée dans un serveur.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('salon') || interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText || !channel.isTextBased()) {
      return interaction.reply({ content: '❌ Salon invalide (texte uniquement).', ephemeral: true });
    }

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
    const clubName = guildCfg?.clubName || guild.name || 'CLUB';

    // 🔐 Permissions nécessaires
    const me = guild.members.me;
    const needed = new PermissionsBitField([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.EmbedLinks
    ]);

    if (!channel.permissionsFor?.(me)?.has(needed)) {
      return interaction.reply({
        content: '❌ Je ne peux pas publier ici (permissions manquantes : voir/écrire/embed).',
        ephemeral: true
      });
    }

    await interaction.reply({ content: '🛰️ Publication du règlement…', ephemeral: true });

    const intro = sanitize(
      [
        '> ⚠️ En rejoignant le serveur, tu acceptes ce règlement.',
        '> Tout manquement pourra entraîner **avertissement, suspension ou exclusion**.'
      ].join('\n')
    );

    const fields = [
      {
        name: '🎯 1. RESPECT',
        value: sanitize(
          [
            '- Respect **absolu** envers le **staff, les joueurs et adversaires**.',
            '- Aucun propos **insultant, toxique, raciste, sexiste ou homophobe** ne sera toléré.',
            '- Attitude **positive et professionnelle** exigée.'
          ].join('\n')
        )
      },
      {
        name: '⏰ 2. PRÉSENCE',
        value: sanitize(
          [
            '- Les matchs et sessions sont **obligatoires**.',
            '- Préviens toute **absence au moins 2h à l’avance**.',
            '- Une inactivité / absence non justifiée prolongée peut mener à un retrait.'
          ].join('\n')
        )
      },
      {
        name: '📅 3. DISPONIBILITÉS',
        value: sanitize(
          [
            '- Indique tes **dispos avant 17h** chaque jour dans le salon prévu.',
            '- Le non-respect peut impacter ta participation.'
          ].join('\n')
        )
      },
      {
        name: '⚽ 4. COMPOS',
        value: sanitize(
          [
            '- Publiées à partir de **17h**, validation avant **19h**.',
            '- Les **horaires de validation peuvent varier** selon les événements.',
            '- Les **compositions ne doivent pas être discutées**.',
            '- Retard ou oubli répété = suivi négatif.'
          ].join('\n')
        )
      },
      {
        name: '🎧 5. MATCHS',
        value: sanitize(
          [
            '- **Micro obligatoire**.',
            '- Reste **calme, concentré**, et **constructif**.',
            '- Les décisions tactiques reviennent au **coach ou capitaine**.'
          ].join('\n')
        )
      },
      {
        name: '🧩 6. DISCIPLINE',
        value: sanitize(
          [
            '- Respecte **consignes, rôle et plan de jeu**.',
            '- Reste **fair-play**, même en cas de défaite.',
            '- L’**esprit d’équipe** prime sur tout.'
          ].join('\n')
        )
      },
      {
        name: '🚨 7. SANCTIONS',
        value: '⚠️ **Avertissement** → ⛔ **Suspension** → 💀 **Exclusion**'
      },
      {
        name: '💬 8. DISCORD',
        value: sanitize(
          [
            '- Pas de spam.',
            '- **Pseudo clair** (idéalement identique au jeu).',
            '- Respect des salons et des vocaux.'
          ].join('\n')
        )
      },
      {
        name: '🌌 CONCLUSION',
        value: `Ensemble, faisons briller **${sanitize(clubName)}** ! ✨`
      }
    ];

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`🪐 RÈGLEMENT DU SERVEUR & DU CLUB — ${sanitize(clubName)}`)
      .setDescription(intro)
      .addFields(fields)
      .setFooter({ text: `${sanitize(clubName)} ⚫ Règlement officiel` })
      .setTimestamp();

    const mentionLine = buildMention(mention, role);
    const allowedMentionsHeader =
      mention === 'everyone'
        ? { parse: ['everyone'] }
        : mention === 'here'
        ? { parse: ['everyone'] }
        : mention === 'role'
        ? { roles: [role.id] }
        : { parse: [] };

    try {
      if (mentionLine) {
        await channel.send({ content: mentionLine, allowedMentions: allowedMentionsHeader });
      }
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      await interaction.editReply(`✅ Règlement publié dans <#${channel.id}>.`);
    } catch (e) {
      console.error('Erreur publication règlement :', e);
      await interaction.editReply('❌ Impossible de publier le règlement (permissions ?).');
    }
  }
};
