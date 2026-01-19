// commands/disponibilites.js
// ✅ RAPPORTS DISPOS — Présents/Absents SANS filtre + Non répondants FILTRÉS Joueur+Essai
//
// Modes :
// - detaille      -> ✅ Présents (sans filtre) / ❌ Absents (sans filtre) / ⏳ Sans réaction (filtré Joueur+Essai)
// - presents      -> ✅ Présents (sans filtre)
// - absents       -> ❌ Absents (sans filtre)
// - sans_reaction -> ⏳ Sans réaction (filtré Joueur+Essai)
//
// ✅ Bouton "Voir le message du jour"
// ✅ Anti-mentions accidentelles
// ✅ Sans snapshot / sans rappel (rappel déplacé dans /rappeldispos)

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

const VERSION = 'disponibilites v6.1 (présents/absents sans filtre + non-répondants filtrés)';
const DEFAULT_COLOR = 0xff4db8;

/* ===================== Helpers ===================== */
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
  const s = sortMembersByName(col).map(m => `<@${m.id}>`).join(' - ');
  return s.length > 1024 ? (s.slice(0, 1023) + '…') : s;
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
  nonRepondusFiltre
}) {
  return buildBaseEmbed({
    color,
    clubName,
    title: `📅 RAPPORT - ${dayLabelFR(jour)} (DÉTAILLÉ)`
  }).addFields(
    { name: `✅ Présents (sans filtre) (${presentsAll.size})`, value: mentionsLine(presentsAll) },
    { name: `❌ Absents (sans filtre) (${absentsAll.size})`, value: mentionsLine(absentsAll) },
    { name: `⏳ Sans réaction (Joueur/Essai) (${nonRepondusFiltre.size})`, value: mentionsLine(nonRepondusFiltre) }
  );
}

/* ===================== Commande ===================== */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('disponibilites')
    .setDescription('Rapports sur les disponibilités (présents/absents sans filtre + non-répondants filtrés).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

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
          { name: 'Mode détaillé (✅/❌ sans filtre + ⏳ filtre)', value: 'detaille' },
          { name: 'Mode présents (✅ sans filtre)', value: 'presents' },
          { name: 'Mode absents (❌ sans filtre)', value: 'absents' },
          { name: 'Mode sans réaction (⏳ filtre Joueur/Essai)', value: 'sans_reaction' }
        )
    )

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
        .setDescription('Salon où envoyer le rapport (défaut : rapportChannelId ou salon actuel)')
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
    const guild = interaction.guild;
    if (!guild) return;

    const jour = interaction.options.getString('jour', true);
    const mode = interaction.options.getString('mode', true);

    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};
    const cfg = guildCfg || {};
    const color = getEmbedColor(cfg);
    const clubName = cfg.clubName || guild.name || 'Club';

    const cfgRoles = cfg.roles || {};
    const cfgDispoMessages = cfg.dispoMessages || {};

    /* ===== 1) Salon cible ===== */
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

    /* ===== 4) Rôles Joueur/Essai (requis uniquement pour le filtre) ===== */
    const roleJoueur =
      interaction.options.getRole('role_joueur') ||
      (isValidId(cfgRoles.joueur) ? guild.roles.cache.get(cfgRoles.joueur) : null);

    const roleEssai =
      interaction.options.getRole('role_essai') ||
      (isValidId(cfgRoles.essai) ? guild.roles.cache.get(cfgRoles.essai) : null);

    // On a besoin des rôles seulement pour "sans_reaction" et pour le "detaille" (partie ⏳ filtrée)
    const needsRoles = (mode === 'sans_reaction' || mode === 'detaille');
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

    // SANS FILTRE (tous humains)
    const humansAll = computeHumansAll(guild);
    const presentsAll = humansAll.filter(m => yes.has(m.id));
    const absentsAll  = humansAll.filter(m => no.has(m.id));

    // FILTRÉ (Joueur/Essai) uniquement pour non-répondants
    const eligibles = (roleJoueur || roleEssai) ? computeEligiblesWithRoles(guild, roleJoueur, roleEssai) : null;
    const nonRepondusFiltre = eligibles ? eligibles.filter(m => !reacted.has(m.id)) : null;

    /* ===== 8) MODES ===== */
    if (mode === 'detaille') {
      const embed = buildDetailEmbed({
        color,
        clubName,
        jour,
        presentsAll,
        absentsAll,
        nonRepondusFiltre
      });

      await targetChannel.send({
        embeds: [embed],
        components: [rowBtn],
        allowedMentions: { parse: [] }
      }).catch(() => {});

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
      }).catch(() => {});

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
      }).catch(() => {});

      return interaction.editReply({
        content: `✅ (${VERSION}) Liste **absents** envoyée → ${targetChannel}`
      }).catch(() => {});
    }

    if (mode === 'sans_reaction') {
      const embed = buildBaseEmbed({
        color,
        clubName,
        title: `⏳ SANS RÉACTION (Joueur/Essai) - ${dayLabelFR(jour)}`
      }).setDescription(mentionsLine(nonRepondusFiltre));

      await targetChannel.send({
        embeds: [embed],
        components: [rowBtn],
        allowedMentions: { parse: [] }
      }).catch(() => {});

      return interaction.editReply({
        content: `✅ (${VERSION}) Liste **sans réaction (filtre)** envoyée → ${targetChannel}`
      }).catch(() => {});
    }

    return interaction.editReply({ content: '❌ Mode inconnu.' }).catch(() => {});
  }
};
