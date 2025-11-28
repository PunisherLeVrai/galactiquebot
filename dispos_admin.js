// commands/dispos_admin.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType,
  MessageFlags
} = require('discord.js');

const JOURS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
const TITRES = {
  lundi: '📅 Lundi', mardi: '📅 Mardi', mercredi: '📅 Mercredi',
  jeudi: '📅 Jeudi', vendredi: '📅 Vendredi', samedi: '📅 Samedi', dimanche: '📅 Dimanche'
};
const TITRES_MAJ = {
  lundi: '📅 LUNDI',
  mardi: '📅 MARDI',
  mercredi: '📅 MERCREDI',
  jeudi: '📅 JEUDI',
  vendredi: '📅 VENDREDI',
  samedi: '📅 SAMEDI',
  dimanche: '📅 DIMANCHE'
};
const COULEUR = 0xff4db8;
const DESC_PAR_DEFAUT = 'Réagissez ci-dessous :\n\n✅ **Présent**  |  ❌ **Absent**';
const DESCRIPTION_DEFAUT_ROUVRIR = '🕓 Session à 20h45 — merci de réagir ci-dessous ✅ / ❌';

// Anti-mentions
const sanitize = (t) =>
  String(t || '').replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]');

function parseIdsByJour(jourChoisi, idsInput) {
  const clean = String(idsInput || '').trim();
  if (!clean) return { error: '❌ Tu dois fournir au moins un ID de message.' };

  const parts = clean.split(/[\s,;]+/).filter(Boolean);

  if (jourChoisi === 'all') {
    if (parts.length !== 7) {
      return {
        error: '❌ Pour **Tous les jours**, tu dois fournir **7 IDs** dans l’ordre : lundi mardi mercredi jeudi vendredi samedi dimanche.'
      };
    }
    const mapping = {};
    JOURS.forEach((j, idx) => { mapping[j] = parts[idx]; });
    return { mapping, joursCibles: [...JOURS] };
  }

  // un seul jour
  return {
    mapping: { [jourChoisi]: parts[0] },
    joursCibles: [jourChoisi]
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dispos_admin')
    .setDescription('Gère les messages de disponibilités (création, édition, reset, réouverture).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // 🔹 /dispos_admin publier
    .addSubcommand(sc =>
      sc.setName('publier')
        .setDescription('Publie les 7 messages de disponibilités dans un salon donné.')
        .addChannelOption(opt =>
          opt.setName('salon')
            .setDescription('Salon où publier les messages de disponibilités.')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('texte')
            .setDescription('Description commune (sinon texte par défaut). Ignoré si image_brute = true.')
            .setRequired(false)
        )
        .addAttachmentOption(opt =>
          opt.setName('image')
            .setDescription('Image à utiliser en mode "image brute" (sans embed).')
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt.setName('image_brute')
            .setDescription('Si vrai, poste uniquement la photo (sans embed).')
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt.setName('reactions')
            .setDescription('Ajouter automatiquement ✅ et ❌ (défaut : oui).')
            .setRequired(false)
        )
    )

    // 🔹 /dispos_admin modifier
    .addSubcommand(sc =>
      sc.setName('modifier')
        .setDescription('Modifie le contenu d’un ou plusieurs messages de disponibilités.')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon où se trouvent les messages de disponibilités.')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Choisis le jour à modifier ou "tous".')
            .setRequired(true)
            .addChoices(
              { name: 'Tous les jours', value: 'all' },
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
          o.setName('ids')
            .setDescription('ID du message (ou 7 IDs séparés pour "Tous les jours").')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('texte')
            .setDescription('Nouveau texte à afficher (ignoré si image_brute = true).')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('titre')
            .setDescription('Titre personnalisé (facultatif).')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('remplacer')
            .setDescription('Remplace entièrement la description de l’embed.')
            .setRequired(false)
        )
        .addAttachmentOption(o =>
          o.setName('image')
            .setDescription('Image à utiliser seule si image_brute = true.')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('image_brute')
            .setDescription('Si vrai, remplace l’embed par l’image seule.')
            .setRequired(false)
        )
    )

    // 🔹 /dispos_admin reinitialiser
    .addSubcommand(sc =>
      sc.setName('reinitialiser')
        .setDescription('Réinitialise les réactions d’un jour ou de tous les jours.')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon où se trouvent les messages de disponibilités.')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('jour')
            .setDescription('Choisis un jour ou "tous".')
            .setRequired(true)
            .addChoices(
              { name: 'Tous les jours', value: 'all' },
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
          o.setName('ids')
            .setDescription('ID du message (ou 7 IDs séparés pour "Tous les jours").')
            .setRequired(true)
        )
        .addBooleanOption(option =>
          option
            .setName('mention')
            .setDescription('Mentionner @everyone dans l’annonce publique.')
            .setRequired(false)
        )
    )

    // 🔹 /dispos_admin rouvrir
    .addSubcommand(sc =>
      sc.setName('rouvrir')
        .setDescription('Rouvre un ou plusieurs messages de disponibilités.')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon où se trouvent les messages de disponibilités.')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Choisis un jour ou "tous".')
            .setRequired(true)
            .addChoices(
              { name: 'Tous les jours', value: 'all' },
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
          o.setName('ids')
            .setDescription('ID du message (ou 7 IDs séparés pour "Tous les jours").')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('description')
            .setDescription('Description à afficher (défaut : texte standard). Ignoré si image_brute = true.')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('reactions')
            .setDescription('Réajouter automatiquement ✅ et ❌.')
            .setRequired(false)
        )
        .addAttachmentOption(o =>
          o.setName('image')
            .setDescription('Image à utiliser seule si image_brute = true.')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('image_brute')
            .setDescription('Si vrai, remplace l’embed par l’image seule.')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const me = guild.members.me;

    /* -------------------- SUBCOMMAND : PUBLIER -------------------- */
    if (sub === 'publier') {
      const channel = interaction.options.getChannel('salon');
      const image = interaction.options.getAttachment('image') || null;
      const imageBrute = interaction.options.getBoolean('image_brute') ?? false;
      const reactionsOpt = interaction.options.getBoolean('reactions');
      const shouldReact = reactionsOpt ?? true; // défaut : vrai

      let desc = interaction.options.getString('texte')?.trim() || DESC_PAR_DEFAUT;

      if (imageBrute && !image) {
        return interaction.reply({
          content: '❌ Tu as activé **image_brute**, mais aucune `image` n’a été fournie.',
          flags: MessageFlags.Ephemeral
        });
      }

      const regexMentions = /@everyone|@here|<@&\d+>/g;
      if (regexMentions.test(desc)) desc = desc.replace(regexMentions, '[mention bloquée 🚫]');

      const needed = new PermissionsBitField([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages
      ]);
      if (!channel.permissionsFor?.(me)?.has(needed)) {
        return interaction.reply({
          content: `❌ Je n’ai pas la permission d’écrire dans ${channel}.`,
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.reply({
        content: `🛠️ Publication des messages de disponibilités dans ${channel}…`,
        flags: MessageFlags.Ephemeral
      });

      const recap = [];
      const idsByJour = {};

      for (const jour of JOURS) {
        try {
          let msg;

          if (imageBrute && image) {
            msg = await channel.send({
              content: '',
              embeds: [],
              files: [{ attachment: image.url, name: image.name }],
              allowedMentions: { parse: [] }
            });
          } else {
            const titreMaj = TITRES[jour].replace(/📅\s*/i, '📅 ').toUpperCase();
            const embed = new EmbedBuilder()
              .setColor(COULEUR)
              .setTitle(titreMaj)
              .setDescription(desc)
              .setFooter({ text: 'INTER GALACTIQUE ⚫ Disponibilités' });

            msg = await channel.send({
              content: '',
              embeds: [embed],
              allowedMentions: { parse: [] }
            });
          }

          if (msg && shouldReact) {
            try { await msg.react('✅'); } catch {}
            try { await msg.react('❌'); } catch {}
          }

          idsByJour[jour] = msg.id;
          recap.push(`✅ ${jour} : message créé (ID: ${msg.id})`);
        } catch (err) {
          console.error(`Erreur ${jour}:`, err);
          recap.push(`❌ ${jour} : échec (voir console).`);
        }
      }

      const lignesIds = JOURS.map(j => `${j.padEnd(9, ' ')} → ${idsByJour[j] || '—'}`).join('\n');

      return interaction.followUp({
        content: [
          '✅ **Messages de disponibilités créés**',
          '```',
          recap.join('\n'),
          '```',
          '',
          '🧾 **Récap IDs (à conserver quelque part, pour /disponibilites et /dispos_admin)** :',
          '```',
          lignesIds,
          '```'
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
    }

    /* -------------------- SUBCOMMAND : MODIFIER -------------------- */
    if (sub === 'modifier') {
      const channel = interaction.options.getChannel('salon');
      const jourChoisi = interaction.options.getString('jour', true);
      let texte = interaction.options.getString('texte')?.trim();
      const titreOptionnel = interaction.options.getString('titre')?.trim() || null;
      const remplacer = interaction.options.getBoolean('remplacer') ?? false;
      const image = interaction.options.getAttachment('image') || null;
      const imageBrute = interaction.options.getBoolean('image_brute') ?? false;
      const idsInput = interaction.options.getString('ids', true);

      const { error, mapping, joursCibles } = parseIdsByJour(jourChoisi, idsInput);
      if (error) {
        return interaction.reply({
          content: error,
          flags: MessageFlags.Ephemeral
        });
      }

      if (imageBrute && !image) {
        return interaction.reply({
          content: '❌ Tu as activé **image_brute**, mais aucune `image` n’a été fournie.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (!imageBrute && !texte) {
        return interaction.reply({
          content: '❌ Le champ **texte** est vide.',
          flags: MessageFlags.Ephemeral
        });
      }

      texte = (texte || '').replace(/^["“”]|["“”]$/g, '').trim();
      const regexMentions = /@everyone|@here|<@&\d+>/g;
      if (regexMentions.test(texte)) texte = texte.replace(regexMentions, '[mention bloquée 🚫]');
      if (titreOptionnel && regexMentions.test(titreOptionnel)) {
        return interaction.reply({
          content: '❌ Le titre contient une mention bloquée.',
          flags: MessageFlags.Ephemeral
        });
      }

      const permissionsNécessaires = new PermissionsBitField([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages
      ]);
      if (!channel.permissionsFor?.(me)?.has(permissionsNécessaires)) {
        return interaction.reply({
          content: `❌ Je n’ai pas la permission d’écrire dans ${channel}.`,
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.reply({
        content: `🛠️ Modification des disponibilités (${jourChoisi === 'all' ? 'toute la semaine' : jourChoisi}) en cours...`,
        flags: MessageFlags.Ephemeral
      });

      const recap = [];
      const joursModifies = [];

      for (const jour of joursCibles) {
        const messageId = mapping[jour];
        if (!messageId) {
          recap.push(`⚠️ ${jour} : aucun ID fourni.`);
          continue;
        }

        try {
          const msg = await channel.messages.fetch(messageId).catch(() => null);
          if (!msg) {
            recap.push(`❌ ${jour} : message introuvable (ID invalide ?).`);
            continue;
          }

          if (imageBrute && image) {
            await msg.edit({
              content: '',
              embeds: [],
              files: [{ attachment: image.url, name: image.name }],
              allowedMentions: { parse: [] }
            });
          } else {
            const exist = msg.embeds?.[0];
            const titreBase = titreOptionnel || (exist?.title || TITRES[jour]);
            const titreFinal = titreBase.replace(/📅\s*/i, '📅 ').toUpperCase();

            const descriptionFinale = remplacer
              ? texte
              : `${texte}\n\n✅ **Présent**  |  ❌ **Absent**`;

            const embed = new EmbedBuilder()
              .setColor(COULEUR)
              .setTitle(titreFinal)
              .setDescription(descriptionFinale)
              .setFooter({ text: 'INTER GALACTIQUE ⚫ Disponibilités' });

            await msg.edit({ content: '', embeds: [embed], allowedMentions: { parse: [] } });
          }

          recap.push(`✅ ${jour} : message mis à jour.`);
          joursModifies.push(TITRES_MAJ[jour]);
        } catch (err) {
          console.error(`Erreur sur ${jour}:`, err);
          recap.push(`❌ ${jour} : échec de modification.`);
        }
      }

      if (joursModifies.length > 0) {
        const annonce = [
          '📢 **Mise à jour des disponibilités effectuée !**',
          `${joursModifies.join(' • ')}`,
          '\nMerci de vérifier et de réagir si nécessaire ✅❌'
        ].join('\n');
        try {
          await channel.send({ content: annonce, allowedMentions: { parse: [] } });
        } catch (err) {
          console.error('Erreur envoi annonce :', err);
        }
      }

      return interaction.followUp({
        content: [
          '✍️ **Modification terminée**',
          '```',
          recap.join('\n'),
          '```'
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
    }

    /* -------------------- SUBCOMMAND : REINITIALISER -------------------- */
    if (sub === 'reinitialiser') {
      const channel = interaction.options.getChannel('salon');
      const jourInput = interaction.options.getString('jour', true);
      const idsInput = interaction.options.getString('ids', true);
      const mentionEveryone = interaction.options.getBoolean('mention') ?? false;

      const { error, mapping, joursCibles } = parseIdsByJour(jourInput, idsInput);
      if (error) {
        return interaction.reply({
          content: error,
          flags: MessageFlags.Ephemeral
        });
      }

      const needPerms = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.ManageMessages,
      ];
      if (!channel.permissionsFor?.(me)?.has(needPerms)) {
        return interaction.reply({
          content: '❌ Permissions insuffisantes dans le salon des disponibilités (lecture, historique, écrire, réactions, gérer les messages).',
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.reply({
        content: `🧹 Réinitialisation des disponibilités (${jourInput === 'all' ? 'tous les jours' : jourInput})...`,
        flags: MessageFlags.Ephemeral
      });

      const recap = [];
      const joursResetOK = [];

      for (const jour of joursCibles) {
        const messageId = mapping[jour];
        if (!messageId) {
          recap.push(`⚠️ ${TITRES[jour]} : aucun ID fourni.`);
          continue;
        }

        try {
          const message = await channel.messages.fetch(messageId);
          await message.reactions.removeAll();
          await message.react('✅');
          await message.react('❌');
          recap.push(`✅ ${TITRES[jour]} : réactions réinitialisées.`);
          joursResetOK.push(TITRES[jour]);
        } catch (err) {
          console.error(`Erreur reset ${jour}:`, err);
          recap.push(`❌ ${TITRES[jour]} : erreur lors de la réinitialisation.`);
        }
      }

      if (joursResetOK.length > 0) {
        const annonce = [
          mentionEveryone ? '@everyone' : '',
          '🧹 **Réinitialisation des disponibilités effectuée !**',
          `${joursResetOK.join(' • ')}`,
          '\nRéagissez dès maintenant : ✅ Présent  |  ❌ Absent'
        ].filter(Boolean).join('\n');

        try {
          await channel.send({
            content: annonce,
            allowedMentions: mentionEveryone ? { parse: ['everyone'] } : { parse: [] }
          });
        } catch (err) {
          console.error('Erreur envoi annonce publique :', err);
        }
      }

      return interaction.followUp({
        content: [
          '🧹 **Réinitialisation terminée**',
          '```',
          recap.join('\n') || 'Aucune action effectuée.',
          '```'
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
    }

    /* -------------------- SUBCOMMAND : ROUVRIR -------------------- */
    if (sub === 'rouvrir') {
      const channel = interaction.options.getChannel('salon');
      const jourInput = interaction.options.getString('jour', true);
      const idsInput = interaction.options.getString('ids', true);
      const description = sanitize(interaction.options.getString('description') || DESCRIPTION_DEFAUT_ROUVRIR);
      const reAddReactions = interaction.options.getBoolean('reactions') ?? false;
      const image = interaction.options.getAttachment('image') || null;
      const imageBrute = interaction.options.getBoolean('image_brute') ?? false;

      const { error, mapping, joursCibles } = parseIdsByJour(jourInput, idsInput);
      if (error) {
        return interaction.reply({
          content: error,
          flags: MessageFlags.Ephemeral
        });
      }

      if (imageBrute && !image) {
        return interaction.reply({
          content: '❌ Tu as activé **image_brute**, mais aucune `image` n’a été fournie.',
          flags: MessageFlags.Ephemeral
        });
      }

      const need = new PermissionsBitField([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.SendMessages,
      ]);
      if (!channel.permissionsFor?.(me)?.has(need)) {
        return interaction.reply({
          content: `❌ Permissions insuffisantes dans ${channel} (voir/écrire/historique).`,
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.reply({
        content: '🔄 Réouverture des disponibilités…',
        flags: MessageFlags.Ephemeral
      });

      const recap = [];

      for (const jour of joursCibles) {
        const messageId = mapping[jour];
        if (!messageId) {
          recap.push(`⚠️ ${jour} : aucun ID fourni.`);
          continue;
        }

        try {
          const msg = await channel.messages.fetch(messageId).catch(() => null);
          if (!msg) {
            recap.push(`❌ ${jour} : message introuvable (ID invalide ?).`);
            continue;
          }

          if (imageBrute && image) {
            await msg.edit({
              content: '',
              embeds: [],
              files: [{ attachment: image.url, name: image.name }],
              allowedMentions: { parse: [] }
            });
          } else {
            const embed = new EmbedBuilder()
              .setColor(COULEUR)
              .setTitle(TITRES_MAJ[jour])
              .setDescription(description)
              .setFooter({ text: 'INTER GALACTIQUE ⚫ Disponibilités' });

            await msg.edit({ content: '', embeds: [embed], allowedMentions: { parse: [] } });
          }

          if (reAddReactions) {
            try { await msg.react('✅'); } catch {}
            try { await msg.react('❌'); } catch {}
          }

          recap.push(`✅ ${jour} : rouvert${reAddReactions ? ' (+ réactions)' : ''}.`);
        } catch (err) {
          console.error(`Erreur sur ${jour}:`, err);
          recap.push(`❌ ${jour} : erreur lors de la mise à jour.`);
        }
      }

      return interaction.followUp({
        content: [
          '✅ **Réouverture terminée.**',
          '```',
          recap.join('\n'),
          '```'
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
    }
  }
};