// commands/disponibilites.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const { getConfigFromInteraction } = require('../utils/config');
const { SNAPSHOT_DIR } = require('../utils/paths');

const VERSION = 'disponibilites v4.0 (clean+persistent snapshots)';
const DEFAULT_COLOR = 0xff4db8;

// 🧹 Anti-mentions accidentelles dans les textes
const sanitize = (t) =>
  String(t || '').replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]');

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

function splitByMessageLimit(allIds, headerText = '', sep = ' - ', limit = 1900) {
  const batches = [];
  let cur = [];
  let curLen = headerText.length;

  for (const id of allIds) {
    const mention = `<@${id}>`;
    const addLen = (cur.length ? sep.length : 0) + mention.length;

    if (curLen + addLen > limit) {
      batches.push(cur);
      cur = [id];
      curLen = headerText.length + mention.length;
    } else {
      cur.push(id);
      curLen += addLen;
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('disponibilites')
    .setDescription('Rapport, rappel, snapshot ou fermeture des disponibilités du jour.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // REQUIRED en premier
    .addStringOption(o =>
      o.setName('jour')
        .setDescription('Jour à vérifier')
        .setRequired(true)
        .addChoices(
          { name: 'Lundi', value: 'lundi' },
          { name: 'Mardi', value: 'mardi' },
          { name: 'Mercredi', value: 'mercredi' },
          { name: 'Jeudi', value: 'jeudi' },
          { name: 'Vendredi', value: 'vendredi' },
          { name: 'Samedi', value: 'samedi' },
          { name: 'Dimanche', value: 'dimanche' }
        )
    )
    .addStringOption(o =>
      o.setName('mode')
        .setDescription('Type de sortie à générer')
        .setRequired(true)
        .addChoices(
          { name: 'Embed simple (non-répondants)', value: 'embed_simple' },
          { name: 'Embed détaillé (✅ / ❌ / ⏳)', value: 'embed_detaille' },
          { name: 'Rappel aux absents (mentions)', value: 'rappel_absents' },
          { name: 'Snapshot (JSON)', value: 'snapshot' },
          { name: 'Verrouiller + snapshot', value: 'verrouiller' }
        )
    )

    // Options facultatives
    .addChannelOption(o =>
      o.setName('salon_dispos')
        .setDescription('Salon où se trouve le message du jour (défaut : salon dispos configuré)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('message_id')
        .setDescription('ID du message du jour (défaut : dispoMessages[jour] en config)')
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName('salon')
        .setDescription('Salon où envoyer le rapport/rappel (défaut : salon rapports configuré ou salon courant)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('role_joueur')
        .setDescription('Rôle Joueur pris en compte (défaut : config)')
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('role_essai')
        .setDescription('Rôle Essai pris en compte (défaut : config)')
        .setRequired(false)
    )
    .addBooleanOption(o =>
      o.setName('annoncer')
        .setDescription('Pour "verrouiller" : annoncer la fermeture dans le salon dispos (défaut : oui)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const jour = interaction.options.getString('jour', true);
    const mode = interaction.options.getString('mode', true);
    const guild = interaction.guild;
    if (!guild) return;

    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};
    const cfg = guildCfg || {};
    const color = getEmbedColor(cfg);
    const clubName = cfg.clubName || guild.name || 'Club';

    const cfgRoles = cfg.roles || {};
    const cfgDispoMessages = cfg.dispoMessages || {};

    // Salon rapport/rappel
    const rapportChannelId = cfg.rapportChannelId || null;
    const salonOption = interaction.options.getChannel('salon') || null;

    let targetChannel =
      salonOption ||
      (isValidId(rapportChannelId) ? await guild.channels.fetch(rapportChannelId).catch(() => null) : null) ||
      interaction.channel;

    if (!targetChannel || !targetChannel.isTextBased()) {
      return interaction.reply({ content: '❌ Salon cible invalide.', ephemeral: true });
    }

    // Salon dispos + messageId
    const mainDispoChannelId = cfg.mainDispoChannelId || null;
    const dispoChannelOption = interaction.options.getChannel('salon_dispos') || null;

    const dispoChannel =
      dispoChannelOption ||
      (isValidId(mainDispoChannelId) ? await guild.channels.fetch(mainDispoChannelId).catch(() => null) : null);

    if (!dispoChannel || !dispoChannel.isTextBased()) {
      return interaction.reply({
        content: '❌ Salon de dispos introuvable. Configure `mainDispoChannelId` ou utilise `salon_dispos`.',
        ephemeral: true
      });
    }

    const messageId =
      interaction.options.getString('message_id') ||
      cfgDispoMessages?.[jour] ||
      null;

    if (!isValidId(messageId)) {
      return interaction.reply({
        content: `❌ ID du message introuvable pour **${jour}**. Configure \`dispoMessages.${jour}\` ou donne \`message_id\`.`,
        ephemeral: true
      });
    }

    // Rôles éligibles
    const roleJoueur =
      interaction.options.getRole('role_joueur') ||
      (isValidId(cfgRoles.joueur) ? guild.roles.cache.get(cfgRoles.joueur) : null);

    const roleEssai =
      interaction.options.getRole('role_essai') ||
      (isValidId(cfgRoles.essai) ? guild.roles.cache.get(cfgRoles.essai) : null);

    if (!roleJoueur && !roleEssai) {
      return interaction.reply({
        content: '❌ Aucun rôle Joueur/Essai trouvé (options ou config).',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    // Fetch message
    let message;
    try {
      message = await dispoChannel.messages.fetch(messageId);
    } catch {
      return interaction.editReply({
        content: `❌ Message introuvable (ID: \`${messageId}\`) dans ${dispoChannel}.`
      });
    }

    await guild.members.fetch().catch(() => {});

    // Bouton vers le message du jour
    const messageURL = `https://discord.com/channels/${guild.id}/${dispoChannel.id}/${message.id}`;
    const rowBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Voir le message du jour')
        .setStyle(ButtonStyle.Link)
        .setURL(messageURL)
    );

    // Analyse réactions
    const reacted = new Set();
    const yes = new Set();
    const no = new Set();

    for (const [, reaction] of message.reactions.cache) {
      const e = reaction.emoji?.name;
      if (!['✅', '❌'].includes(e)) continue;

      const users = await reaction.users.fetch().catch(() => null);
      if (!users) continue;

      users.forEach(u => {
        if (u.bot) return;
        reacted.add(u.id);
        if (e === '✅') yes.add(u.id);
        else no.add(u.id);
      });
    }

    const eligibles = guild.members.cache.filter(m => {
      if (m.user.bot) return false;
      const hasJ = roleJoueur ? m.roles.cache.has(roleJoueur.id) : false;
      const hasE = roleEssai ? m.roles.cache.has(roleEssai.id) : false;
      return hasJ || hasE;
    });

    const nonRepondus = eligibles.filter(m => !reacted.has(m.id));
    const presentsAll = guild.members.cache.filter(m => !m.user.bot && yes.has(m.id));
    const absentsAll = guild.members.cache.filter(m => !m.user.bot && no.has(m.id));

    const tri = (col) => [...col.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
    const idsLine = (col) => col.size ? tri(col).map(m => `<@${m.id}>`).join(' - ') : '_Aucun_';

    // Snapshot helper (persistant)
    const dateStr = new Date().toISOString().split('T')[0];
    const writeSnapshot = () => {
      ensureDir(SNAPSHOT_DIR);
      const snap = {
        type: 'dispos',
        guildId: guild.id,
        clubName,
        jour,
        date: dateStr,
        messageId: message.id,
        channelId: dispoChannel.id,
        reacted: [...reacted],
        presents: [...yes],
        absents: [...no],
        eligibles: [...eligibles.keys()]
      };
      const snapPath = path.join(SNAPSHOT_DIR, `dispos-${jour}-${dateStr}.json`);
      try { fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2), 'utf8'); } catch {}
      return snapPath;
    };

    // ===== MODES =====

    if (mode === 'embed_simple') {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`📅 RAPPORT - ${jour.toUpperCase()}`)
        .setDescription(
          nonRepondus.size === 0
            ? '✅ **Tout le monde a réagi.**'
            : `**Membres n’ayant pas réagi (${nonRepondus.size}) :**\n${idsLine(nonRepondus)}`
        )
        .setFooter({ text: `${clubName} ⚫ Rapport` })
        .setTimestamp();

      await targetChannel.send({ embeds: [embed], components: [rowBtn], allowedMentions: { parse: [] } });
      return interaction.editReply({ content: `✅ (${VERSION}) Rapport **simple** envoyé → ${targetChannel}` });
    }

    if (mode === 'embed_detaille') {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`📅 RAPPORT - ${jour.toUpperCase()}`)
        .addFields(
          { name: `✅ Présents (${presentsAll.size})`, value: idsLine(presentsAll) },
          { name: `❌ Ont dit absent (${absentsAll.size})`, value: idsLine(absentsAll) },
          { name: `⏳ N’ont pas réagi (${nonRepondus.size})`, value: idsLine(nonRepondus) }
        )
        .setFooter({ text: `${clubName} ⚫ Rapport` })
        .setTimestamp();

      await targetChannel.send({ embeds: [embed], components: [rowBtn], allowedMentions: { parse: [] } });
      return interaction.editReply({ content: `✅ (${VERSION}) Rapport **détaillé** envoyé → ${targetChannel}` });
    }

    if (mode === 'rappel_absents') {
      const ids = [...nonRepondus.values()].map(m => m.id);
      if (!ids.length) return interaction.editReply({ content: `✅ Tout le monde a réagi pour **${jour.toUpperCase()}** !` });

      const header = [
        `📣 **Rappel aux absents (${jour.toUpperCase()})**`,
        'Merci de réagir aux disponibilités du jour ✅❌',
        `➡️ [Accéder au message du jour](${messageURL})`
      ].join('\n');

      const batches = splitByMessageLimit(ids, header + '\n\n');

      const first = batches.shift();
      if (first?.length) {
        await targetChannel.send({
          content: `${header}\n\n${first.map(id => `<@${id}>`).join(' - ')}`,
          allowedMentions: { users: first, parse: [] }
        });
      }
      for (const batch of batches) {
        await targetChannel.send({
          content: batch.map(id => `<@${id}>`).join(' - '),
          allowedMentions: { users: batch, parse: [] }
        });
      }

      return interaction.editReply({ content: `✅ Rappel envoyé dans ${targetChannel} (${ids.length} membre(s)).` });
    }

    if (mode === 'snapshot') {
      const snapPath = writeSnapshot();
      return interaction.editReply({
        content: `✅ Snapshot dispo enregistré (persistant) : \`${path.basename(snapPath)}\` dans SNAPSHOT_DIR.`
      });
    }

    if (mode === 'verrouiller') {
      const annoncer = interaction.options.getBoolean('annoncer') ?? true;

      const snapPath = writeSnapshot();

      // Lock embed (ajoute la ligne)
      try {
        const exist = message.embeds?.[0];
        if (exist) {
          const e = EmbedBuilder.from(exist);
          const desc = sanitize(exist.description || '');
          const lockLine = '🔒 **Disponibilités fermées** – merci de ne plus réagir.';
          if (!desc.includes('Disponibilités fermées')) {
            e.setDescription([desc, '', lockLine].filter(Boolean).join('\n'));
            e.setFooter({ text: `${clubName} ⚫ Disponibilités (fermées)` });
            e.setColor(color);
            await message.edit({ content: '', embeds: [e] });
          }
        }
      } catch {}

      // Clean reactions (si tu veux pareil que le scheduler : décommente)
      // try { await message.reactions.removeAll(); } catch {}

      if (annoncer) {
        try {
          await dispoChannel.send({
            content: sanitize(
              [
                `🔒 **Les disponibilités pour ${jour.toUpperCase()} sont désormais fermées.**`,
                'Merci de votre compréhension.',
                '',
                `➡️ [Voir le message du jour](${messageURL})`
              ].join('\n')
            ),
            allowedMentions: { parse: [] }
          });
        } catch {}
      }

      // Envoi du rapport détaillé dans le salon cible (embed + bouton)
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`🔒 FERMETURE - ${jour.toUpperCase()}`)
        .addFields(
          { name: `✅ Présents (${presentsAll.size})`, value: idsLine(presentsAll) },
          { name: `❌ Absents (${absentsAll.size})`, value: idsLine(absentsAll) },
          { name: `⏳ Sans réaction (${nonRepondus.size})`, value: idsLine(nonRepondus) }
        )
        .setFooter({ text: `${clubName} ⚫ Snapshot: ${path.basename(snapPath)}` })
        .setTimestamp();

      await targetChannel.send({ embeds: [embed], components: [rowBtn], allowedMentions: { parse: [] } });

      return interaction.editReply({
        content: `✅ Fermeture OK + snapshot enregistré : \`${path.basename(snapPath)}\``
      });
    }

    return interaction.editReply({ content: '❌ Mode inconnu.' });
  }
};
