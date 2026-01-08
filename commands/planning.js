// commands/planning.js ✅ TEXTE ONLY — PLANNING VIDE PAR DÉFAUT
// - /planning show [jour]              -> affiche (jour OU semaine)
// - /planning init [jour] [titre] [salon] -> génère 21:00-23:00 toutes les 20min (jour OU semaine)
// - /planning set jour heure [titre] [salon] -> met un créneau spécifique sur le jour (remplace la journée)
// - /planning clear jour               -> vide le jour
// - /planning post [salon] [jour]      -> poste (jour OU semaine)

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

// accepte: "21:00-23:00" ou "21:00 → 23:00"
function parseTimeRange(input) {
  const raw = String(input || '').trim();
  const m = raw.match(/^([01]\d|2[0-3]):([0-5]\d)\s*(?:-|→|>|to)\s*([01]\d|2[0-3]):([0-5]\d)$/i);
  if (!m) return null;

  const start = `${m[1]}:${m[2]}`;
  const end = `${m[3]}:${m[4]}`;
  return { start, end, normalized: `${start}-${end}` };
}

/* ===== TEMPLATE 21:00 → 23:00 toutes les 20 min ===== */
function pad2(n) { return String(n).padStart(2, '0'); }

function buildSlots21to23(stepMin = 20) {
  const slots = [];
  const start = 21 * 60; // 21:00
  const end = 23 * 60;   // 23:00

  for (let t = start; t + stepMin <= end; t += stepMin) {
    const sH = Math.floor(t / 60);
    const sM = t % 60;
    const e = t + stepMin;
    const eH = Math.floor(e / 60);
    const eM = e % 60;

    slots.push(`${pad2(sH)}:${pad2(sM)}-${pad2(eH)}:${pad2(eM)}`);
  }
  return slots;
}

function dayTemplate({ titre = 'Session', salonId = null } = {}) {
  return buildSlots21to23(20).map(h => ({
    heure: h,
    titre,
    salonId
  }));
}

/* ===== RENDER (mix des 2, clean) ===== */
function lineSep(width = 28) { return '━'.repeat(width); }

function centerText(txt, width = 28) {
  const t = String(txt || '').trim();
  if (t.length >= width) return t;
  const left = Math.floor((width - t.length) / 2);
  const right = width - t.length - left;
  return ' '.repeat(left) + t + ' '.repeat(right);
}

function formatItem(it) {
  const heure = it?.heure || '—';
  const titre = it?.titre || 'Session';
  const salonId = it?.salonId || null;
  const chan = salonId ? ` • <#${salonId}>` : '';
  return `${heure} ▸ ${titre}${chan}`;
}

function renderDayBlock(jour, items) {
  const width = 28;
  const header = [
    lineSep(width),
    centerText(dayLabelFR(jour), width),
    lineSep(width)
  ];

  const list = Array.isArray(items) ? items : [];
  const body = list.length ? list.map(formatItem) : ['—'];

  return ['```', ...header, ...body, '```'].join('\n');
}

function renderWeek(planning) {
  return JOURS.map(j => renderDayBlock(j, planning?.[j])).join('\n\n');
}

