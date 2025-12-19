// commands/compo.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType
} = require('discord.js');

const { getConfigFromInteraction } = require('../utils/config');

const DEFAULT_COLOR = 0xff4db8;

// 🔒 Anti-mentions dans les textes libres (embed)
const sanitize = (t) =>
  String(t || '').replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]');

function getEmbedColor(cfg) {
  const hex = cfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compo')
    .setDescription('Gère les messages de composition des matchs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // 🔹 /compo publier
    .addSubcommand(sc =>
      sc.setName('publier')
        .setDescription('Publie une composition officielle pour un match.')

        // ⚠️ IMPORTANT : option OBLIGATOIRE en PREMIER
        .addStringOption(opt =>
          opt.setName('texte')
            .setDescription('Texte de la compo (liste des joueurs, consignes, etc.).')
            .setRequired(true)
        )

        // Puis seulement les options facultatives
        .addChannelOption(opt =>
          opt.setName('salon')
            .setDescription('Salon où publier la compo (défaut : salon courant).')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('titre')
            .setDescription('Titre de la compo (défaut : "📋 Composition du match").')
            .setRequired(false)
        )
        .addAttachmentOption(opt =>
          opt.setName('image')
            .setDescription('Image de compo (optionnel).')
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt.setName('mention_convoques')
            .setDescription('Mentionner le rôle des convoqués configuré dans le bot.')
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt.setName('mention_everyone')
            .setDescription('Mentionner @everyone en plus (optionnel).')
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt.setName('reactions')
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
      return interaction.reply({ content: '❌ Cette commande doit être utilisée dans un serveur.', ephemeral: true }).catch(() => {});
    }

    // ✅ “me” peut être null selon le cache → fetchMe
    let me = guild.members.me;
    if (!me) {
      me = await guild.members.fetchMe().catch(() => null);
    }
    if (!me) {
      return interaction.reply({ content: '❌ Impossible de récupérer mes permissions (fetchMe).', ephemeral: true }).catch(() => {});
    }

    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};
    const color = getEmbedColor(guildCfg);
    const clubName = guildCfg?.clubName || guild.name || 'INTER GALACTIQUE';
    const convoqueRoleId = guildCfg?.roles?.convoque || null;

    const channel = interaction.options.getChannel('salon') || interaction.channel;
    const titreInput = interaction.options.getString('titre');
    let texte = interaction.options.getString('texte', true);
    const image = interaction.options.getAttachment('image') || null;
    const mentionConvoques = interaction.options.getBoolean('mention_convoques') ?? false;
    const mentionEveryone = interaction.options.getBoolean('mention_everyone') ?? false;
    const reactionsOpt = interaction.options.getBoolean('reactions');
    const shouldReact = reactionsOpt ?? true; // défaut : vrai

    // salon valide texte
    if (!channel || channel.type !== ChannelType.GuildText || !channel.isTextBased?.()) {
      return interaction.reply({
        content: '❌ Salon invalide pour publier la composition.',
        ephemeral: true
      }).catch(() => {});
    }

    // Permissions minimales
    const permList = [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.EmbedLinks
    ];
    if (shouldReact) permList.push(PermissionsBitField.Flags.AddReactions);

    const neededPerms = new PermissionsBitField(permList);
    if (!channel.permissionsFor(me)?.has(neededPerms)) {
      return interaction.reply({
        content: `❌ Je n’ai pas les permissions nécessaires dans ${channel} (voir, écrire, embed${shouldReact ? ', réactions' : ''}).`,
        ephemeral: true
      }).catch(() => {});
    }

    await interaction.reply({
      content: `🛠️ Publication de la composition dans ${channel}...`,
      ephemeral: true
    }).catch(() => {});

    // Nettoyage des mentions sauvages dans l'embed
    texte = sanitize(texte || '').trim();
    const titre = (sanitize(titreInput || '📋 Composition du match').trim()) || '📋 Composition du match';

    const descFinale = [
      texte,
      '',
      '✅ **Réagissez avec cette réaction pour valider votre présence.**'
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(titre)
      .setDescription(descFinale)
      .setFooter({ text: `${clubName} ⚫ Compo officielle` }) // ✅ marqueur (footerContains)
      .setTimestamp();

    if (image) embed.setImage(image.url);

    // --- Mentions (contenu) ---
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
          '⚠️ Rôle **convoqué** non configuré (`roles.convoque`). Compo envoyée sans mention de ce rôle.\n';
      }
    }

    const content = contentParts.join(' ').trim() || undefined;

    let msg;
    try {
      msg = await channel.send({ content, embeds: [embed], allowedMentions });
    } catch (err) {
      console.error('Erreur envoi compo :', err);
      return interaction.editReply({ content: '❌ Erreur lors de l’envoi de la compo (voir logs du bot).' }).catch(() => {});
    }

    if (msg && shouldReact) {
      try { await msg.react('✅'); } catch (e) { console.error('Erreur réaction ✅ sur compo :', e); }
    }

    const lien = `https://discord.com/channels/${guild.id}/${channel.id}/${msg.id}`;

    return interaction.editReply({
      content: [
        warning,
        '✅ **Composition publiée avec succès.**',
        `📨 Salon : ${channel}`,
        `🔗 Lien : ${lien}`
      ].filter(Boolean).join('\n')
    }).catch(() => {});
  }
};
