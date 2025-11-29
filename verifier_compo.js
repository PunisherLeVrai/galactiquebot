// commands/verifier_compo.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  MessageFlags
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getConfigFromInteraction } = require('../utils/config');

const COULEUR = 0xff4db8;
const RAPPORTS_DIR = path.join(__dirname, '../rapports');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verifier_compo')
    .setDescription('Vérifie quels convoqués ont validé une compo.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('message')
        .setDescription('ID ou lien du message de composition')
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName('salon')
        .setDescription('Salon où se trouve la compo (défaut : salon courant)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName('salon_rapport')
        .setDescription('Salon où envoyer la vérification (défaut : salon des rapports ou salon courant)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addBooleanOption(o =>
      o.setName('rappel')
        .setDescription('Mentionner ceux qui n’ont pas validé (défaut : non)')
        .setRequired(false)
    )
    .addBooleanOption(o =>
      o.setName('enregistrer_snapshot')
        .setDescription('Enregistrer un snapshot du résultat (défaut : non)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const guild = interaction.guild;

    // 🔧 Config serveur (via utils/config)
    const { guild: guildConfig } = getConfigFromInteraction(interaction) || {};
    const convoqueRoleId =
      guildConfig?.roles?.convoque || null;

    const rappel = interaction.options.getBoolean('rappel') ?? false;
    const enregistrer = interaction.options.getBoolean('enregistrer_snapshot') ?? false;

    if (!convoqueRoleId) {
      return interaction.reply({
        content: '❌ Rôle **convoqué** non configuré pour ce serveur (roles.convoque).',
        flags: MessageFlags.Ephemeral
      });
    }

    // Salon où se trouve le message de compo
    const compoChannel =
      interaction.options.getChannel('salon') ||
      interaction.channel;

    if (!compoChannel || compoChannel.type !== ChannelType.GuildText) {
      return interaction.reply({
        content: '❌ Salon de composition invalide.',
        flags: MessageFlags.Ephemeral
      });
    }

    // Salon où poster le rapport
    const rapportChannelId =
      guildConfig?.channels?.rapport ||
      guildConfig?.rapportChannelId ||
      null;

    const rapportChannel =
      interaction.options.getChannel('salon_rapport') ||
      (rapportChannelId ? guild.channels.cache.get(rapportChannelId) : null) ||
      interaction.channel;

    const me = guild.members.me;
    if (!rapportChannel?.permissionsFor(me)?.has(['ViewChannel', 'SendMessages'])) {
      return interaction.reply({
        content: `❌ Je ne peux pas écrire dans <#${rapportChannel?.id || 'inconnu'}>.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // ID du message (ou lien)
    let messageId = interaction.options.getString('message', true).trim();
    const linkMatch = messageId.match(/\/(\d{17,20})$/);
    if (linkMatch) messageId = linkMatch[1];

    await interaction.reply({
      content: '🔎 Vérification en cours…',
      flags: MessageFlags.Ephemeral
    });

    // Récupération du message de compo
    let compoMessage;
    try {
      compoMessage = await compoChannel.messages.fetch(messageId);
    } catch {
      return interaction.editReply({
        content: `❌ Message introuvable dans <#${compoChannel.id}> (ID: \`${messageId}\`).`
      });
    }

    await guild.members.fetch().catch(() => {});

    const convoques = guild.members.cache.filter(
      m => !m.user.bot && m.roles.cache.has(convoqueRoleId)
    );

    if (!convoques.size) {
      return interaction.editReply('ℹ️ Aucun convoqué trouvé.');
    }

    // Qui a mis ✅ ?
    const validesSet = new Set();
    for (const [, reaction] of compoMessage.reactions.cache) {
      if (reaction.emoji?.name !== '✅') continue;
      const users = await reaction.users.fetch().catch(() => null);
      if (!users) continue;
      users.forEach(u => { if (!u.bot) validesSet.add(u.id); });
    }

    const valides = [];
    const nonValides = [];

    for (const m of convoques.values()) {
      (validesSet.has(m.id) ? valides : nonValides).push(m);
    }

    // 🌙 Snapshot optionnel
    if (enregistrer) {
      try {
        if (!fs.existsSync(RAPPORTS_DIR)) {
          fs.mkdirSync(RAPPORTS_DIR, { recursive: true });
        }
        const dateStr = new Date().toISOString().split('T')[0];
        const snap = {
          type: 'compo',
          date: dateStr,
          channelId: compoChannel.id,
          messageId: compoMessage.id,
          convoques: convoques.map(m => m.id),
          valides: valides.map(m => m.id),
          non_valides: nonValides.map(m => m.id)
        };
        const filePath = path.join(
          RAPPORTS_DIR,
          `compo-${dateStr}-${compoMessage.id}.json`
        );
        fs.writeFileSync(filePath, JSON.stringify(snap, null, 2), 'utf8');
      } catch (e) {
        console.error('Erreur snapshot compo :', e);
        // non bloquant
      }
    }

    const url = `https://discord.com/channels/${guild.id}/${compoChannel.id}/${compoMessage.id}`;

    const formatMentions = (arr) =>
      arr.length ? arr.map(m => `<@${m.id}>`).join(' - ') : '_Aucun_';

    const embed = new EmbedBuilder()
      .setColor(COULEUR)
      .setTitle('📋 Vérification de la composition')
      .setDescription([
        `📨 Message : [Lien vers la compo](${url})`,
        `👥 Convoqués : **${convoques.size}**`,
        `✅ Validé : **${valides.length}**`,
        `⏳ Non validé : **${nonValides.length}**`,
        enregistrer ? `💾 Snapshot enregistré.` : ''
      ].join('\n'))
      .addFields(
        {
          name: '✅ Validé',
          value: formatMentions(valides).slice(0, 1024)
        },
        {
          name: '⏳ Non validé',
          value: formatMentions(nonValides).slice(0, 1024)
        }
      )
      .setFooter({ text: 'INTER GALACTIQUE • Vérification compo' })
      .setTimestamp();

    const nonValidesIds = nonValides.map(m => m.id);

    await rapportChannel.send({
      content: rappel && nonValidesIds.length
        ? nonValidesIds.map(id => `<@${id}>`).join(' - ')
        : undefined,
      embeds: [embed],
      allowedMentions: rappel && nonValidesIds.length
        ? { users: nonValidesIds, parse: [] }
        : { parse: [] }
    });

    await interaction.editReply(
      `✅ Vérification terminée. Rapport envoyé dans <#${rapportChannel.id}>.`
    );
  }
};