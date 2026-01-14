// commands/verifier_compo.js
// ✅ Vérifier Compo — VERSION OPTIMISÉE, SIMPLE, INTUITIVE (SANS SNAPSHOT)
//
// Objectif : vérifier quels "convoqués" (rôle roles.convoque) ont validé la compo via ✅
// Fonctionnalités conservées / améliorées :
// - message : ID ou lien (optionnel) ; sinon auto-détection (50 derniers messages)
// - salon : où se trouve la compo (option > cfg.compo.channelId > salon courant)
// - salon_rapport : où envoyer le rapport (option > cfg.rapportChannelId > salon courant)
// - rappel : mentionner ceux qui n'ont pas validé (désactivé par défaut)
// - sécurité : permissions, anti-crash, allowedMentions strict, parsing lien robuste
//
// Supprimé : snapshot / fichier / SNAPSHOT_DIR / option enregistrer_snapshot

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const { getConfigFromInteraction } = require('../utils/config');

const DEFAULT_COLOR = 0xff4db8;

/* ===================== Helpers ===================== */
function getEmbedColor(cfg) {
  const hex = cfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

function isValidId(id) {
  return !!id && id !== '0';
}

function parseMessageId(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  // accepte:
  // - ID pur
  // - lien discord .../channels/<guild>/<channel>/<message>
  const m = raw.match(/(\d{17,20})$/);
  return m ? m[1] : null;
}

async function fetchMeSafe(guild) {
  return guild.members.me || (await guild.members.fetchMe().catch(() => null));
}

function chunkMentions(ids, limit = 1900, sep = ' - ') {
  const batches = [];
  let cur = [];
  let curLen = 0;

  for (const id of ids) {
    const mention = `<@${id}>`;
    const addLen = (cur.length ? sep.length : 0) + mention.length;

    if (curLen + addLen > limit) {
      batches.push(cur);
      cur = [id];
      curLen = mention.length;
    } else {
      cur.push(id);
      curLen += addLen;
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

function safeMentionsLine(ids) {
  return ids.length ? ids.map(id => `<@${id}>`).join(' - ') : '_Aucun_';
}

/* ===================== Auto-détection ===================== */
async function detectCompoMessage({ channel, botId, detectMode, footerContains, reactionEmoji }) {
  const fetched = await channel.messages.fetch({ limit: 50 });

  const byFooter = fetched.find(msg =>
    msg.author?.id === botId &&
    msg.embeds?.[0]?.footer?.text &&
    String(msg.embeds[0].footer.text).includes(footerContains)
  );

  const byReaction = fetched.find(msg =>
    msg.author?.id === botId &&
    msg.reactions?.cache?.some(r => r.emoji?.name === reactionEmoji)
  );

  if (detectMode === 'footer') return byFooter || null;
  if (detectMode === 'reaction') return byReaction || null;
  return byFooter || byReaction || null; // footer_or_reaction
}

/* ===================== Commande ===================== */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('verifier_compo')
    .setDescription('Vérifie quels convoqués ont validé une compo (✅).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addStringOption(o =>
      o.setName('message')
        .setDescription('ID ou lien du message de composition (laisser vide pour auto-détection).')
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName('salon')
        .setDescription('Salon où se trouve la compo (défaut : salon compo config ou salon courant).')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName('salon_rapport')
        .setDescription('Salon où envoyer la vérification (défaut : salon rapports ou salon courant).')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addBooleanOption(o =>
      o.setName('rappel')
        .setDescription('Mentionner ceux qui n’ont pas validé (défaut : non).')
        .setRequired(false)
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return;

    const { guild: guildConfig } = getConfigFromInteraction(interaction) || {};
    const cfg = guildConfig || {};

    const convoqueRoleId = cfg?.roles?.convoque || null;
    if (!isValidId(convoqueRoleId)) {
      return interaction.reply({
        content: '❌ Rôle **convoqué** non configuré (`roles.convoque` dans servers.json).',
        ephemeral: true
      }).catch(() => {});
    }

    const embedColor = getEmbedColor(cfg);
    const clubLabel = cfg?.clubName || guild.name || 'INTER GALACTIQUE';

    const rappel = interaction.options.getBoolean('rappel') ?? false;

    // ✅ bot member
    const me = await fetchMeSafe(guild);
    if (!me) {
      return interaction.reply({
        content: '❌ Impossible de récupérer mes permissions (fetchMe).',
        ephemeral: true
      }).catch(() => {});
    }

    // Salon compo : option > cfg.compo.channelId > salon courant
    const compoChannel =
      interaction.options.getChannel('salon') ||
      (isValidId(cfg?.compo?.channelId) ? await guild.channels.fetch(cfg.compo.channelId).catch(() => null) : null) ||
      interaction.channel;

    if (!compoChannel || compoChannel.type !== ChannelType.GuildText || !compoChannel.isTextBased?.()) {
      return interaction.reply({
        content: '❌ Salon de composition invalide.',
        ephemeral: true
      }).catch(() => {});
    }

    // Salon rapport : option > cfg.rapportChannelId > salon courant
    const rapportChannelId = cfg?.rapportChannelId || null;
    const rapportChannel =
      interaction.options.getChannel('salon_rapport') ||
      (isValidId(rapportChannelId) ? await guild.channels.fetch(rapportChannelId).catch(() => null) : null) ||
      interaction.channel;

    if (!rapportChannel || !rapportChannel.isTextBased?.()) {
      return interaction.reply({
        content: '❌ Salon rapport invalide.',
        ephemeral: true
      }).catch(() => {});
    }

    // Permissions d’écriture dans le salon rapport
    const canSend = rapportChannel.permissionsFor(me)?.has([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages
    ]);
    if (!canSend) {
      return interaction.reply({
        content: `❌ Je ne peux pas écrire dans <#${rapportChannel?.id || 'inconnu'}>.`,
        ephemeral: true
      }).catch(() => {});
    }

    await interaction.reply({
      content: '🔎 Vérification de la composition en cours…',
      ephemeral: true
    }).catch(() => {});

    /* ===================== Récupération message compo ===================== */
    let compoMessage = null;
    const messageInput = interaction.options.getString('message');

    // config détection
    const detectMode = String(cfg?.compo?.detectMode || 'footer_or_reaction').toLowerCase(); // footer|reaction|footer_or_reaction
    const footerContains = String(cfg?.compo?.footerContains || 'Compo officielle');
    const reactionEmoji = String(cfg?.compo?.reactionEmoji || '✅');

    if (messageInput) {
      const messageId = parseMessageId(messageInput);
      if (!messageId) {
        return interaction.editReply({
          content: '❌ `message` invalide. Donne un ID (17-20 chiffres) ou un lien Discord du message.'
        }).catch(() => {});
      }

      compoMessage = await compoChannel.messages.fetch(messageId).catch(() => null);
      if (!compoMessage) {
        return interaction.editReply({
          content: `❌ Message introuvable dans <#${compoChannel.id}> (ID: \`${messageId}\`).`
        }).catch(() => {});
      }
    } else {
      try {
        compoMessage = await detectCompoMessage({
          channel: compoChannel,
          botId: me.id,
          detectMode,
          footerContains,
          reactionEmoji
        });
      } catch (err) {
        console.error('Erreur recherche compo auto :', err);
        return interaction.editReply(
          '❌ Erreur lors de la recherche automatique de la composition.\n' +
          '➡️ Relance avec l’option `message` (ID ou lien du message).'
        ).catch(() => {});
      }

      if (!compoMessage) {
        return interaction.editReply(
          '❌ Impossible de trouver automatiquement un message de composition dans ce salon.\n' +
          '➡️ Relance avec l’option `message` (ID ou lien du message).'
        ).catch(() => {});
      }
    }

    /* ===================== Membres / convoqués ===================== */
    await guild.members.fetch().catch(() => {});

    const convoques = guild.members.cache.filter(
      m => !m.user.bot && m.roles.cache.has(convoqueRoleId)
    );

    if (!convoques.size) {
      return interaction.editReply('ℹ️ Aucun convoqué trouvé (rôle vide).').catch(() => {});
    }

    /* ===================== Qui a validé (✅) ? ===================== */
    const validesSet = new Set();

    const reaction = compoMessage.reactions.cache.find(r => r.emoji?.name === '✅');
    if (reaction) {
      const users = await reaction.users.fetch().catch(() => null);
      if (users) {
        users.forEach(u => { if (!u.bot) validesSet.add(u.id); });
      }
    }

    const valides = [];
    const nonValides = [];

    for (const m of convoques.values()) {
      (validesSet.has(m.id) ? valides : nonValides).push(m);
    }

    /* ===================== Rendu ===================== */
    const url = `https://discord.com/channels/${guild.id}/${compoChannel.id}/${compoMessage.id}`;

    const rowBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Voir la compo')
        .setStyle(ButtonStyle.Link)
        .setURL(url)
    );

    // Mentions (rappel)
    const nonValidesIds = nonValides.map(m => m.id);

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('📋 Vérification de la composition')
      .setDescription([
        `📨 Message : [Lien vers la compo](${url})`,
        `👥 Convoqués : **${convoques.size}**`,
        `✅ Validé : **${valides.length}**`,
        `⏳ Non validé : **${nonValides.length}**`
      ].join('\n'))
      .addFields(
        { name: `✅ Validé (${valides.length})`, value: safeMentionsLine(valides.map(m => m.id)).slice(0, 1024) },
        { name: `⏳ Non validé (${nonValides.length})`, value: safeMentionsLine(nonValidesIds).slice(0, 1024) }
      )
      .setFooter({ text: `${clubLabel} • Vérification compo` })
      .setTimestamp();

    // Envoi rapport
    await rapportChannel.send({
      content: undefined,
      embeds: [embed],
      components: [rowBtn],
      allowedMentions: { parse: [] }
    }).catch(() => {});

    // Rappel en messages séparés si demandé (évite dépasser 2000 chars)
    if (rappel && nonValidesIds.length) {
      const header = [
        `📣 **Rappel validation compo**`,
        `Merci de valider la composition avec ✅.`,
        `➡️ ${url}`
      ].join('\n');

      const batches = chunkMentions(nonValidesIds, 1900, ' - ');
      const first = batches.shift();

      if (first?.length) {
        await rapportChannel.send({
          content: `${header}\n\n${first.map(id => `<@${id}>`).join(' - ')}`,
          allowedMentions: { users: first, parse: [] }
        }).catch(() => {});
      }

      for (const batch of batches) {
        await rapportChannel.send({
          content: batch.map(id => `<@${id}>`).join(' - '),
          allowedMentions: { users: batch, parse: [] }
        }).catch(() => {});
      }
    }

    return interaction.editReply(
      `✅ Vérification terminée. Rapport envoyé dans <#${rapportChannel.id}>.`
    ).catch(() => {});
  }
};
