// commands/verifier_compo.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const { getConfigFromInteraction } = require('../utils/config');
const { SNAPSHOT_DIR } = require('../utils/paths');

const DEFAULT_COLOR = 0xff4db8;

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

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

/**
 * Date ISO en timezone Paris
 */
function getParisISODate() {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t)?.value;
  const y = get('year');
  const m = get('month');
  const d = get('day');
  return `${y}-${m}-${d}`;
}

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
    )
    .addBooleanOption(o =>
      o.setName('enregistrer_snapshot')
        .setDescription('Enregistrer un snapshot (persistant) du résultat (défaut : non).')
        .setRequired(false)
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return;

    const { guild: guildConfig } = getConfigFromInteraction(interaction) || {};
    const cfg = guildConfig || {};

    const convoqueRoleId = cfg?.roles?.convoque || null;
    const embedColor = getEmbedColor(cfg);
    const clubLabel = cfg?.clubName || guild.name || 'INTER GALACTIQUE';

    const rappel = interaction.options.getBoolean('rappel') ?? false;
    const enregistrer = interaction.options.getBoolean('enregistrer_snapshot') ?? false;

    if (!isValidId(convoqueRoleId)) {
      return interaction.reply({
        content: '❌ Rôle **convoqué** non configuré (`roles.convoque` dans servers.json).',
        ephemeral: true
      });
    }

    // Salon compo : option > cfg.compo.channelId > salon courant
    const compoChannel =
      interaction.options.getChannel('salon') ||
      (isValidId(cfg?.compo?.channelId) ? await guild.channels.fetch(cfg.compo.channelId).catch(() => null) : null) ||
      interaction.channel;

    if (!compoChannel || compoChannel.type !== ChannelType.GuildText) {
      return interaction.reply({
        content: '❌ Salon de composition invalide.',
        ephemeral: true
      });
    }

    const rapportChannelId = cfg?.rapportChannelId || null;
    const rapportChannel =
      interaction.options.getChannel('salon_rapport') ||
      (isValidId(rapportChannelId) ? guild.channels.cache.get(rapportChannelId) : null) ||
      interaction.channel;

    const me = guild.members.me;
    if (!rapportChannel?.permissionsFor(me)?.has(['ViewChannel', 'SendMessages'])) {
      return interaction.reply({
        content: `❌ Je ne peux pas écrire dans <#${rapportChannel?.id || 'inconnu'}>.`,
        ephemeral: true
      });
    }

    await interaction.reply({
      content: '🔎 Vérification de la composition en cours…',
      ephemeral: true
    });

    // --- Récupération du message de compo ---
    let messageIdInput = interaction.options.getString('message');
    let compoMessage = null;

    // config compo detection
    const detectMode = (cfg?.compo?.detectMode || 'footer_or_reaction').toLowerCase();
    const footerContains = String(cfg?.compo?.footerContains || 'Compo officielle');
    const reactionEmoji = String(cfg?.compo?.reactionEmoji || '✅');

    if (messageIdInput) {
      messageIdInput = messageIdInput.trim();
      const linkMatch = messageIdInput.match(/\/(\d{17,20})$/);
      if (linkMatch) messageIdInput = linkMatch[1];

      try {
        compoMessage = await compoChannel.messages.fetch(messageIdInput);
      } catch {
        return interaction.editReply({
          content: `❌ Message introuvable dans <#${compoChannel.id}> (ID: \`${messageIdInput}\`).`
        });
      }
    } else {
      // Auto-détection : on regarde les 50 derniers messages du salon
      try {
        const fetched = await compoChannel.messages.fetch({ limit: 50 });

        // 1) Footer (si mode le permet)
        const byFooter = fetched.find(msg =>
          msg.author.id === me.id &&
          msg.embeds?.[0]?.footer?.text &&
          String(msg.embeds[0].footer.text).includes(footerContains)
        );

        // 2) Réaction (si mode le permet)
        const byReaction = fetched.find(msg =>
          msg.author.id === me.id &&
          msg.reactions?.cache?.some(r => r.emoji?.name === reactionEmoji)
        );

        if (detectMode === 'footer') compoMessage = byFooter || null;
        else if (detectMode === 'reaction') compoMessage = byReaction || null;
        else compoMessage = byFooter || byReaction || null;

        if (!compoMessage) {
          return interaction.editReply(
            '❌ Impossible de trouver automatiquement un message de composition dans ce salon.\n' +
            '➡️ Relance avec l’option `message` (ID ou lien du message de compo).'
          );
        }
      } catch (err) {
        console.error('Erreur recherche compo auto :', err);
        return interaction.editReply(
          '❌ Erreur lors de la recherche automatique de la composition.\n' +
          '➡️ Relance avec l’option `message` (ID ou lien du message via Discord).'
        );
      }
    }

    // --- Récup membres / convoqués ---
    await guild.members.fetch().catch(() => {});

    const convoques = guild.members.cache.filter(
      m => !m.user.bot && m.roles.cache.has(convoqueRoleId)
    );

    if (!convoques.size) {
      return interaction.editReply('ℹ️ Aucun convoqué trouvé (rôle vide).');
    }

    // --- Qui a réagi ✅ ? ---
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
      if (validesSet.has(m.id)) valides.push(m);
      else nonValides.push(m);
    }

    // --- Snapshot (optionnel) ---
    if (enregistrer) {
      try {
        ensureDir(SNAPSHOT_DIR);
        const dateStr = getParisISODate();

        const snap = {
          type: 'compo',
          guildId: guild.id,
          clubName: clubLabel,
          date: dateStr,
          channelId: compoChannel.id,
          messageId: compoMessage.id,
          convoques: [...convoques.values()].map(m => m.id),
          valides: valides.map(m => m.id),
          non_valides: nonValides.map(m => m.id)
        };

        const filePath = path.join(SNAPSHOT_DIR, `compo-${dateStr}-${compoMessage.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(snap, null, 2), 'utf8');
      } catch (e) {
        console.error('Erreur snapshot compo :', e);
      }
    }

    const url = `https://discord.com/channels/${guild.id}/${compoChannel.id}/${compoMessage.id}`;

    const formatMentions = (arr) =>
      arr.length ? arr.map(m => `<@${m.id}>`).join(' - ') : '_Aucun_';

    const rowBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Voir la compo')
        .setStyle(ButtonStyle.Link)
        .setURL(url)
    );

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('📋 Vérification de la composition')
      .setDescription([
        `📨 Message : [Lien vers la compo](${url})`,
        `👥 Convoqués : **${convoques.size}**`,
        `✅ Validé : **${valides.length}**`,
        `⏳ Non validé : **${nonValides.length}**`,
        enregistrer ? '💾 Snapshot enregistré (persistant).' : ''
      ].filter(Boolean).join('\n'))
      .addFields(
        { name: '✅ Validé', value: formatMentions(valides).slice(0, 1024) },
        { name: '⏳ Non validé', value: formatMentions(nonValides).slice(0, 1024) }
      )
      .setFooter({ text: `${clubLabel} • Vérification compo` })
      .setTimestamp();

    const nonValidesIds = nonValides.map(m => m.id);

    await rapportChannel.send({
      content: rappel && nonValidesIds.length
        ? nonValidesIds.map(id => `<@${id}>`).join(' - ')
        : undefined,
      embeds: [embed],
      components: [rowBtn],
      allowedMentions: rappel && nonValidesIds.length
        ? { users: nonValidesIds, parse: [] }
        : { parse: [] }
    });

    await interaction.editReply(
      `✅ Vérification terminée. Rapport envoyé dans <#${rapportChannel.id}>.`
    );
  }
};
