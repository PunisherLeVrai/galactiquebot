// commands/planning.js  ✅ VERSION SANS EMBED (format clean pro)
// - /planning show  -> affiche le planning (texte)
// - /planning set   -> définit/écrase le jour
// - /planning clear -> supprime un jour
// - /planning post  -> poste le planning dans un salon

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

const { getConfigFromInteraction, updateGuildConfig } = require('../utils/config');

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

/** Centre un texte dans une largeur fixe (sans dépendre des polices) */
function centerText(txt, width = 22) {
  const t = String(txt || '').trim();
  if (t.length >= width) return t;
  const left = Math.floor((width - t.length) / 2);
  const right = width - t.length - left;
  return ' '.repeat(left) + t + ' '.repeat(right);
}

function lineSep(width = 22) {
  // style comme ton screen
  return '━'.repeat(width);
}

/**
 * Rend une "carte" texte comme ton screen:
 * ━━━━━━━━━━━━
 *      LUNDI
 * ━━━━━━━━━━━━
 * 20:45-23:00 ▸ Session • #salon
 *
 * Supporte planning[jour] au format:
 * - objet: { heure, titre, salonId }
 * - ou tableau d'objets: [{ heure, titre, salonId }, ...]
 */
function renderDayBlock(jour, value) {
  const width = 28; // un poil plus large pour un rendu clean sur mobile
  const title = centerText(dayLabelFR(jour), width);

  const header = [
    lineSep(width),
    title,
    lineSep(width)
  ];

  const formatItem = (it) => {
    const heure = it?.heure || it?.time || null;
    const titre = it?.titre || it?.title || 'Session';
    const salonId = it?.salonId || it?.channelId || null;

    // "Joueur par défaut : Dylan | Postes" => ici on met "—" si vide
    const hourStr = heure ? `${heure}` : '—';
    const chanStr = salonId ? ` • <#${salonId}>` : '';

    return `${hourStr} ▸ ${titre}${chanStr}`;
  };

  let bodyLines = [];

  if (!value) {
    bodyLines = ['—'];
  } else if (Array.isArray(value)) {
    const items = value.filter(x => x && typeof x === 'object');
    bodyLines = items.length ? items.map(formatItem) : ['—'];
  } else if (typeof value === 'object') {
    bodyLines = [formatItem(value)];
  } else {
    bodyLines = ['—'];
  }

  // bloc final (dans un code block pour garder l’alignement)
  return ['```', ...header, ...bodyLines, '```'].join('\n');
}

/** Rend tout le planning en blocs (1 bloc / jour) + découpe si besoin */
function renderPlanningMessage(planning = {}, clubLabel = 'PLANNING') {
  const blocks = [];

  // En-tête simple (hors code block)
  blocks.push(`🗓️ **PLANNING — ${clubLabel}**`);

  for (const j of JOURS) {
    blocks.push(renderDayBlock(j, planning?.[j]));
  }

  return blocks.join('\n\n');
}

/** Découpe si jamais le message dépasse 2000 caractères */
function chunkMessage(str, limit = 1900) {
  const parts = [];
  let cur = '';
  const lines = String(str || '').split('\n');

  for (const line of lines) {
    if ((cur + '\n' + line).length > limit) {
      parts.push(cur);
      cur = line;
    } else {
      cur = cur ? (cur + '\n' + line) : line;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('planning')
    .setDescription('Gère le planning de la semaine (format texte clean).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sc =>
      sc.setName('show').setDescription('Affiche le planning.')
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
    const clubLabel = guildConfig?.clubName || guild?.name || 'INTER GALACTIQUE';

    const currentPlanning = (guildConfig?.planning && typeof guildConfig.planning === 'object')
      ? guildConfig.planning
      : {};

    // ---------- SHOW ----------
    if (sub === 'show') {
      const msg = renderPlanningMessage(currentPlanning, clubLabel);
      const chunks = chunkMessage(msg);

      // 1er en reply, le reste en followUp si besoin
      await interaction.reply({ content: chunks[0], ephemeral: false });
      for (const extra of chunks.slice(1)) {
        await interaction.followUp({ content: extra, ephemeral: false }).catch(() => {});
      }
      return;
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

      // aperçu directement au format final (super utile)
      const preview = renderDayBlock(jour, patch.planning[jour]);

      return interaction.reply({
        content: `✅ **${dayLabelFR(jour)}** mis à jour.\n\n${preview}`,
        ephemeral: true
      });
    }

    // ---------- CLEAR ----------
    if (sub === 'clear') {
      const jour = normalizeJour(interaction.options.getString('jour'));
      if (!jour) return interaction.reply({ content: '❌ Jour invalide.', ephemeral: true });

      const next = { ...(currentPlanning || {}) };
      delete next[jour];

      updateGuildConfig(guild.id, { planning: next });

      return interaction.reply({
        content: `🗑️ Jour supprimé : **${dayLabelFR(jour)}**`,
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

      const msg = renderPlanningMessage(currentPlanning, clubLabel);
      const chunks = chunkMessage(msg);

      for (const part of chunks) {
        await targetChannel.send({ content: part }).catch(() => {});
      }

      return interaction.reply({
        content: `📌 Planning posté dans <#${targetChannel.id}>.`,
        ephemeral: true
      });
    }
  }
};
