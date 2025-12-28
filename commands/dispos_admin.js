// commands/dispos_admin.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType
} = require('discord.js');

const { getConfigFromInteraction, updateGuildConfig } = require('../utils/config');

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
   🔁 RÉSOLUTION IDS (ids optionnels, fallback config)
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

  // 🔹 Fallback config
  if (jourChoisi === 'all') {
    const missing = JOURS.filter(j => !isValidId(dispo[j]));
    if (missing.length) {
      return { error: `❌ IDs manquants/invalides dans la config → ${missing.join(', ')}` };
    }
    return { mapping: { ...dispo }, joursCibles: [...JOURS], from: 'config' };
  }

  if (!isValidId(dispo[jourChoisi])) {
    return { error: `❌ ID manquant/invalide dans la config → dispoMessages.${jourChoisi}` };
  }

  return {
    mapping: { [jourChoisi]: dispo[jourChoisi] },
    joursCibles: [jourChoisi],
    from: 'config'
  };
}

/* ============================================================
   🧩 Embeds helpers
============================================================ */
function safeFromExistingEmbed(msg, fallbackEmbed) {
  const exist = msg?.embeds?.[0];
  if (!exist) return fallbackEmbed;
  try {
    return EmbedBuilder.from(exist);
  } catch {
    return fallbackEmbed;
  }
}

function buildEmbed({ color, clubName, jour, description }) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(TITRES[jour] || `📅 ${String(jour).toUpperCase()}`)
    .setDescription(description)
    .setFooter({ text: `${clubName} ⚫ Disponibilités` });
}

function buildEmbedsBatch({ count, color, clubName, jour, description }) {
  const c = Math.max(1, Math.min(10, Number(count) || 1)); // Discord: max 10 embeds / message
  const embeds = [];
  for (let i = 0; i < c; i++) {
    // On garde le même embed (propre). Si tu veux un numéro visible, décommente.
    const e = buildEmbed({ color, clubName, jour, description });
    // if (c > 1) e.setTitle(`${TITRES[jour] || jour.toUpperCase()} • ${i + 1}/${c}`);
    embeds.push(e);
  }
  return embeds;
}

function pickFinalImage(interaction) {
  // ✅ priorité upload (galerie)
  const att = interaction.options.getAttachment('image');
  if (att?.url) {
    // nom de fichier "safe" pour attachment://
    const name = (att.name || 'image.png').replace(/[^\w.\-]/g, '_');
    return { kind: 'attachment', url: att.url, name };
  }

  const raw = interaction.options.getString('image_url')?.trim();
  if (raw && isValidHttpUrl(raw)) return { kind: 'url', url: raw, name: null };

  return null;
}

/**
 * Envoie / édite un message selon:
 * - mode: 'embed' | 'image' | 'both'
 * - imageDansEmbed: si true et image fournie => image dans embed (setImage)
 *                  si false => image "brute" (fichier) + embed(s) sans image
 *
 * NOTE: "image seule" :
 * - si attachment => message avec fichier
 * - si url => content = url (Discord affichera l’aperçu image)
 */
