// commands/dispos_admin.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType
} = require('discord.js');

const {
  getConfigFromInteraction,
  updateGuildConfig
} = require('../utils/config');

const JOURS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];

const TITRES = {
  lundi: '📅 LUNDI',
  mardi: '📅 MARDI',
  mercredi: '📅 MERCREDI',
  jeudi: '📅 JEUDI',
  vendredi: '📅 VENDREDI',
  samedi: '📅 SAMEDI',
  dimanche: '📅 DIMANCHE'
};

const DESC_PAR_DEFAUT = 'Réagissez ci-dessous :\n\n✅ **Présent**  |  ❌ **Absent**';
const DESCRIPTION_DEFAUT_ROUVRIR = '🕓 Session à 20h45 — merci de réagir ci-dessous ✅ / ❌';

const DEFAULT_COLOR = 0xff4db8;

// 🔒 Anti-mentions
const sanitize = (t) =>
  String(t || '').replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]').trim();

function isValidId(id) {
  return !!id && id !== '0' && /^\d{10,30}$/.test(String(id));
}

function isValidHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function getEmbedColor(cfg) {
  const hex = cfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

/* ============================================================
   🔁 RÉSOLUTION IDS (ids optionnels, fallback servers.json)
============================================================ */

function resolveIdsMapping(guildCfg, jourChoisi, idsInput) {
  const dispo = guildCfg?.dispoMessages || {};

  // 🔹 Override manuel
  if (idsInput) {
    const parts = String(idsInput).split(/[\s,;]+/).filter(Boolean);

    if (jourChoisi === 'all') {
      if (parts.length !== 7) {
        return { error: '❌ Pour **tous les jours**, tu dois fournir **7 IDs**.' };
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

    return {
      mapping: { [jourChoisi]: id },
      joursCibles: [jourChoisi],
      from: 'override'
    };
  }

  // 🔹 Fallback servers.json
  if (jourChoisi === 'all') {
    const missing = JOURS.filter(j => !isValidId(dispo[j]));
    if (missing.length) {
      return { error: `❌ IDs manquants/invalides dans servers.json → ${missing.join(', ')}` };
    }
    return { mapping: { ...dispo }, joursCibles: [...JOURS], from: 'config' };
  }

  if (!isValidId(dispo[jourChoisi])) {
    return { error: `❌ ID manquant/invalide dans servers.json → dispoMessages.${jourChoisi}` };
  }

  return {
    mapping: { [jourChoisi]: dispo[jourChoisi] },
    joursCibles: [jourChoisi],
    from: 'config'
  };
}

/* ============================================================
   🧩 Helpers embed (safe)
============================================================ */

function buildBaseEmbed({ color, clubName, jour, description, imageUrl }) {
  const e = new EmbedBuilder()
    .setColor(color)
    .setTitle(TITRES[jour] || `📅 ${jour.toUpperCase()}`)
    .setDescription(description)
    .setFooter({ text: `${clubName} ⚫ Disponibilités` });

  if (imageUrl && isValidHttpUrl(imageUrl)) e.setImage(imageUrl);
  return e;
}

function safeFromExistingEmbed(msg, fallbackEmbed) {
  const exist = msg?.embeds?.[0];
  if (!exist) return fallbackEmbed;
  try {
    return EmbedBuilder.from(exist);
  } catch {
    return fallbackEmbed;
  }
}

/* ============================================================
   📦 COMMANDE
============================================================ */

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dispos_admin')
    .setDescription('Gestion avancée des disponibilités (IDs auto via servers.json)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    /* -------------------- PUBLIER -------------------- */
    .addSubcommand(sc =>
      sc.setName('publier')
        .setDescription('Publie les 7 messages et sauvegarde les IDs automatiquement.')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon des disponibilités')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('texte')
            .setDescription('Texte personnalisé (facultatif)')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('image_url')
            .setDescription('URL image (optionnel). Si brute=true, l’URL sera envoyée en message brut.')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('image_brute')
            .setDescription('Envoyer l’image en message brut au lieu de l’intégrer à l’embed (défaut: non)')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('reactions')
            .setDescription('Ajouter ✅ ❌ (défaut : oui)')
            .setRequired(false)
        )
    )

    /* -------------------- MODIFIER -------------------- */
    .addSubcommand(sc =>
      sc.setName('modifier')
        .setDescription('Modifie les messages (IDs auto depuis servers.json)')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon des disponibilités')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Jour ou tous')
            .setRequired(true)
            .addChoices(
              { name: 'Tous', value: 'all' },
              ...JOURS.map(j => ({ name: j, value: j }))
            )
        )
        .addStringOption(o =>
          o.setName('texte')
            .setDescription('Nouveau texte')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('image_url')
            .setDescription('URL image (optionnel). Si brute=true, l’URL sera envoyée en message brut.')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('image_brute')
            .setDescription('Envoyer l’image en message brut au lieu de l’intégrer à l’embed (défaut: non)')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('ids')
            .setDescription('Override ID(s) (optionnel)')
            .setRequired(false)
        )
    )

    /* -------------------- RESET -------------------- */
    .addSubcommand(sc =>
      sc.setName('reinitialiser')
        .setDescription('Reset réactions (IDs auto)')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon des disponibilités')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Jour ou tous')
            .setRequired(true)
            .addChoices(
              { name: 'Tous', value: 'all' },
              ...JOURS.map(j => ({ name: j, value: j }))
            )
        )
        .addStringOption(o =>
          o.setName('ids')
            .setDescription('Override ID(s) (optionnel)')
            .setRequired(false)
        )
    )

    /* -------------------- ROUVRIR -------------------- */
    .addSubcommand(sc =>
      sc.setName('rouvrir')
        .setDescription('Rouvre les disponibilités')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon des disponibilités')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Jour ou tous')
            .setRequired(true)
            .addChoices(
              { name: 'Tous', value: 'all' },
              ...JOURS.map(j => ({ name: j, value: j }))
            )
        )
        .addStringOption(o =>
          o.setName('image_url')
            .setDescription('URL image (optionnel). Si brute=true, l’URL sera envoyée en message brut.')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('image_brute')
            .setDescription('Envoyer l’image en message brut au lieu de l’intégrer à l’embed (défaut: non)')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('ids')
            .setDescription('Override ID(s) (optionnel)')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('salon');
    const guild = interaction.guild;
    if (!guild) return;

    const me = guild.members.me;

    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};
    const color = getEmbedColor(guildCfg);
    const clubName = guildCfg?.clubName || guild.name || 'Club';

    // ✅ Permissions de base (écriture + embeds)
    const basePerms = new PermissionsBitField([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.EmbedLinks
    ]);

    if (!channel?.isTextBased?.() || channel.type !== ChannelType.GuildText) {
      return interaction.reply({ content: '❌ Salon invalide (texte uniquement).', ephemeral: true });
    }

    if (!channel.permissionsFor?.(me)?.has(basePerms)) {
      return interaction.reply({
        content: `❌ Je n’ai pas les permissions nécessaires dans ${channel} (voir/écrire/embed).`,
        ephemeral: true
      });
    }

    // image options (selon sub)
    const imageUrlRaw = interaction.options.getString('image_url')?.trim() || null;
    const imageUrl = imageUrlRaw && isValidHttpUrl(imageUrlRaw) ? imageUrlRaw : null;
    const imageBrute = interaction.options.getBoolean('image_brute') ?? false;

    // 🔥 PUBLIER
    if (sub === 'publier') {
      const texte = sanitize(interaction.options.getString('texte') || DESC_PAR_DEFAUT);
      const reactions = interaction.options.getBoolean('reactions') ?? true;

      if (reactions) {
        const reactPerms = new PermissionsBitField([
          PermissionsBitField.Flags.AddReactions,
          PermissionsBitField.Flags.ReadMessageHistory
        ]);
        if (!channel.permissionsFor?.(me)?.has(reactPerms)) {
          return interaction.reply({
            content: `❌ Je ne peux pas ajouter de réactions dans ${channel} (AddReactions + ReadMessageHistory).`,
            ephemeral: true
          });
        }
      }

      await interaction.deferReply({ ephemeral: true });

      // ✅ Si image brute: on l’envoie UNE FOIS (pas 7 fois)
      if (imageUrl && imageBrute) {
        await channel.send({ content: imageUrl, allowedMentions: { parse: [] } }).catch(() => {});
      }

      const idsByJour = {};

      for (const jour of JOURS) {
        const embed = buildBaseEmbed({
          color,
          clubName,
          jour,
          description: texte,
          // si image brute => pas d’image dans embed
          imageUrl: (imageUrl && !imageBrute) ? imageUrl : null
        });

        const msg = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });

        if (reactions) {
          try { await msg.react('✅'); } catch {}
          try { await msg.react('❌'); } catch {}
        }

        idsByJour[jour] = msg.id;
      }

      // 💾 Sauvegarde automatique
      updateGuildConfig(guild.id, { dispoMessages: idsByJour });

      return interaction.editReply({
        content: '✅ Messages publiés **et IDs sauvegardés automatiquement** (dispoMessages) ✅'
      });
    }

    // MODIFIER / RESET / ROUVRIR
    const jour = interaction.options.getString('jour', true);
    const idsInput = interaction.options.getString('ids') || null;

    const resolved = resolveIdsMapping(guildCfg, jour, idsInput);
    if (resolved?.error) {
      return interaction.reply({ content: resolved.error, ephemeral: true });
    }

    const { mapping, joursCibles } = resolved;

    // ✅ Permissions supplémentaires selon action
    if (sub === 'reinitialiser') {
      const perms = new PermissionsBitField([
        PermissionsBitField.Flags.ManageMessages,
        PermissionsBitField.Flags.AddReactions,
        PermissionsBitField.Flags.ReadMessageHistory
      ]);
      if (!channel.permissionsFor?.(me)?.has(perms)) {
        return interaction.reply({
          content: `❌ Je ne peux pas reset les réactions dans ${channel} (ManageMessages + AddReactions + ReadMessageHistory).`,
          ephemeral: true
        });
      }
    }

    await interaction.deferReply({ ephemeral: true });

    let done = 0;
    let missing = 0;

    for (const j of joursCibles) {
      const id = mapping[j];
      const msg = await channel.messages.fetch(id).catch(() => null);
      if (!msg) { missing++; continue; }

      const fallback = buildBaseEmbed({
        color,
        clubName,
        jour: j,
        description: DESC_PAR_DEFAUT,
        imageUrl: (imageUrl && !imageBrute) ? imageUrl : null
      });

      if (sub === 'modifier') {
        const texte = sanitize(interaction.options.getString('texte', true));
        const newDesc = `${texte}\n\n✅ **Présent** | ❌ **Absent**`;

        // ✅ si image brute: envoie une fois, puis modifie embeds normalement
        if (imageUrl && imageBrute) {
          await channel.send({ content: imageUrl, allowedMentions: { parse: [] } }).catch(() => {});
        }

        const embed = safeFromExistingEmbed(msg, fallback)
          .setColor(color)
          .setTitle(TITRES[j] || `📅 ${j.toUpperCase()}`)
          .setDescription(newDesc)
          .setFooter({ text: `${clubName} ⚫ Disponibilités` });

        if (imageUrl && !imageBrute) embed.setImage(imageUrl);

        await msg.edit({ embeds: [embed], allowedMentions: { parse: [] } });
        done++;
      }

      if (sub === 'reinitialiser') {
        try { await msg.reactions.removeAll(); } catch {}
        try { await msg.react('✅'); } catch {}
        try { await msg.react('❌'); } catch {}
        done++;
      }

      if (sub === 'rouvrir') {
        if (imageUrl && imageBrute) {
          await channel.send({ content: imageUrl, allowedMentions: { parse: [] } }).catch(() => {});
        }

        const embed = safeFromExistingEmbed(msg, fallback)
          .setColor(color)
          .setTitle(TITRES[j] || `📅 ${j.toUpperCase()}`)
          .setDescription(DESCRIPTION_DEFAUT_ROUVRIR)
          .setFooter({ text: `${clubName} ⚫ Disponibilités` });

        if (imageUrl && !imageBrute) embed.setImage(imageUrl);

        await msg.edit({ embeds: [embed], allowedMentions: { parse: [] } });
        done++;
      }
    }

    return interaction.editReply({
      content: `✅ **${sub} effectué** (${done} message(s))${missing ? ` — ⚠️ introuvable: ${missing}` : ''}.`
    });
  }
};
