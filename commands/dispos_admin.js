// commands/dispos_admin.js
// ✅ Dispos Admin — VERSION OPTIMISÉE, SIMPLE, INTUITIVE
//
// Objectif : gérer les messages "disponibilités" (1 jour ou tous les jours) dans un salon.
// Subcommands :
// - /dispos_admin publier      -> envoie les messages (1 ou 7) + sauvegarde automatiquement les IDs dans config.dispoMessages
// - /dispos_admin modifier     -> édite les messages existants (IDs depuis config OU override via option ids)
// - /dispos_admin reinitialiser-> supprime toutes les réactions + remet ✅❌ (IDs depuis config OU override)
//
// Modes :
// - embed  -> embed(s) uniquement
// - image  -> image uniquement (attachment ou URL)
// - both   -> embed(s) + image (image dans embed par défaut)
//
// Notes importantes :
// - Pour "Tous", publier crée 7 messages dans le même salon, puis sauvegarde les 7 IDs.
// - Modifier peut fonctionner sans toucher au mapping, ou avec override ids (1 ou 7).
// - Réinitialiser nécessite ManageMessages + AddReactions + ReadMessageHistory.
//
// Dépendances : utils/config (getConfigFromInteraction, updateGuildConfig)

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType
} = require('discord.js');

const { getConfigFromInteraction, updateGuildConfig } = require('../utils/config');

/* ===================== Constantes ===================== */
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const TITRES = {
  lundi: '📅 **LUNDI**',
  mardi: '📅 **MARDI**',
  mercredi: '📅 **MERCREDI**',
  jeudi: '📅 **JEUDI**',
  vendredi: '📅 **VENDREDI**',
  samedi: '📅 **SAMEDI**',
  dimanche: '📅 **DIMANCHE**'
};

const DESC_PAR_DEFAUT =
  'Réagissez ci-dessous :\n\n✅ **Présent**  |  ❌ **Absent**';

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
  return !!id && id !== '0' && /^\d{10,30}$/.test(String(id));
}

function parseIdsInput(raw) {
  if (!raw) return [];
  return String(raw).split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
}

function isValidHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildEmbed({ color, clubName, jour, description }) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(TITRES[jour] || `📅 **${String(jour).toUpperCase()}**`)
    .setDescription(description)
    .setFooter({ text: `${clubName} ⚫ Disponibilités` });
}

function buildEmbeds(count, baseEmbed) {
  const c = Math.max(1, Math.min(10, Number(count) || 1)); // max 10 embeds / message
  const embeds = [];
  for (let i = 0; i < c; i++) {
    embeds.push(i === 0 ? baseEmbed : EmbedBuilder.from(baseEmbed));
  }
  return embeds;
}

/**
 * Image choisie (priorité attachment > url)
 * Retour:
 * - null
 * - { kind: 'attachment', url, name }
 * - { kind: 'url', url }
 */
function pickImage(interaction) {
  const att = interaction.options.getAttachment('image');
  if (att?.url) {
    const safeName = (att.name || 'image.png').replace(/[^\w.\-]/g, '_');
    return { kind: 'attachment', url: att.url, name: safeName };
  }

  const url = interaction.options.getString('image_url')?.trim();
  if (url && isValidHttpUrl(url)) return { kind: 'url', url };

  return null;
}

/**
 * Résout les IDs de messages cible selon :
 * - override via option ids (1 id ou 7 ids)
 * - sinon via config.dispoMessages
 */
function resolveIdsMapping(guildCfg, jourChoisi, idsRaw) {
  const dispo = guildCfg?.dispoMessages || {};

  // override
  if (idsRaw) {
    const parts = parseIdsInput(idsRaw);

    if (jourChoisi === 'all') {
      if (parts.length !== 7) {
        return { error: '❌ Pour **Tous**, tu dois fournir **7 IDs** (dans l’ordre lundi→dimanche).' };
      }
      const mapping = {};
      for (let i = 0; i < 7; i++) {
        const id = parts[i];
        if (!isValidId(id)) return { error: `❌ ID invalide à la position ${i + 1}.` };
        mapping[JOURS[i]] = id;
      }
      return { mapping, joursCibles: [...JOURS], from: 'override' };
    }

    const id = parts[0];
    if (!isValidId(id)) return { error: '❌ ID invalide.' };
    return { mapping: { [jourChoisi]: id }, joursCibles: [jourChoisi], from: 'override' };
  }

  // config
  if (jourChoisi === 'all') {
    const missing = JOURS.filter(j => !isValidId(dispo[j]));
    if (missing.length) {
      return { error: `❌ IDs manquants/invalides dans config.dispoMessages → ${missing.join(', ')}` };
    }
    return { mapping: { ...dispo }, joursCibles: [...JOURS], from: 'config' };
  }

  if (!isValidId(dispo[jourChoisi])) {
    return { error: `❌ ID manquant/invalide dans config.dispoMessages.${jourChoisi}` };
  }
  return { mapping: { [jourChoisi]: dispo[jourChoisi] }, joursCibles: [jourChoisi], from: 'config' };
}