async function sendOrEditDispoMessage({
  channel,
  existingMessage = null,
  mode,
  embedsCount,
  color,
  clubName,
  jour,
  description,
  image,
  imageDansEmbed
}) {
  const payload = {
    content: '',
    embeds: [],
    files: [],
    allowedMentions: { parse: [] }
  };

  const wantEmbed = mode === 'embed' || mode === 'both';
  const wantImage = mode === 'image' || mode === 'both';

  // --- EMBEDS ---
  if (wantEmbed) {
    payload.embeds = buildEmbedsBatch({
      count: embedsCount,
      color,
      clubName,
      jour,
      description
    });
  }

  // --- IMAGE ---
  if (wantImage && image) {
    if (image.kind === 'attachment') {
      // On joint le fichier au message
      payload.files.push({ attachment: image.url, name: image.name });

      // Image dans embed ?
      if (wantEmbed && imageDansEmbed) {
        for (const e of payload.embeds) e.setImage(`attachment://${image.name}`);
      } else if (!wantEmbed) {
        // image seule => on laisse juste l’attachment (content vide)
      } else {
        // both mais image brute => on garde embed(s) sans image + attachment
      }
    } else if (image.kind === 'url') {
      if (wantEmbed && imageDansEmbed) {
        for (const e of payload.embeds) e.setImage(image.url);
      } else if (!wantEmbed) {
        // image seule => lien en content (aperçu Discord)
        payload.content = image.url;
      } else {
        // both mais image brute => lien en content + embed(s)
        payload.content = image.url;
      }
    }
  }

  // Nettoyage : si ni embed ni content ni file => on garde au moins un embed (fallback)
  if (!payload.embeds.length && !payload.content && !payload.files.length) {
    payload.embeds = buildEmbedsBatch({
      count: 1,
      color,
      clubName,
      jour,
      description
    });
  }

  // EDIT or SEND
  if (existingMessage) {
    // ⚠️ Discord limite parfois l’edit d’attachments selon contexte.
    // En pratique, message.edit({ files }) remplace les attachments.
    return existingMessage.edit(payload);
  }
  return channel.send(payload);
}

async function ensureReactions(msg, enabled) {
  if (!enabled) return;
  try { await msg.react('✅'); } catch {}
  try { await msg.react('❌'); } catch {}
}

