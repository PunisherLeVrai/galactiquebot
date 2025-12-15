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
  String(t || '').replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]');

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
    const parts = idsInput.split(/[\s,;]+/).filter(Boolean);

    if (jourChoisi === 'all') {
      if (parts.length !== 7) {
        return { error: '❌ Pour **tous les jours**, tu dois fournir 7 IDs.' };
      }
      const mapping = {};
      JOURS.forEach((j, i) => mapping[j] = parts[i]);
      return { mapping, joursCibles: [...JOURS] };
    }

    return {
      mapping: { [jourChoisi]: parts[0] },
      joursCibles: [jourChoisi]
    };
  }

  // 🔹 Fallback servers.json
  if (jourChoisi === 'all') {
    const missing = JOURS.filter(j => !dispo[j]);
    if (missing.length) {
      return { error: `❌ IDs manquants dans servers.json → ${missing.join(', ')}` };
    }
    return { mapping: { ...dispo }, joursCibles: [...JOURS] };
  }

  if (!dispo[jourChoisi]) {
    return { error: `❌ ID manquant dans servers.json → dispoMessages.${jourChoisi}` };
  }

  return {
    mapping: { [jourChoisi]: dispo[jourChoisi] },
    joursCibles: [jourChoisi]
  };
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
        )
        .addBooleanOption(o =>
          o.setName('reactions')
            .setDescription('Ajouter ✅ ❌ (défaut : oui)')
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
          o.setName('ids')
            .setDescription('Override ID(s) (optionnel)')
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
          o.setName('ids')
            .setDescription('Override ID(s) (optionnel)')
        )
    ),

  /* ============================================================
     ⚙️ EXECUTE
  ============================================================ */

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('salon');
    const guild = interaction.guild;
    const me = guild.members.me;

    const { guild: guildCfg } = getConfigFromInteraction(interaction);
    const color = getEmbedColor(guildCfg);
    const clubName = guildCfg?.clubName || guild.name;

    /* -------------------- PUBLIER -------------------- */
    if (sub === 'publier') {
      const texte = sanitize(interaction.options.getString('texte') || DESC_PAR_DEFAUT);
      const reactions = interaction.options.getBoolean('reactions') ?? true;

      const idsByJour = {};

      for (const jour of JOURS) {
        const embed = new EmbedBuilder()
          .setColor(color)
          .setTitle(TITRES[jour])
          .setDescription(texte)
          .setFooter({ text: `${clubName} ⚫ Disponibilités` });

        const msg = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
        if (reactions) {
          await msg.react('✅');
          await msg.react('❌');
        }
        idsByJour[jour] = msg.id;
      }

      // 💾 Sauvegarde automatique
      await updateGuildConfig(guild.id, { dispoMessages: idsByJour });

      return interaction.reply({
        content: '✅ Messages publiés **et IDs sauvegardés automatiquement dans servers.json**.',
        ephemeral: true
      });
    }

    /* -------------------- MODIFIER / RESET / ROUVRIR -------------------- */
    const jour = interaction.options.getString('jour');
    const idsInput = interaction.options.getString('ids');
    const { error, mapping, joursCibles } =
      resolveIdsMapping(guildCfg, jour, idsInput);

    if (error) {
      return interaction.reply({ content: error, ephemeral: true });
    }

    for (const j of joursCibles) {
      const msg = await channel.messages.fetch(mapping[j]).catch(() => null);
      if (!msg) continue;

      if (sub === 'modifier') {
        const texte = sanitize(interaction.options.getString('texte'));
        const embed = EmbedBuilder.from(msg.embeds[0])
          .setColor(color)
          .setDescription(`${texte}\n\n✅ **Présent** | ❌ **Absent**`);
        await msg.edit({ embeds: [embed] });
      }

      if (sub === 'reinitialiser') {
        await msg.reactions.removeAll();
        await msg.react('✅');
        await msg.react('❌');
      }

      if (sub === 'rouvrir') {
        const embed = EmbedBuilder.from(msg.embeds[0])
          .setColor(color)
          .setDescription(DESCRIPTION_DEFAUT_ROUVRIR);
        await msg.edit({ embeds: [embed] });
      }
    }

    return interaction.reply({
      content: `✅ **${sub} effectué** via servers.json.`,
      ephemeral: true
    });
  }
};