async function ensureReactions(msg, enabled) {
  if (!enabled) return;
  try { await msg.react('✅'); } catch {}
  try { await msg.react('❌'); } catch {}
}

/**
 * Compose un payload message selon mode.
 * - embed: embeds uniquement
 * - image: image uniquement
 * - both: embeds + image (image dans embed si imageDansEmbed=true)
 */
function buildPayload({ mode, embedsCount, embedBase, image, imageDansEmbed }) {
  const payload = {
    content: '',
    embeds: [],
    files: [],
    allowedMentions: { parse: [] }
  };

  const wantEmbed = mode === 'embed' || mode === 'both';
  const wantImage = mode === 'image' || mode === 'both';

  if (wantEmbed) {
    payload.embeds = buildEmbeds(embedsCount, embedBase);
  }

  if (wantImage && image) {
    if (image.kind === 'attachment') {
      payload.files.push({ attachment: image.url, name: image.name });

      if (wantEmbed && imageDansEmbed) {
        for (const e of payload.embeds) e.setImage(`attachment://${image.name}`);
      } else {
        // image "brute": attachment joint, embeds sans image, content vide
      }
    } else if (image.kind === 'url') {
      if (wantEmbed && imageDansEmbed) {
        for (const e of payload.embeds) e.setImage(image.url);
      } else {
        // image "brute": URL en content (Discord affiche l’aperçu)
        payload.content = image.url;
      }
    }
  }

  // Sécurité : si tout est vide, on force un embed
  if (!payload.content && !payload.files.length && !payload.embeds.length) {
    payload.embeds = [embedBase];
  }

  return payload;
}

async function sendOrEdit({ channel, existingMessage, payload }) {
  if (existingMessage) return existingMessage.edit(payload);
  return channel.send(payload);
}

async function fetchMeSafe(guild) {
  return guild.members.me || (await guild.members.fetchMe().catch(() => null));
}

function requireChannelText(channel) {
  return channel && channel.isTextBased?.() && channel.type === ChannelType.GuildText;
}

function requirePerms(channel, me, flags, errMsg) {
  const perms = new PermissionsBitField(flags);
  if (!channel.permissionsFor(me)?.has(perms)) return errMsg;
  return null;
}