/* ============================================================
   📦 COMMANDE
============================================================ */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('dispos_admin')
    .setDescription('Gestion avancée des disponibilités')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    /* -------------------- PUBLIER -------------------- */
    .addSubcommand(sc =>
      sc.setName('publier')
        .setDescription('Publie 1 message (jour) ou 7 messages (tous) + sauvegarde IDs.')
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
          o.setName('mode')
            .setDescription('embed = uniquement embed(s), image = uniquement image, both = embed(s)+image')
            .setRequired(true)
            .addChoices(
              { name: 'Embed uniquement', value: 'embed' },
              { name: 'Image uniquement', value: 'image' },
              { name: 'Embed + Image', value: 'both' }
            )
        )
        .addIntegerOption(o =>
          o.setName('embeds')
            .setDescription('Nombre d’embeds dans le message (1 à 10) — utilisé si mode=embed/both')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('texte')
            .setDescription('Texte (facultatif)')
            .setRequired(false)
        )
        .addAttachmentOption(o =>
          o.setName('image')
            .setDescription('Image (upload galerie) — prioritaire sur image_url')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('image_url')
            .setDescription('URL image (optionnel)')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('image_dans_embed')
            .setDescription('Mettre l’image dans l’embed (si mode=embed/both). Défaut: oui')
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
        .setDescription('Modifie les messages existants (IDs via config ou override).')
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
          o.setName('mode')
            .setDescription('embed = uniquement embed(s), image = uniquement image, both = embed(s)+image')
            .setRequired(true)
            .addChoices(
              { name: 'Embed uniquement', value: 'embed' },
              { name: 'Image uniquement', value: 'image' },
              { name: 'Embed + Image', value: 'both' }
            )
        )
        .addIntegerOption(o =>
          o.setName('embeds')
            .setDescription('Nombre d’embeds dans le message (1 à 10) — utilisé si mode=embed/both')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('texte')
            .setDescription('Nouveau texte (facultatif) — si absent, garde la description actuelle si possible')
            .setRequired(false)
        )
        .addAttachmentOption(o =>
          o.setName('image')
            .setDescription('Image (upload galerie) — prioritaire sur image_url')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('image_url')
            .setDescription('URL image (optionnel)')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('image_dans_embed')
            .setDescription('Mettre l’image dans l’embed (si mode=embed/both). Défaut: oui')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('ids')
            .setDescription('Override ID(s) (optionnel) — 1 ID ou 7 IDs si jour=all')
            .setRequired(false)
        )
    )

    /* -------------------- RESET -------------------- */
    .addSubcommand(sc =>
      sc.setName('reinitialiser')
        .setDescription('Reset réactions (IDs auto via config ou override).')
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
            .setDescription('Override ID(s) (optionnel) — 1 ID ou 7 IDs si jour=all')
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

    // 🔥 SUB: PUBLISH / MODIFY share base
    if (sub === 'publier' || sub === 'modifier') {
      const jourChoisi = interaction.options.getString('jour', true);
      const mode = interaction.options.getString('mode', true); // embed|image|both
      const embedsCount = interaction.options.getInteger('embeds') ?? 1;
      const imageDansEmbed = interaction.options.getBoolean('image_dans_embed') ?? true;

      const image = pickFinalImage(interaction);

      // Texte: publish => fallback default; modify => optional
      const texteOption = interaction.options.getString('texte');
      const descriptionPublish = sanitize(texteOption || DESC_PAR_DEFAUT);

      // Pour modifier: si texte absent, on tente de garder l’existant
      const keepExistingDescriptionIfPossible = (texteOption == null);

      // Réactions: seulement publish (par défaut oui)
      const reactionsEnabled = (sub === 'publier')
        ? (interaction.options.getBoolean('reactions') ?? true)
        : true; // modifier ne retire jamais les réactions

      // Permissions réactions si besoin (publier => on ajoute)
      if (sub === 'publier' && reactionsEnabled) {
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

      // --------- PUBLIER ---------
      if (sub === 'publier') {
        const joursCibles = (jourChoisi === 'all') ? [...JOURS] : [jourChoisi];
        const idsByJour = { ...(guildCfg?.dispoMessages || {}) };

        for (const j of joursCibles) {
          const msg = await sendOrEditDispoMessage({
            channel,
            existingMessage: null,
            mode,
            embedsCount,
            color,
            clubName,
            jour: j,
            description: descriptionPublish,
            image,
            imageDansEmbed
          });

          await ensureReactions(msg, reactionsEnabled);
          idsByJour[j] = msg.id;
        }

        // 💾 Sauvegarde automatique
        updateGuildConfig(guild.id, { dispoMessages: idsByJour });

        return interaction.editReply({
          content: `✅ Publié: **${jourChoisi === 'all' ? '7 jours' : jourChoisi}** — IDs sauvegardés (dispoMessages).`
        });
      }

      // --------- MODIFIER ---------
      if (sub === 'modifier') {
        const idsInput = interaction.options.getString('ids') || null;
        const resolved = resolveIdsMapping(guildCfg, jourChoisi, idsInput);
        if (resolved?.error) {
          return interaction.editReply({ content: resolved.error });
        }

        const { mapping, joursCibles } = resolved;

        let done = 0;
        let missing = 0;

        for (const j of joursCibles) {
          const id = mapping[j];
          const msg = await channel.messages.fetch(id).catch(() => null);
          if (!msg) { missing++; continue; }

          // description: soit nouveau texte, soit garde existant si possible
          let description = descriptionPublish;
          if (keepExistingDescriptionIfPossible) {
            const exist = msg.embeds?.[0];
            const existDesc = exist?.description ? sanitize(exist.description) : null;
            description = existDesc || DESC_PAR_DEFAUT;
          } else {
            description = sanitize(texteOption || DESC_PAR_DEFAUT);
          }

          // si mode embed/both et texte a été fourni, on remet aussi la ligne réactions (cohérence)
          if ((mode === 'embed' || mode === 'both') && !keepExistingDescriptionIfPossible) {
            // si l’admin a tapé un texte custom, on ajoute la ligne standard si elle n’est pas déjà dedans
            if (!/✅\s*\*\*Présent\*\*/.test(description) && !/❌\s*\*\*Absent\*\*/.test(description)) {
              description = `${description}\n\n✅ **Présent**  |  ❌ **Absent**`;
            }
          }

          // fallback embed si on doit "safeFromExistingEmbed"
          const fallback = buildEmbed({ color, clubName, jour: j, description });

          // Si mode=embed/both et on veut préserver certains champs existants (optionnel),
          // on garde l’embed existant comme base uniquement si texte absent.
          // Sinon on reconstruit proprement.
          let msgToEdit = msg;

          // On édite via helper (propre)
          // MAIS: si mode=embed/both et texte absent, on part d’un embed existant pour ne pas casser.
          if ((mode === 'embed' || mode === 'both') && keepExistingDescriptionIfPossible) {
            // On remplace quand même par notre structure, mais en utilisant le 1er embed existant comme base
            const base = safeFromExistingEmbed(msg, fallback)
              .setColor(color)
              .setTitle(TITRES[j] || `📅 ${String(j).toUpperCase()}`)
              .setDescription(description)
              .setFooter({ text: `${clubName} ⚫ Disponibilités` });

            const embeds = [];
            const c = Math.max(1, Math.min(10, Number(embedsCount) || 1));
            for (let i = 0; i < c; i++) embeds.push(i === 0 ? base : EmbedBuilder.from(base));

            // Applique image si besoin
            if (image && imageDansEmbed && (mode === 'embed' || mode === 'both')) {
              if (image.kind === 'attachment') {
                // On doit éditer avec files pour que attachment:// marche
                const files = [{ attachment: image.url, name: image.name }];
                for (const e of embeds) e.setImage(`attachment://${image.name}`);

                // Si mode both et image brute => on joint aussi l’attachment; sinon l’image est déjà dans embed
                // Ici imageDansEmbed=true donc OK
                await msgToEdit.edit({ content: '', embeds, files, allowedMentions: { parse: [] } });
              } else {
                for (const e of embeds) e.setImage(image.url);
                await msgToEdit.edit({ content: '', embeds, allowedMentions: { parse: [] } });
              }
            } else {
              // pas d’image dans embed (ou mode image only)
              if (mode === 'image') {
                // image only
                if (image?.kind === 'attachment') {
                  await msgToEdit.edit({ content: '', embeds: [], files: [{ attachment: image.url, name: image.name }], allowedMentions: { parse: [] } });
                } else if (image?.kind === 'url') {
                  await msgToEdit.edit({ content: image.url, embeds: [], allowedMentions: { parse: [] } });
                } else {
                  // aucun media => on vide pas, on met un embed minimal pour éviter un message vide
                  await msgToEdit.edit({ content: '', embeds: [fallback], allowedMentions: { parse: [] } });
                }
              } else {
                // embed or both without imageDansEmbed
                let content = '';
                let files = [];
                if (mode === 'both' && image) {
                  if (image.kind === 'attachment') files = [{ attachment: image.url, name: image.name }];
                  else content = image.url;
                }
                await msgToEdit.edit({ content, embeds, files, allowedMentions: { parse: [] } });
              }
            }
          } else {
            // Version générique (reconstruit proprement)
            await sendOrEditDispoMessage({
              channel,
              existingMessage: msgToEdit,
              mode,
              embedsCount,
              color,
              clubName,
              jour: j,
              description,
              image,
              imageDansEmbed
            });
          }

          // On ne touche pas aux réactions (tu veux les garder)
          done++;
        }

        return interaction.editReply({
          content: `✅ Modifier effectué (${done} message(s))${missing ? ` — ⚠️ introuvable: ${missing}` : ''}.`
        });
      }
    }

    // 🔥 SUB: RESET REACTIONS
    if (sub === 'reinitialiser') {
      const jourChoisi = interaction.options.getString('jour', true);
      const idsInput = interaction.options.getString('ids') || null;

      const resolved = resolveIdsMapping(guildCfg, jourChoisi, idsInput);
      if (resolved?.error) {
        return interaction.reply({ content: resolved.error, ephemeral: true });
      }

      const { mapping, joursCibles } = resolved;

      // perms reset
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

      await interaction.deferReply({ ephemeral: true });

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
        content: `✅ Réinitialiser effectué (${done} message(s))${missing ? ` — ⚠️ introuvable: ${missing}` : ''}.`
      });
    }
  }
};
