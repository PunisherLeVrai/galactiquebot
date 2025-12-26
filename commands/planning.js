// commands/planning.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder
} = require('discord.js');

const { getConfigFromInteraction, updateGuildConfig } = require('../utils/config');

const DEFAULT_COLOR = 0xff4db8;

function getEmbedColor(cfg) {
  const hex = cfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

const JOURS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];

function normalizeJour(j) {
  const x = String(j || '').trim().toLowerCase();
  return JOURS.includes(x) ? x : null;
}

// accepte: "20:45-23:00" ou "20:45 → 23:00"
function parseTimeRange(input) {
  const raw = String(input || '').trim();
  const m = raw.match(/^([01]\d|2[0-3]):([0-5]\d)\s*(?:-|→|>|to)\s*([01]\d|2[0-3]):([0-5]\d)$/i);
  if (!m) return null;

  const start = `${m[1]}:${m[2]}`;
  const end = `${m[3]}:${m[4]}`;
  return { start, end, normalized: `${start}-${end}` };
}

function dayLabelFR(jour) {
  const map = {
    lundi: 'Lundi',
    mardi: 'Mardi',
    mercredi: 'Mercredi',
    jeudi: 'Jeudi',
    vendredi: 'Vendredi',
    samedi: 'Samedi',
    dimanche: 'Dimanche'
  };
  return map[jour] || jour;
}

function formatPlanningLines(planning = {}) {
  const lines = [];

  for (const j of JOURS) {
    const item = planning?.[j];
    if (!item || typeof item !== 'object') {
      lines.push(`**${dayLabelFR(j)}** : _—_`);
      continue;
    }

    const heure = item.heure || item.time || null;
    const titre = item.titre || item.title || 'Session';
    const salonId = item.salonId || item.channelId || null;

    const hourStr = heure ? `**${heure}**` : '_Horaire non défini_';
    const chanStr = salonId ? ` • <#${salonId}>` : '';

    lines.push(`**${dayLabelFR(j)}** : ${hourStr} — ${titre}${chanStr}`);
  }

  return lines;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('planning')
    .setDescription('Gère le planning de la semaine.')

    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sc =>
      sc
        .setName('show')
        .setDescription('Affiche le planning.')
    )

    .addSubcommand(sc =>
      sc
        .setName('set')
        .setDescription('Définit/Modifie un jour du planning.')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Jour (lundi..dimanche)')
            .setRequired(true)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
        .addStringOption(o =>
          o.setName('heure')
            .setDescription('Ex: 20:45-23:00')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('titre')
            .setDescription('Ex: Session officielle / Match / Entraînement')
            .setRequired(false)
        )
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon lié (optionnel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )

    .addSubcommand(sc =>
      sc
        .setName('clear')
        .setDescription('Supprime un jour du planning.')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Jour (lundi..dimanche)')
            .setRequired(true)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
    )

    .addSubcommand(sc =>
      sc
        .setName('post')
        .setDescription('Poste le planning dans un salon.')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon cible (défaut: salon actuel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    const { guild: guildConfig } = getConfigFromInteraction(interaction) || {};
    const embedColor = getEmbedColor(guildConfig);
    const clubLabel = guildConfig?.clubName || guild?.name || 'INTER GALACTIQUE';

    const currentPlanning = (guildConfig?.planning && typeof guildConfig.planning === 'object')
      ? guildConfig.planning
      : {};

    // ---------- SHOW ----------
    if (sub === 'show') {
      const lines = formatPlanningLines(currentPlanning);

      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`🗓️ Planning — ${clubLabel}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${clubLabel} • Planning` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: false });
    }

    // ---------- SET ----------
    if (sub === 'set') {
      const jour = normalizeJour(interaction.options.getString('jour'));
      const heureIn = interaction.options.getString('heure');
      const titre = interaction.options.getString('titre') || 'Session';
      const salon = interaction.options.getChannel('salon');

      if (!jour) {
        return interaction.reply({ content: '❌ Jour invalide.', ephemeral: true });
      }

      const parsed = parseTimeRange(heureIn);
      if (!parsed) {
        return interaction.reply({
          content: '❌ Horaire invalide. Format attendu : `HH:MM-HH:MM` (ex: `20:45-23:00`).',
          ephemeral: true
        });
      }

      const patch = {
        planning: {
          [jour]: {
            heure: parsed.normalized,
            titre: String(titre).slice(0, 60),
            salonId: salon?.id || null
          }
        }
      };

      updateGuildConfig(guild.id, patch);

      return interaction.reply({
        content: `✅ Planning mis à jour : **${dayLabelFR(jour)}** → **${parsed.normalized}** — ${titre}${salon ? ` • <#${salon.id}>` : ''}`,
        ephemeral: true
      });
    }

    // ---------- CLEAR ----------
    if (sub === 'clear') {
      const jour = normalizeJour(interaction.options.getString('jour'));
      if (!jour) return interaction.reply({ content: '❌ Jour invalide.', ephemeral: true });

      // on supprime en écrivant null puis en nettoyant
      const next = { ...(currentPlanning || {}) };
      delete next[jour];

      updateGuildConfig(guild.id, { planning: next });

      return interaction.reply({
        content: `🗑️ Jour supprimé du planning : **${dayLabelFR(jour)}**`,
        ephemeral: true
      });
    }

    // ---------- POST ----------
    if (sub === 'post') {
      const targetChannel = interaction.options.getChannel('salon') || interaction.channel;

      const me = guild.members.me;
      const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
      if (!targetChannel?.permissionsFor?.(me)?.has(needed)) {
        return interaction.reply({
          content: `❌ Je ne peux pas écrire dans <#${targetChannel?.id || 'inconnu'}>.`,
          ephemeral: true
        });
      }

      const lines = formatPlanningLines(currentPlanning);

      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`🗓️ Planning — ${clubLabel}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${clubLabel} • Planning` })
        .setTimestamp();

      await targetChannel.send({ embeds: [embed] });

      return interaction.reply({
        content: `📌 Planning posté dans <#${targetChannel.id}>.`,
        ephemeral: true
      });
    }
  }
};