/* ===================== Commande ===================== */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('dispos_admin')
    .setDescription('Gestion des messages de disponibilités (publier / modifier / reset).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // ===================== publier =====================
    .addSubcommand(sc =>
      sc.setName('publier')
        .setDescription('Publie 1 jour ou tous les jours et sauvegarde les IDs automatiquement.')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon des disponibilités')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Jour ou Tous')
            .setRequired(true)
            .addChoices(
              { name: 'Tous', value: 'all' },
              ...JOURS.map(j => ({ name: j, value: j }))
            )
        )
        .addStringOption(o =>
          o.setName('mode')
            .setDescription('Type de message')
            .setRequired(true)
            .addChoices(
              { name: 'Embed uniquement', value: 'embed' },
              { name: 'Image uniquement', value: 'image' },
              { name: 'Embed + Image', value: 'both' }
            )
        )
        .addIntegerOption(o =>
          o.setName('embeds')
            .setDescription('Nombre d’embeds (1 à 10) — utile si mode=embed/both')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('texte')
            .setDescription('Description de l’embed (facultatif)')
            .setRequired(false)
        )
        .addAttachmentOption(o =>
          o.setName('image')
            .setDescription('Image (upload) — prioritaire sur image_url')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('image_url')
            .setDescription('URL image (optionnel)')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('image_dans_embed')
            .setDescription('Si image + embed : mettre l’image DANS l’embed (défaut: oui)')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('reactions')
            .setDescription('Ajouter ✅❌ (défaut: oui)')
            .setRequired(false)
        )
    )

    // ===================== modifier =====================
    .addSubcommand(sc =>
      sc.setName('modifier')
        .setDescription('Modifie les messages existants (IDs config ou override).')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon des disponibilités')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Jour ou Tous')
            .setRequired(true)
            .addChoices(
              { name: 'Tous', value: 'all' },
              ...JOURS.map(j => ({ name: j, value: j }))
            )
        )
        .addStringOption(o =>
          o.setName('mode')
            .setDescription('Type de message')
            .setRequired(true)
            .addChoices(
              { name: 'Embed uniquement', value: 'embed' },
              { name: 'Image uniquement', value: 'image' },
              { name: 'Embed + Image', value: 'both' }
            )
        )
        .addIntegerOption(o =>
          o.setName('embeds')
            .setDescription('Nombre d’embeds (1 à 10) — utile si mode=embed/both')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('texte')
            .setDescription('Nouveau texte (si absent : conserve la description actuelle si possible)')
            .setRequired(false)
        )
        .addAttachmentOption(o =>
          o.setName('image')
            .setDescription('Image (upload) — prioritaire sur image_url')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('image_url')
            .setDescription('URL image (optionnel)')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('image_dans_embed')
            .setDescription('Si image + embed : mettre l’image DANS l’embed (défaut: oui)')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('ids')
            .setDescription('Override ID(s) : 1 ID (jour) ou 7 IDs (Tous) dans l’ordre lundi→dimanche')
            .setRequired(false)
        )
    )

    // ===================== reinitialiser =====================
    .addSubcommand(sc =>
      sc.setName('reinitialiser')
        .setDescription('Supprime les réactions et remet ✅❌.')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon des disponibilités')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Jour ou Tous')
            .setRequired(true)
            .addChoices(
              { name: 'Tous', value: 'all' },
              ...JOURS.map(j => ({ name: j, value: j }))
            )
        )
        .addStringOption(o =>
          o.setName('ids')
            .setDescription('Override ID(s) : 1 ID (jour) ou 7 IDs (Tous) dans l’ordre lundi→dimanche')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    if (!guild) return;

    const channel = interaction.options.getChannel('salon');
    if (!requireChannelText(channel)) {
      return interaction.reply({ content: '❌ Salon invalide (texte uniquement).', ephemeral: true }).catch(() => {});
    }

    const me = await fetchMeSafe(guild);
    if (!me) {
      return interaction.reply({ content: '❌ Impossible de récupérer mes permissions (fetchMe).', ephemeral: true }).catch(() => {});
    }

    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};
    const cfg = guildCfg || {};
    const color = getEmbedColor(cfg);
    const clubName = cfg.clubName || guild.name || 'Club';

    // perms de base pour écrire
    const baseErr = requirePerms(
      channel,
      me,
      [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks
      ],
      `❌ Je n’ai pas les permissions nécessaires dans ${channel} (voir/écrire/embed).`
    );
    if (baseErr) return interaction.reply({ content: baseErr, ephemeral: true }).catch(() => {});

    // ===================== publier / modifier =====================
    if (sub === 'publier' || sub === 'modifier') {
      const jourChoisi = interaction.options.getString('jour', true);
      const mode = interaction.options.getString('mode', true); // embed|image|both
      const embedsCount = interaction.options.getInteger('embeds') ?? 1;
      const imageDansEmbed = interaction.options.getBoolean('image_dans_embed') ?? true;
      const image = pickImage(interaction);

      // texte
      const texteOption = interaction.options.getString('texte');
      const userProvidedText = typeof texteOption === 'string';
      const descPublish = sanitize(texteOption || DESC_PAR_DEFAUT);

      // publier: réactions par défaut true
      const reactionsEnabled = (sub === 'publier')
        ? (interaction.options.getBoolean('reactions') ?? true)
        : false; // modifier ne gère pas les réactions

      if (sub === 'publier' && reactionsEnabled) {
        const reactErr = requirePerms(
          channel,
          me,
          [
            PermissionsBitField.Flags.AddReactions,
            PermissionsBitField.Flags.ReadMessageHistory
          ],
          `❌ Je ne peux pas ajouter de réactions dans ${channel} (AddReactions + ReadMessageHistory).`
        );
        if (reactErr) return interaction.reply({ content: reactErr, ephemeral: true }).catch(() => {});
      }

      await interaction.deferReply({ ephemeral: true }).catch(() => {});

      // -------- publier
      if (sub === 'publier') {
        const joursCibles = (jourChoisi === 'all') ? [...JOURS] : [jourChoisi];
        const nextDispoMessages = { ...(cfg.dispoMessages || {}) };

        for (const j of joursCibles) {
          const embedBase = buildEmbed({ color, clubName, jour: j, description: descPublish });
          const payload = buildPayload({ mode, embedsCount, embedBase, image, imageDansEmbed });

          const msg = await sendOrEdit({ channel, existingMessage: null, payload });
          await ensureReactions(msg, reactionsEnabled);

          nextDispoMessages[j] = msg.id;
        }

        // Sauvegarde auto
        updateGuildConfig(guild.id, { dispoMessages: nextDispoMessages });

        return interaction.editReply({
          content: `✅ Publié: **${jourChoisi === 'all' ? 'Tous (7 jours)' : jourChoisi}** — IDs sauvegardés dans \`dispoMessages\`.`
        }).catch(() => {});
      }

      // -------- modifier
      if (sub === 'modifier') {
        const idsRaw = interaction.options.getString('ids') || null;
        const resolved = resolveIdsMapping(cfg, jourChoisi, idsRaw);
        if (resolved?.error) return interaction.editReply({ content: resolved.error }).catch(() => {});

        const { mapping, joursCibles, from } = resolved;

        let done = 0;
        let missing = 0;

        for (const j of joursCibles) {
          const id = mapping[j];
          const msg = await channel.messages.fetch(id).catch(() => null);
          if (!msg) { missing++; continue; }

          // description:
          // - si texte fourni -> on remplace
          // - sinon -> on conserve description existante si possible, sinon default
          let finalDesc = DESC_PAR_DEFAUT;

          if (userProvidedText) {
            finalDesc = descPublish;
          } else {
            const existDesc = msg.embeds?.[0]?.description;
            finalDesc = sanitize(existDesc || DESC_PAR_DEFAUT) || DESC_PAR_DEFAUT;
          }

          const embedBase = buildEmbed({ color, clubName, jour: j, description: finalDesc });
          const payload = buildPayload({ mode, embedsCount, embedBase, image, imageDansEmbed });

          await sendOrEdit({ channel, existingMessage: msg, payload });
          done++;
        }

        return interaction.editReply({
          content:
            `✅ Modification terminée (${done} message(s))` +
            (missing ? ` — ⚠️ introuvable: ${missing}` : '') +
            `.\nℹ️ Source IDs : **${from}**.`
        }).catch(() => {});
      }
    }

    // ===================== reinitialiser =====================
    if (sub === 'reinitialiser') {
      const jourChoisi = interaction.options.getString('jour', true);
      const idsRaw = interaction.options.getString('ids') || null;

      const resolved = resolveIdsMapping(cfg, jourChoisi, idsRaw);
      if (resolved?.error) {
        return interaction.reply({ content: resolved.error, ephemeral: true }).catch(() => {});
      }

      const resetErr = requirePerms(
        channel,
        me,
        [
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.AddReactions,
          PermissionsBitField.Flags.ReadMessageHistory
        ],
        `❌ Je ne peux pas reset les réactions dans ${channel} (ManageMessages + AddReactions + ReadMessageHistory).`
      );
      if (resetErr) return interaction.reply({ content: resetErr, ephemeral: true }).catch(() => {});

      await interaction.deferReply({ ephemeral: true }).catch(() => {});

      const { mapping, joursCibles, from } = resolved;

      let done = 0;
      let missing = 0;

      for (const j of joursCibles) {
        const id = mapping[j];
        const msg = await channel.messages.fetch(id).catch(() => null);
        if (!msg) { missing++; continue; }

        try { await msg.reactions.removeAll(); } catch {}
        try { await msg.react('✅'); } catch {}
        try { await msg.react('❌'); } catch {}
        done++;
      }

      return interaction.editReply({
        content:
          `✅ Réinitialisation terminée (${done} message(s))` +
          (missing ? ` — ⚠️ introuvable: ${missing}` : '') +
          `.\nℹ️ Source IDs : **${from}**.`
      }).catch(() => {});
    }

    return interaction.reply({ content: '❌ Sous-commande inconnue.', ephemeral: true }).catch(() => {});
  }
};
