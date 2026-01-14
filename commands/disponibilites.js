// commands/disponibilites.js
// ✅ Disponibilités — VERSION OPTIMISÉE + MODES SIMPLIFIÉS (UNIQUEMENT ceux demandés)
//
// Modes conservés :
// - detaille                 -> ✅ Présents / ❌ Absents / ⏳ Sans réaction (filtre Joueur+Essai) / ⏳ Sans réaction (sans filtre)
// - presents                 -> ✅ Présents
// - absents                  -> ❌ Absents
// - sans_reaction_filtre     -> ⏳ Sans réaction (filtre Joueur+Essai)
// - sans_reaction_tous       -> ⏳ Sans réaction (sans filtre : tous les membres humains)
// - rappel_absents           -> 📣 Rappel (mentions) aux "sans réaction filtrés Joueur+Essai"
//
// ✅ Suppression : embed_simple / snapshot / verrouiller
// ✅ Bouton "Voir le message du jour"
// ✅ Anti-mentions accidentelles
// ✅ Gestion permissions minimale + messages chunkés pour le rappel

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
} = require('discord.js');

const { getConfigFromInteraction } = require('../utils/config');

const VERSION = 'disponibilites v5.1 (modes simplifiés)';
const DEFAULT_COLOR = 0xff4db8;

/* ===================== Helpers généraux ===================== */
const sanitize = (t) =>
  String(t || '')
    .replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]')
    .trim();

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

function dayLabelFR(jour) {
  const map = {
    lundi: 'LUNDI',
    mardi: 'MARDI',
    mercredi: 'MERCREDI',
    jeudi: 'JEUDI',
    vendredi: 'VENDREDI',
    samedi: 'SAMEDI',
    dimanche: 'DIMANCHE'
  };
  return map[jour] || String(jour || '').toUpperCase();
}

