// commands/planning.js ✅ (SANS EMBED) + ✅ horaires par défaut 21:00→23:00 toutes les 20 min
// + ✅ possibilité d'afficher UN jour OU TOUT
//
// /planning show (jour optionnel)
// /planning set (jour + heure + titre + salon)
// /planning clear (jour)
// /planning post (salon optionnel, jour optionnel)
// /planning init (initialise la semaine avec les créneaux par défaut)

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

// accepte: "20:45-23:00" ou "20:45 → 23:00"
function parseTimeRange(input) {
  const raw = String(input || '').trim();
  const m = raw.match(/^([01]\d|2[0-3]):([0-5]\d)\s*(?:-|→|>|to)\s*([01]\d|2[0-3]):([0-5]\d)$/i);
  if (!m) return null;

  const start = `${m[1]}:${m[2]}`;
  const end = `${m[3]}:${m[4]}`;
  return { start, end, normalized: `${start}-${end}` };
}

/** Centre un texte dans une largeur fixe */
function centerText(txt, width = 22) {
  const t = String(txt || '').trim();
  if (t.length >= width) return t;
  const left = Math.floor((width - t.length) / 2);
  const right = width - t.length - left;
  return ' '.repeat(left) + t + ' '.repeat(right);
}

function lineSep(width = 22) {
  return '━'.repeat(width);
}

/* =========================
   Créneaux par défaut
   21:00 -> 23:00 toutes les 20 minutes
   => 21:00, 21:20, 21:40, 22:00, 22:20, 22:40, 23:00
========================= */

function minutesToHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function buildDefaultSlots({ start = '21:00', end = '23:00', stepMin = 20 } = {}) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = (sh * 60) + sm;
  const endMin = (eh * 60) + em;

  const out = [];
  for (let t = startMin; t <= endMin; t += stepMin) {
    out.push(minutesToHHMM(t));
  }
  return out;
}

/**
 * Supporte planning[jour] au format :
 * - tableau : [{ heure, titre, salonId }, ...]
 * - objet : { heure, titre, salonId }  (compat ancienne)
 */
