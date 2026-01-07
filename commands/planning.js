// commands/planning.js  ✅ VERSION SANS EMBED (format clean pro)
// - /planning show [jour]  -> affiche le planning (1 jour ou toute la semaine)
// - /planning set          -> ajoute un créneau à un jour (ou remplace si mode=replace)
// - /planning clear        -> supprime un jour (le remet au défaut si tu veux via reset)
// - /planning post [salon] [jour] -> poste le planning (1 jour ou semaine)

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

function centerText(txt, width = 28) {
  const t = String(txt || '').trim();
  if (t.length >= width) return t;
  const left = Math.floor((width - t.length) / 2);
  const right = width - t.length - left;
  return ' '.repeat(left) + t + ' '.repeat(right);
}

function lineSep(width = 28) {
  return '━'.repeat(width);
}

/* =========================
   DEFAULT PLANNING (AUTO)
   21:00 → 23:00 toutes les 20 min
========================= */
function pad2(n) { return String(n).padStart(2, '0'); }

function buildDefaultSlots({
  startHour = 21,
  startMinute = 0,
  endHour = 23,
  endMinute = 0,
  stepMin = 20,
  titre = 'Session',
  salonId = null
} = {}) {
  // créneaux en "HH:MM-HH:MM" : 21:00-21:20 ... 22:40-23:00
  const slots = [];

  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  for (let t = startTotal; t + stepMin <= endTotal; t += stepMin) {
    const sH = Math.floor(t / 60);
    const sM = t % 60;
    const e = t + stepMin;
    const eH = Math.floor(e / 60);
    const eM = e % 60;

    slots.push({
      heure: `${pad2(sH)}:${pad2(sM)}-${pad2(eH)}:${pad2(eM)}`,
      titre,
      salonId
    });
  }

  return slots;
}

function buildDefaultPlanningForAllDays(defaultOptions = {}) {
  const p = {};
  for (const j of JOURS) p[j] = buildDefaultSlots(defaultOptions);
  return p;
}

function mergeWithDefaults(currentPlanning, defaultPlanning) {
  // si planning vide -> defaults complets
  if (!currentPlanning || typeof currentPlanning !== 'object') return defaultPlanning;

  // si un jour absent -> defaults pour ce jour
  const out = { ...defaultPlanning, ...currentPlanning };
  for (const j of JOURS) {
    if (!out[j] || (Array.isArray(out[j]) && out[j].length === 0)) {
      out[j] = defaultPlanning[j];
    }
  }
  return out;
}

