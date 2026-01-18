// commands/rappeldispos.js
// ✅ RAPPEL DISPOS — COMMANDE UNIQUE
// - Mentionne uniquement les "non répondants" FILTRÉS Joueur + Essai
// - Chunk automatique (évite limite 2000 chars)
// - Bouton "Voir le message du jour"
// ✅ Anti-mentions accidentelles (everyone/here/roles)
// ⚠️ allowedMentions contrôlé : ping uniquement les users listés

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
} = require('discord.js');

const { getConfigFromInteraction } = require('../utils/config');

const sanitize = (t) =>
  String(t || '')
    .replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]')
    .trim();

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

async function extractReactions(message) {
  const reacted = new Set();

  for (const [, reaction] of message.reactions.cache) {
    const e = reaction.emoji?.name;
    if (!['✅', '❌'].includes(e)) continue;

    const users = await reaction.users.fetch().catch(() => null);
    if (!users) continue;

    users.forEach(u => {
      if (u.bot) return;
      reacted.add(u.id);
    });
  }

  return { reacted };
}

function computeEligiblesWithRoles(guild, roleJoueur, roleEssai) {
  return guild.members.cache.filter(m => {
    if (m.user.bot) return false;
    const hasJ = roleJoueur ? m.roles.cache.has(roleJoueur.id) : false;
    const hasE = roleEssai ? m.roles.cache.has(roleEssai.id) : false;
    return hasJ || hasE;
  });
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rappeldispos')
    .setDescription('Rappel (mentions) aux membres Joueur/Essai qui n’ont pas réagi ✅/❌.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addStringOption(o =>
      o.setName('jour')
        .setDescription('Jour à relancer')
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
        .setDescription('Salon où envoyer le rappel (défaut : salon actuel)')
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

    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};
    const cfg = guildCfg || {};
    const cfgRoles = cfg.roles || {};
    const cfgDispoMessages = cfg.dispoMessages || {};

    const targetChannel = interaction.options.getChannel('salon') || interaction.channel;
    if (!targetChannel || !targetChannel.isTextBased()) {
      return interaction.reply({ content: '❌ Salon cible invalide.', ephemeral: true }).catch(() => {});
    }

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
      }).catch(() => {});
    }

    let me = guild.members.me;
    if (!me) me = await guild.members.fetchMe().catch(() => null);
    if (!me) {
      return interaction.reply({ content: '❌ Impossible de récupérer mes permissions (fetchMe).', ephemeral: true }).catch(() => {});
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
      PermissionsBitField.Flags.SendMessages
    ]);
    if (!targetChannel.permissionsFor(me)?.has(writePerms)) {
      return interaction.reply({
        content: `❌ Je n’ai pas les permissions pour poster dans ${targetChannel}.`,
        ephemeral: true
      }).catch(() => {});
    }

    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    let message;
    try {
      message = await dispoChannel.messages.fetch(messageId);
    } catch {
      return interaction.editReply({
        content: `❌ Message introuvable (ID: \`${messageId}\`) dans ${dispoChannel}.`
      }).catch(() => {});
    }

    await guild.members.fetch().catch(() => {});

    const { reacted } = await extractReactions(message);
    const eligibles = computeEligiblesWithRoles(guild, roleJoueur, roleEssai);
    const nonRepondus = eligibles.filter(m => !reacted.has(m.id));

    const ids = [...nonRepondus.values()].map(m => m.id);

    const messageURL = `https://discord.com/channels/${guild.id}/${dispoChannel.id}/${message.id}`;
    const rowBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Voir le message du jour')
        .setStyle(ButtonStyle.Link)
        .setURL(messageURL)
    );

    if (!ids.length) {
      await targetChannel.send({
        content: `✅ Tout le monde a réagi (filtre Joueur/Essai) pour **${dayLabelFR(jour)}**.`,
        components: [rowBtn],
        allowedMentions: { parse: [] }
      }).catch(() => {});

      return interaction.editReply({ content: '✅ Aucun rappel nécessaire.' }).catch(() => {});
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
        components: [rowBtn],
        allowedMentions: { users: first, parse: [] }
      }).catch(() => {});
    }

    for (const batch of batches) {
      await targetChannel.send({
        content: batch.map(id => `<@${id}>`).join(' - '),
        allowedMentions: { users: batch, parse: [] }
      }).catch(() => {});
    }

    return interaction.editReply({
      content: `✅ Rappel envoyé : **${ids.length}** membre(s) (filtre Joueur/Essai).`
    }).catch(() => {});
  }
};
