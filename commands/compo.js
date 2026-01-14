// commands/compo.js
// ✅ Version optimisée, robuste et intuitive
// - /compo publier (texte requis + options)
// - Mentions sécurisées (aucun ping sauvage)
// - Mentions contrôlées : @everyone (option) + rôle convoqués (option)
// - Permissions vérifiées proprement (send/embed + réactions si activées)
// - Nettoyage anti-mentions dans le contenu embed
// - Messages d’erreur clairs + comportement par défaut cohérent

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType
} = require('discord.js');

const { getConfigFromInteraction, getGlobalConfig } = require('../utils/config');

const DEFAULT_COLOR = 0xff4db8;

/* ===================== HELPERS ===================== */
function sanitize(text) {
  return String(text || '')
    .replace(/^["“”]|["“”]$/g, '')
    .replace(/@everyone|@here|<@&\d+>|<@!?(\d+)>/g, '[mention bloquée 🚫]')
    .trim();
}

function getEmbedColorFromCfg(guildCfg) {
  const hex = guildCfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;

  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

function canSendIn(channel, me, shouldReact) {
  const perms = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks
  ];
  if (shouldReact) perms.push(PermissionsBitField.Flags.AddReactions);

  const needed = new PermissionsBitField(perms);
  return channel.permissionsFor(me)?.has(needed) ?? false;
}

async function getBotMember(guild) {
  // guild.members.me peut être null si cache incomplet
  return guild.members.me || guild.members.fetchMe().catch(() => null);
}

/* ===================== COMMAND ===================== */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('compo')
    .setDescription('Gère les messages de composition des matchs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sc =>
      sc
        .setName('publier')
        .setDescription('Publie une composition officielle pour un match.')

        // ✅ IMPORTANT : requis en premier
        .addStringOption(opt =>
          opt
            .setName('texte')
            .setDescription('Texte de la compo (joueurs, consignes, etc.).')
            .setRequired(true)
            .setMaxLength(1800)
        )

        .addChannelOption(opt =>
          opt
            .setName('salon')
            .setDescription('Salon où publier la compo (défaut : salon courant).')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )

        .addStringOption(opt =>
          opt
            .setName('titre')
            .setDescription('Titre (défaut : "📋 Composition du match").')
            .setRequired(false)
            .setMaxLength(120)
        )

        .addAttachmentOption(opt =>
          opt
            .setName('image')
            .setDescription('Image de compo (optionnel).')
            .setRequired(false)
        )

        .addBooleanOption(opt =>
          opt
            .setName('mention_convoques')
            .setDescription('Mentionner le rôle des convoqués (config roles.convoque).')
            .setRequired(false)
        )

        .addBooleanOption(opt =>
          opt
            .setName('mention_everyone')
            .setDescription('Mentionner @everyone (optionnel).')
            .setRequired(false)
        )

        .addBooleanOption(opt =>
          opt
            .setName('reactions')
            .setDescription('Ajouter automatiquement ✅ (défaut : oui).')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'publier') {
      return interaction.reply({ content: '❌ Sous-commande inconnue.', ephemeral: true }).catch(() => {});
    }

    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({
        content: '❌ Cette commande doit être utilisée dans un serveur.',
        ephemeral: true
      }).catch(() => {});
    }

    // ✅ Config
    const globalCfg = getGlobalConfig() || {};
    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};

    const clubName =
      guildCfg?.clubName ||
      guild.name ||
      globalCfg?.botName ||
      'INTER GALACTIQUE';

    const color = getEmbedColorFromCfg(guildCfg);
    const convoqueRoleId = guildCfg?.roles?.convoque || null;

    // ✅ Options
    const channel = interaction.options.getChannel('salon') || interaction.channel;
    const titreInput = interaction.options.getString('titre');
    const image = interaction.options.getAttachment('image') || null;

    const mentionConvoques = interaction.options.getBoolean('mention_convoques') ?? false;
    const mentionEveryone = interaction.options.getBoolean('mention_everyone') ?? false;

    const reactionsOpt = interaction.options.getBoolean('reactions');
    const shouldReact = reactionsOpt ?? true;

    let texte = interaction.options.getString('texte', true);

    // ✅ Channel validation
    if (!channel || channel.type !== ChannelType.GuildText || !channel.isTextBased?.()) {
      return interaction.reply({
        content: '❌ Salon invalide pour publier la composition.',
        ephemeral: true
      }).catch(() => {});
    }

    // ✅ Bot member
    const me = await getBotMember(guild);
    if (!me) {
      return interaction.reply({
        content: '❌ Impossible de récupérer mes permissions (fetchMe).',
        ephemeral: true
      }).catch(() => {});
    }

    // ✅ Perms
    if (!canSendIn(channel, me, shouldReact)) {
      return interaction.reply({
        content:
          `❌ Je n’ai pas les permissions nécessaires dans ${channel} ` +
          `(voir, écrire, embed${shouldReact ? ', réactions' : ''}).`,
        ephemeral: true
      }).catch(() => {});
    }

    await interaction.reply({
      content: `🛠️ Publication de la composition dans ${channel}…`,
      ephemeral: true
    }).catch(() => {});

    // ✅ Sanitize texte/titre pour éviter pings
    texte = sanitize(texte);
    const titre = (sanitize(titreInput || '📋 Composition du match') || '📋 Composition du match').slice(0, 120);

    const descFinale = [
      texte,
      '',
      '✅ **Réagissez avec ✅ pour valider votre présence.**'
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(titre)
      .setDescription(descFinale)
      .setFooter({ text: `${clubName} ⚫ Compo officielle` })
      .setTimestamp();

    if (image?.url) embed.setImage(image.url);

    // ✅ Mentions contrôlées (content uniquement)
    const contentParts = [];
    const allowedMentions = { parse: [] };
    let warning = '';

    if (mentionEveryone) {
      contentParts.push('@everyone');
      allowedMentions.parse.push('everyone');
    }

    if (mentionConvoques) {
      if (convoqueRoleId && convoqueRoleId !== '0') {
        contentParts.push(`<@&${convoqueRoleId}>`);
        allowedMentions.roles = [convoqueRoleId];
      } else {
        warning =
          '⚠️ Rôle **convoqué** non configuré (`roles.convoque`). Compo envoyée sans mention de ce rôle.';
      }
    }

    const content = contentParts.join(' ').trim() || undefined;

    // ✅ Send
    let msg;
    try {
      msg = await channel.send({
        content,
        embeds: [embed],
        allowedMentions
      });
    } catch (err) {
      console.error('Erreur envoi compo:', err);
      return interaction.editReply({
        content: '❌ Erreur lors de l’envoi de la compo (voir logs du bot).'
      }).catch(() => {});
    }

    // ✅ React
    if (shouldReact) {
      try {
        await msg.react('✅');
      } catch (e) {
        console.error('Erreur réaction ✅ sur compo:', e);
      }
    }

    const lien = `https://discord.com/channels/${guild.id}/${channel.id}/${msg.id}`;

    return interaction.editReply({
      content: [
        warning ? `${warning}\n` : '',
        '✅ **Composition publiée avec succès.**',
        `📨 Salon : ${channel}`,
        `🔗 Lien : ${lien}`
      ].filter(Boolean).join('\n')
    }).catch(() => {});
  }
};