function renderDayBlock(jour, value) {
  const width = 28;
  const title = centerText(dayLabelFR(jour), width);

  const header = [lineSep(width), title, lineSep(width)];

  const formatItem = (it) => {
    const heure = it?.heure || it?.time || null;
    const titre = it?.titre || it?.title || 'Session';
    const salonId = it?.salonId || it?.channelId || null;

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

  return ['```', ...header, ...bodyLines, '```'].join('\n');
}

/** Rend tout le planning ou un seul jour */
function renderPlanningMessage(planning = {}, clubLabel = 'PLANNING', onlyDay = null) {
  const blocks = [];
  blocks.push(`🗓️ **PLANNING — ${clubLabel}**`);

  if (onlyDay) {
    blocks.push(renderDayBlock(onlyDay, planning?.[onlyDay]));
    return blocks.join('\n\n');
  }

  for (const j of JOURS) blocks.push(renderDayBlock(j, planning?.[j]));
  return blocks.join('\n\n');
}

/** Découpe si > 2000 */
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

/** Construit une semaine complète avec slots par défaut */
function buildDefaultWeekPlanning({ titre = 'Session', salonId = null } = {}) {
  const slots = buildDefaultSlots({ start: '21:00', end: '23:00', stepMin: 20 });

  const dayItems = slots.map(h => ({
    heure: h,
    titre,
    salonId
  }));

  const planning = {};
  for (const j of JOURS) planning[j] = dayItems;
  return planning;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('planning')
    .setDescription('Gère le planning de la semaine (format texte clean).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // /planning show [jour]
    .addSubcommand(sc =>
      sc
        .setName('show')
        .setDescription('Affiche le planning (tous les jours ou un jour).')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Optionnel : afficher uniquement ce jour')
            .setRequired(false)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
    )

    // /planning set jour heure titre salon
    .addSubcommand(sc =>
      sc
        .setName('set')
        .setDescription('Définit/Modifie un créneau unique sur un jour.')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Jour (lundi..dimanche)')
            .setRequired(true)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
        .addStringOption(o =>
          o.setName('heure')
            .setDescription('Ex: 20:45-23:00 OU 21:20-21:40')
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

    // /planning clear jour
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

    // /planning post [salon] [jour]
    .addSubcommand(sc =>
      sc
        .setName('post')
        .setDescription('Poste le planning (tous les jours ou un jour) dans un salon.')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon cible (défaut: salon actuel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Optionnel : poster uniquement ce jour')
            .setRequired(false)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
    )

    // /planning init [titre] [salon]
    .addSubcommand(sc =>
      sc
        .setName('init')
        .setDescription('Initialise la semaine avec les créneaux par défaut (21h→23h / 20 min).')
        .addStringOption(o =>
          o.setName('titre')
            .setDescription('Titre par défaut (ex: Session)')
            .setRequired(false)
        )
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon par défaut (optionnel)')
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

    // ---------- INIT (créneaux par défaut) ----------
    if (sub === 'init') {
      const titre = interaction.options.getString('titre') || 'Session';
      const salon = interaction.options.getChannel('salon');

      const week = buildDefaultWeekPlanning({ titre: String(titre).slice(0, 60), salonId: salon?.id || null });

      updateGuildConfig(guild.id, { planning: week });

      const msg = renderPlanningMessage(week, clubLabel, null);
      const chunks = chunkMessage(msg);

      await interaction.reply({
        content: `✅ Planning initialisé (21:00 → 23:00 / toutes les 20 min).\n\n${chunks[0]}`,
        ephemeral: true
      });

      for (const extra of chunks.slice(1)) {
        await interaction.followUp({ content: extra, ephemeral: true }).catch(() => {});
      }
      return;
    }

    // ---------- SHOW (jour optionnel) ----------
    if (sub === 'show') {
      const jourOpt = normalizeJour(interaction.options.getString('jour'));
      const msg = renderPlanningMessage(currentPlanning, clubLabel, jourOpt);
      const chunks = chunkMessage(msg);

      await interaction.reply({ content: chunks[0], ephemeral: false });
      for (const extra of chunks.slice(1)) {
        await interaction.followUp({ content: extra, ephemeral: false }).catch(() => {});
      }
      return;
    }

    // ---------- SET (un créneau) ----------
    if (sub === 'set') {
      const jour = normalizeJour(interaction.options.getString('jour'));
      const heureIn = interaction.options.getString('heure');
      const titre = interaction.options.getString('titre') || 'Session';
      const salon = interaction.options.getChannel('salon');

      if (!jour) return interaction.reply({ content: '❌ Jour invalide.', ephemeral: true });

      const parsed = parseTimeRange(heureIn);
      if (!parsed) {
        return interaction.reply({
          content: '❌ Horaire invalide. Format attendu : `HH:MM-HH:MM` (ex: `21:20-21:40`).',
          ephemeral: true
        });
      }

      // 🔧 on stocke en tableau (multi-créneaux)
      const next = { ...(currentPlanning || {}) };
      const existing = next[jour];

      const arr =
        Array.isArray(existing) ? [...existing] :
        (existing && typeof existing === 'object') ? [existing] :
        [];

      arr.push({
        heure: parsed.normalized,
        titre: String(titre).slice(0, 60),
        salonId: salon?.id || null
      });

      // tri par heure (facultatif mais propre)
      arr.sort((a, b) => String(a.heure).localeCompare(String(b.heure)));

      next[jour] = arr;
      updateGuildConfig(guild.id, { planning: next });

      const preview = renderDayBlock(jour, next[jour]);

      return interaction.reply({
        content: `✅ Créneau ajouté sur **${dayLabelFR(jour)}** : **${parsed.normalized}** — ${titre}${salon ? ` • <#${salon.id}>` : ''}\n\n${preview}`,
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

    // ---------- POST (jour optionnel) ----------
    if (sub === 'post') {
      const targetChannel = interaction.options.getChannel('salon') || interaction.channel;
      const jourOpt = normalizeJour(interaction.options.getString('jour'));

      const me = guild.members.me;
      const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
      if (!targetChannel?.permissionsFor?.(me)?.has(needed)) {
        return interaction.reply({
          content: `❌ Je ne peux pas écrire dans <#${targetChannel?.id || 'inconnu'}>.`,
          ephemeral: true
        });
      }

      const msg = renderPlanningMessage(currentPlanning, clubLabel, jourOpt);
      const chunks = chunkMessage(msg);

      for (const part of chunks) {
        await targetChannel.send({ content: part }).catch(() => {});
      }

      return interaction.reply({
        content: jourOpt
          ? `📌 Planning posté (**${dayLabelFR(jourOpt)}**) dans <#${targetChannel.id}>.`
          : `📌 Planning posté (**semaine complète**) dans <#${targetChannel.id}>.`,
        ephemeral: true
      });
    }
  }
};