function sortMembersByName(col) {
  return [...col.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function mentionsLine(col) {
  if (!col || !col.size) return '_Aucun_';
  return sortMembersByName(col).map(m => `<@${m.id}>`).join(' - ');
}

function chunkMentions(ids, headerText = '', sep = ' - ', limit = 1900) {
  const batches = [];
  let cur = [];
  let curLen = headerText.length;

  for (const id of ids) {
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

/* ===================== Réactions ✅/❌ ===================== */
async function extractReactions(message) {
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

  return { reacted, yes, no };
}

function computeHumansAll(guild) {
  return guild.members.cache.filter(m => !m.user.bot);
}

function computeEligiblesWithRoles(guild, roleJoueur, roleEssai) {
  return guild.members.cache.filter(m => {
    if (m.user.bot) return false;
    const hasJ = roleJoueur ? m.roles.cache.has(roleJoueur.id) : false;
    const hasE = roleEssai ? m.roles.cache.has(roleEssai.id) : false;
    return hasJ || hasE;
  });
}

/* ===================== Embeds ===================== */
function buildBaseEmbed({ color, clubName, title }) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setFooter({ text: `${clubName} ⚫ Disponibilités` })
    .setTimestamp();
}

function buildDetailEmbed({
  color,
  clubName,
  jour,
  presentsAll,
  absentsAll,
  nonRepondusFiltre,
  nonRepondusTous
}) {
  return buildBaseEmbed({
    color,
    clubName,
    title: `📅 RAPPORT - ${dayLabelFR(jour)} (DÉTAILLÉ)`
  }).addFields(
    { name: `✅ Présents (${presentsAll.size})`, value: mentionsLine(presentsAll) },
    { name: `❌ Absents (${absentsAll.size})`, value: mentionsLine(absentsAll) },
    { name: `⏳ Sans réaction (Joueur/Essai) (${nonRepondusFiltre.size})`, value: mentionsLine(nonRepondusFiltre) },
    { name: `⏳ Sans réaction (sans filtre) (${nonRepondusTous.size})`, value: mentionsLine(nonRepondusTous) }
  );
}

/* ===================== Commande ===================== */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('disponibilites')
    .setDescription('Rapports & rappels sur les disponibilités du jour (modes simplifiés).')
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
        .setDescription('Sortie à générer')
        .setRequired(true)
        .addChoices(
          { name: 'Mode détaillé (✅/❌/⏳ filtre + ⏳ sans filtre)', value: 'detaille' },
          { name: 'Mode présents (✅)', value: 'presents' },
          { name: 'Mode absents (❌)', value: 'absents' },
          { name: 'Mode sans réaction (filtre Joueur/Essai)', value: 'sans_reaction_filtre' },
          { name: 'Mode sans réaction (sans filtre)', value: 'sans_reaction_tous' },
          { name: 'Mode rappel aux absents (mentions)', value: 'rappel_absents' }
        )
    )

    // Options facultatives
    .addChannelOption(o =>
      o.setName('salon_dispos')
        .setDescription('Salon où se trouve le message du jour (défaut : mainDispoChannelId)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('message_id')
        .setDescription('ID du message du jour (défaut : dispoMessages[jour])')
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName('salon')
        .setDescription('Salon où envoyer le rapport/rappel (défaut : rapportChannelId ou salon courant)')
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

    /* ===== 1) Salon cible (rapport/rappel) ===== */
    const rapportChannelId = cfg.rapportChannelId || null;
    const salonOption = interaction.options.getChannel('salon') || null;

    const targetChannel =
      salonOption ||
      (isValidId(rapportChannelId) ? await guild.channels.fetch(rapportChannelId).catch(() => null) : null) ||
      interaction.channel;

    if (!targetChannel || !targetChannel.isTextBased()) {
      return interaction.reply({ content: '❌ Salon cible invalide.', ephemeral: true }).catch(() => {});
    }

    /* ===== 2) Salon dispos ===== */
    const mainDispoChannelId = cfg.mainDispoChannelId || null;
    const dispoChannelOption = interaction.options.getChannel('salon_dispos') || null;

    const dispoChannel =
      dispoChannelOption ||
      (isValidId(mainDispoChannelId) ? await guild.channels.fetch(mainDispoChannelId).catch(() => null) : null);

    if (!dispoChannel || !dispoChannel.isTextBased()) {
      return interaction.reply({
        content: '❌ Salon de dispos introuvable. Configure `mainDispoChannelId` ou utilise `salon_dispos`.',
        ephemeral: true
      }).catch(() => {});
    }

    /* ===== 3) Message ID ===== */
    const messageId =
      interaction.options.getString('message_id') ||
      cfgDispoMessages?.[jour] ||
      null;

    if (!isValidId(messageId)) {
      return interaction.reply({
        content: `❌ ID du message introuvable pour **${jour}**. Configure \`dispoMessages.${jour}\` ou donne \`message_id\`.`,
        ephemeral: true
      }).catch(() => {});
    }

    /* ===== 4) Rôles (requis pour les modes filtrés + rappel) ===== */
    const roleJoueur =
      interaction.options.getRole('role_joueur') ||
      (isValidId(cfgRoles.joueur) ? guild.roles.cache.get(cfgRoles.joueur) : null);

    const roleEssai =
      interaction.options.getRole('role_essai') ||
      (isValidId(cfgRoles.essai) ? guild.roles.cache.get(cfgRoles.essai) : null);

    const needsRoles =
      mode === 'detaille' ||
      mode === 'sans_reaction_filtre' ||
      mode === 'rappel_absents';

    if (needsRoles && !roleJoueur && !roleEssai) {
      return interaction.reply({
        content: '❌ Aucun rôle Joueur/Essai trouvé (options ou config).',
        ephemeral: true
      }).catch(() => {});
    }

    /* ===== 5) Permissions minimales ===== */
    let me = guild.members.me;
    if (!me) me = await guild.members.fetchMe().catch(() => null);

    if (!me) {
      return interaction.reply({
        content: '❌ Impossible de récupérer mes permissions (fetchMe).',
        ephemeral: true
      }).catch(() => {});
    }

    const readPerms = new PermissionsBitField([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.ReadMessageHistory
    ]);
    if (!dispoChannel.permissionsFor(me)?.has(readPerms)) {
      return interaction.reply({
        content: `❌ Je n’ai pas les permissions pour lire dans ${dispoChannel} (voir + historique).`,
        ephemeral: true
      }).catch(() => {});
    }

    const writePerms = new PermissionsBitField([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.EmbedLinks
    ]);
    if (!targetChannel.permissionsFor(me)?.has(writePerms)) {
      return interaction.reply({
        content: `❌ Je n’ai pas les permissions pour poster dans ${targetChannel} (écrire + embeds).`,
        ephemeral: true
      }).catch(() => {});
    }

    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    /* ===== 6) Fetch message + members ===== */
    let message;
    try {
      message = await dispoChannel.messages.fetch(messageId);
    } catch {
      return interaction.editReply({
        content: `❌ Message introuvable (ID: \`${messageId}\`) dans ${dispoChannel}.`
      }).catch(() => {});
    }

    await guild.members.fetch().catch(() => {});

    const messageURL = `https://discord.com/channels/${guild.id}/${dispoChannel.id}/${message.id}`;
    const rowBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Voir le message du jour')
        .setStyle(ButtonStyle.Link)
        .setURL(messageURL)
    );

    /* ===== 7) Analyse réactions ===== */
    const { reacted, yes, no } = await extractReactions(message);

    const humansAll = computeHumansAll(guild);
    const eligibles = (roleJoueur || roleEssai) ? computeEligiblesWithRoles(guild, roleJoueur, roleEssai) : null;

    const presentsAll = guild.members.cache.filter(m => !m.user.bot && yes.has(m.id));
    const absentsAll = guild.members.cache.filter(m => !m.user.bot && no.has(m.id));

    const nonRepondusTous = humansAll.filter(m => !reacted.has(m.id));
    const nonRepondusFiltre = eligibles ? eligibles.filter(m => !reacted.has(m.id)) : null;

    /* ===== 8) MODES ===== */
    if (mode === 'detaille') {
      const embed = buildDetailEmbed({
        color,
        clubName,
        jour,
        presentsAll,
        absentsAll,
        nonRepondusFiltre,
        nonRepondusTous
      });

      await targetChannel.send({
        embeds: [embed],
        components: [rowBtn],
        allowedMentions: { parse: [] }
      });

      return interaction.editReply({
        content: `✅ (${VERSION}) Rapport **détaillé** envoyé → ${targetChannel}`
      }).catch(() => {});
    }

    if (mode === 'presents') {
      const embed = buildBaseEmbed({
        color,
        clubName,
        title: `✅ PRÉSENTS - ${dayLabelFR(jour)}`
      }).setDescription(mentionsLine(presentsAll));

      await targetChannel.send({
        embeds: [embed],
        components: [rowBtn],
        allowedMentions: { parse: [] }
      });

      return interaction.editReply({
        content: `✅ (${VERSION}) Liste **présents** envoyée → ${targetChannel}`
      }).catch(() => {});
    }

    if (mode === 'absents') {
      const embed = buildBaseEmbed({
        color,
        clubName,
        title: `❌ ABSENTS - ${dayLabelFR(jour)}`
      }).setDescription(mentionsLine(absentsAll));

      await targetChannel.send({
        embeds: [embed],
        components: [rowBtn],
        allowedMentions: { parse: [] }
      });

      return interaction.editReply({
        content: `✅ (${VERSION}) Liste **absents** envoyée → ${targetChannel}`
      }).catch(() => {});
    }

    if (mode === 'sans_reaction_filtre') {
      const embed = buildBaseEmbed({
        color,
        clubName,
        title: `⏳ SANS RÉACTION (Joueur/Essai) - ${dayLabelFR(jour)}`
      }).setDescription(mentionsLine(nonRepondusFiltre));

      await targetChannel.send({
        embeds: [embed],
        components: [rowBtn],
        allowedMentions: { parse: [] }
      });

      return interaction.editReply({
        content: `✅ (${VERSION}) Liste **sans réaction (filtre)** envoyée → ${targetChannel}`
      }).catch(() => {});
    }

    if (mode === 'sans_reaction_tous') {
      const embed = buildBaseEmbed({
        color,
        clubName,
        title: `⏳ SANS RÉACTION (sans filtre) - ${dayLabelFR(jour)}`
      }).setDescription(mentionsLine(nonRepondusTous));

      await targetChannel.send({
        embeds: [embed],
        components: [rowBtn],
        allowedMentions: { parse: [] }
      });

      return interaction.editReply({
        content: `✅ (${VERSION}) Liste **sans réaction (sans filtre)** envoyée → ${targetChannel}`
      }).catch(() => {});
    }

    if (mode === 'rappel_absents') {
      const ids = [...nonRepondusFiltre.values()].map(m => m.id);

      if (!ids.length) {
        return interaction.editReply({
          content: `✅ Tout le monde a réagi (filtre Joueur/Essai) pour **${dayLabelFR(jour)}**.`
        }).catch(() => {});
      }

      const header = sanitize(
        [
          `📣 **Rappel disponibilités — ${dayLabelFR(jour)}**`,
          'Merci de réagir au message du jour ✅❌.',
          `➡️ [Accéder au message du jour](${messageURL})`
        ].join('\n')
      );

      const batches = chunkMentions(ids, header + '\n\n');

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

      return interaction.editReply({
        content: `✅ Rappel envoyé dans ${targetChannel} (${ids.length} membre(s) concernés — filtre Joueur/Essai).`
      }).catch(() => {});
    }

    return interaction.editReply({ content: '❌ Mode inconnu.' }).catch(() => {});
  }
};