function chunkMessage(str, limit = 1900) {
  const parts = [];
  let cur = '';
  for (const line of String(str || '').split('\n')) {
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

/* ===== DATA ===== */
function getSavedPlanning(guildConfig) {
  const p = guildConfig?.planning;
  return (p && typeof p === 'object') ? p : {}; // ✅ vide par défaut
}

function cleanDayItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(x => x && typeof x === 'object')
    .map(x => ({
      heure: String(x.heure || '').slice(0, 11),
      titre: String(x.titre || 'Session').slice(0, 60),
      salonId: x.salonId ? String(x.salonId) : null
    }))
    .filter(x => x.heure);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('planning')
    .setDescription('Planning (texte) — jour ou semaine.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

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

    .addSubcommand(sc =>
      sc
        .setName('init')
        .setDescription('Génère le template 21:00-23:00 (toutes les 20 min) sur un jour ou semaine.')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Optionnel : générer un seul jour')
            .setRequired(false)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
        .addStringOption(o =>
          o.setName('titre')
            .setDescription('Titre du template (ex: Session officielle)')
            .setRequired(false)
        )
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon (optionnel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )

    .addSubcommand(sc =>
      sc
        .setName('set')
        .setDescription('Met un créneau spécifique sur un jour (remplace la journée).')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Jour')
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
            .setDescription('Ex: Match / Session officielle')
            .setRequired(false)
        )
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon (optionnel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )

    .addSubcommand(sc =>
      sc
        .setName('clear')
        .setDescription('Vide un jour du planning.')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Jour')
            .setRequired(true)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
    )

    .addSubcommand(sc =>
      sc
        .setName('post')
        .setDescription('Poste le planning (jour ou semaine) dans un salon.')
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
    const savedPlanning = getSavedPlanning(guildConfig);

    // SHOW
    if (sub === 'show') {
      const jourOpt = normalizeJour(interaction.options.getString('jour'));

      const content = jourOpt
        ? renderDayBlock(jourOpt, cleanDayItems(savedPlanning[jourOpt]))
        : renderWeek(Object.fromEntries(JOURS.map(j => [j, cleanDayItems(savedPlanning[j])])));

      const chunks = chunkMessage(content);
      await interaction.reply({ content: chunks[0], ephemeral: false });
      for (const extra of chunks.slice(1)) {
        await interaction.followUp({ content: extra, ephemeral: false }).catch(() => {});
      }
      return;
    }

    // INIT (template 21-23 / 20 min)
    if (sub === 'init') {
      const jourOpt = normalizeJour(interaction.options.getString('jour'));
      const titre = interaction.options.getString('titre') || 'Session';
      const salon = interaction.options.getChannel('salon');
      const salonId = salon?.id || null;

      const next = { ...savedPlanning };

      if (jourOpt) {
        next[jourOpt] = dayTemplate({ titre, salonId });
      } else {
        for (const j of JOURS) next[j] = dayTemplate({ titre, salonId });
      }

      updateGuildConfig(guild.id, { planning: next });

      return interaction.reply({
        content: `✅ Template **21:00 → 23:00 (toutes les 20 min)** appliqué ${jourOpt ? `sur **${dayLabelFR(jourOpt)}**` : 'sur **toute la semaine**'}.`,
        ephemeral: true
      });
    }

    // SET (créneau spécial -> remplace la journée)
    if (sub === 'set') {
      const jour = normalizeJour(interaction.options.getString('jour'));
      const heureIn = interaction.options.getString('heure');
      const titre = interaction.options.getString('titre') || 'Session';
      const salon = interaction.options.getChannel('salon');

      if (!jour) return interaction.reply({ content: '❌ Jour invalide.', ephemeral: true });

      const parsed = parseTimeRange(heureIn);
      if (!parsed) {
        return interaction.reply({
          content: '❌ Horaire invalide. Format attendu : `HH:MM-HH:MM` (ex: `20:45-23:00`).',
          ephemeral: true
        });
      }

      const next = { ...savedPlanning };
      next[jour] = [{
        heure: parsed.normalized,
        titre: String(titre).slice(0, 60),
        salonId: salon?.id || null
      }];

      updateGuildConfig(guild.id, { planning: next });

      return interaction.reply({
        content: `✅ **${dayLabelFR(jour)}** mis à jour.`,
        ephemeral: true
      });
    }

    // CLEAR (jour vide)
    if (sub === 'clear') {
      const jour = normalizeJour(interaction.options.getString('jour'));
      if (!jour) return interaction.reply({ content: '❌ Jour invalide.', ephemeral: true });

      const next = { ...savedPlanning };
      delete next[jour];

      updateGuildConfig(guild.id, { planning: next });

      return interaction.reply({
        content: `🗑️ **${dayLabelFR(jour)}** vidé (retour à “—”).`,
        ephemeral: true
      });
    }

    // POST
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

      const content = jourOpt
        ? renderDayBlock(jourOpt, cleanDayItems(savedPlanning[jourOpt]))
        : renderWeek(Object.fromEntries(JOURS.map(j => [j, cleanDayItems(savedPlanning[j])])));

      for (const part of chunkMessage(content)) {
        await targetChannel.send({ content: part }).catch(() => {});
      }

      return interaction.reply({
        content: `📌 Planning posté dans <#${targetChannel.id}>${jourOpt ? ` (**${dayLabelFR(jourOpt)}**)` : ''}.`,
        ephemeral: true
      });
    }
  }
};