/* =========================
   RENDER TEXT
========================= */
function renderDayBlock(jour, value) {
  const width = 28;
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

function renderPlanningMessage(planning = {}, clubLabel = 'PLANNING', onlyJour = null) {
  const blocks = [];
  blocks.push(`🗓️ **PLANNING — ${clubLabel}**`);

  if (onlyJour) {
    blocks.push(renderDayBlock(onlyJour, planning?.[onlyJour]));
  } else {
    for (const j of JOURS) blocks.push(renderDayBlock(j, planning?.[j]));
  }

  return blocks.join('\n\n');
}

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

/* =========================
   HELPERS DATA
========================= */
function normalizeDayValueToArray(dayVal) {
  if (!dayVal) return [];
  if (Array.isArray(dayVal)) return dayVal.filter(x => x && typeof x === 'object');
  if (typeof dayVal === 'object') return [dayVal];
  return [];
}

/* =========================
   COMMAND
========================= */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('planning')
    .setDescription('Gère le planning de la semaine (format texte clean).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // SHOW
    .addSubcommand(sc =>
      sc
        .setName('show')
        .setDescription('Affiche le planning (jour ou semaine).')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Optionnel : afficher un seul jour')
            .setRequired(false)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
    )

    // INIT (optionnel mais super pratique)
    .addSubcommand(sc =>
      sc
        .setName('init')
        .setDescription('Initialise le planning par défaut : 21:00-23:00 toutes les 20 min.')
        .addStringOption(o =>
          o.setName('titre')
            .setDescription('Titre par défaut (ex: Session officielle)')
            .setRequired(false)
        )
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon par défaut (optionnel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )

    // SET
    .addSubcommand(sc =>
      sc
        .setName('set')
        .setDescription('Ajoute un créneau à un jour (ou remplace la journée).')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Jour (lundi..dimanche)')
            .setRequired(true)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
        .addStringOption(o =>
          o.setName('heure')
            .setDescription('Ex: 21:00-21:20')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('titre')
            .setDescription('Ex: Session / Match / Entraînement')
            .setRequired(false)
        )
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon lié (optionnel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('mode')
            .setDescription('Ajouter (add) ou remplacer la journée (replace)')
            .setRequired(false)
            .addChoices(
              { name: 'Ajouter', value: 'add' },
              { name: 'Remplacer', value: 'replace' }
            )
        )
    )

    // CLEAR
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

    // POST
    .addSubcommand(sc =>
      sc
        .setName('post')
        .setDescription('Poste le planning dans un salon (jour ou semaine).')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon cible (défaut: salon actuel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Optionnel : poster un seul jour')
            .setRequired(false)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    const { guild: guildConfig } = getConfigFromInteraction(interaction) || {};
    const clubLabel = guildConfig?.clubName || guild?.name || 'INTER GALACTIQUE';

    // 🔥 défaut auto : 21:00-23:00 toutes les 20 minutes
    const defaultOptions = {
      titre: 'Session',
      salonId: null
    };
    const defaultPlanning = buildDefaultPlanningForAllDays(defaultOptions);

    const currentPlanningRaw =
      (guildConfig?.planning && typeof guildConfig.planning === 'object')
        ? guildConfig.planning
        : {};

    // planning "actif" = current + defaults si manque des jours
    const activePlanning = mergeWithDefaults(currentPlanningRaw, defaultPlanning);

    // ---------- SHOW ----------
    if (sub === 'show') {
      const jourOpt = normalizeJour(interaction.options.getString('jour'));
      const msg = renderPlanningMessage(activePlanning, clubLabel, jourOpt);
      const chunks = chunkMessage(msg);

      await interaction.reply({ content: chunks[0], ephemeral: false });
      for (const extra of chunks.slice(1)) {
        await interaction.followUp({ content: extra, ephemeral: false }).catch(() => {});
      }
      return;
    }

    // ---------- INIT ----------
    if (sub === 'init') {
      const titre = interaction.options.getString('titre') || 'Session';
      const salon = interaction.options.getChannel('salon');

      const p = buildDefaultPlanningForAllDays({
        titre: String(titre).slice(0, 60),
        salonId: salon?.id || null
      });

      updateGuildConfig(guild.id, { planning: p });

      return interaction.reply({
        content: `✅ Planning par défaut initialisé (**21:00 → 23:00 / toutes les 20 min**)${salon ? ` • Salon : <#${salon.id}>` : ''}.`,
        ephemeral: true
      });
    }

    // ---------- SET ----------
    if (sub === 'set') {
      const jour = normalizeJour(interaction.options.getString('jour'));
      const heureIn = interaction.options.getString('heure');
      const titre = interaction.options.getString('titre') || 'Session';
      const salon = interaction.options.getChannel('salon');
      const mode = (interaction.options.getString('mode') || 'add').toLowerCase();

      if (!jour) return interaction.reply({ content: '❌ Jour invalide.', ephemeral: true });

      const parsed = parseTimeRange(heureIn);
      if (!parsed) {
        return interaction.reply({
          content: '❌ Horaire invalide. Format attendu : `HH:MM-HH:MM` (ex: `21:00-21:20`).',
          ephemeral: true
        });
      }

      const newItem = {
        heure: parsed.normalized,
        titre: String(titre).slice(0, 60),
        salonId: salon?.id || null
      };

      // base = activePlanning (qui inclut déjà le défaut)
      const nextPlanning = { ...activePlanning };

      if (mode === 'replace') {
        nextPlanning[jour] = [newItem];
      } else {
        // add
        const arr = normalizeDayValueToArray(nextPlanning[jour]);
        arr.push(newItem);

        // tri simple par heure de début
        arr.sort((a, b) => String(a.heure || '').localeCompare(String(b.heure || '')));
        nextPlanning[jour] = arr;
      }

      updateGuildConfig(guild.id, { planning: nextPlanning });

      const preview = renderDayBlock(jour, nextPlanning[jour]);

      return interaction.reply({
        content: `✅ **${dayLabelFR(jour)}** mis à jour (${mode === 'replace' ? 'remplacé' : 'ajouté'}).\n\n${preview}`,
        ephemeral: true
      });
    }

    // ---------- CLEAR ----------
    if (sub === 'clear') {
      const jour = normalizeJour(interaction.options.getString('jour'));
      if (!jour) return interaction.reply({ content: '❌ Jour invalide.', ephemeral: true });

      // on supprime le jour du planning sauvegardé
      const next = { ...(currentPlanningRaw || {}) };
      delete next[jour];

      updateGuildConfig(guild.id, { planning: next });

      return interaction.reply({
        content: `🗑️ Jour supprimé : **${dayLabelFR(jour)}** (il réaffichera le défaut automatiquement).`,
        ephemeral: true
      });
    }

    // ---------- POST ----------
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

      const msg = renderPlanningMessage(activePlanning, clubLabel, jourOpt);
      const chunks = chunkMessage(msg);

      for (const part of chunks) {
        await targetChannel.send({ content: part }).catch(() => {});
      }

      return interaction.reply({
        content: `📌 Planning posté dans <#${targetChannel.id}>${jourOpt ? ` (jour : **${dayLabelFR(jourOpt)}**)` : ''}.`,
        ephemeral: true
      });
    }
  }
};
