// commands/planning.js
// ✅ PLANNING (menus) + NOTES PAR HORAIRE (modal) + AJOUTER / REMPLACER
// - /planning show [jour] -> affiche jour OU semaine
// - /planning post [salon] [jour] -> poste jour OU semaine
// - /planning edit [jour] -> UI (horaires + compétitions + notes par horaire)
//
// ✅ Affichage : 1 horaire par ligne
// ✅ Note AVANT compétitions (sur la même ligne)
// ✅ Plusieurs notes : notes["22:20"] = "..."

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const { getConfigFromInteraction, updateGuildConfig } = require('../utils/config');

/* ===================== CONSTANTES ===================== */
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const COMPETITIONS = [
  { label: 'VPG BELGIQUE', value: 'VPG BELGIQUE' },
  { label: 'VPG SUISSE', value: 'VPG SUISSE' },
  { label: 'VSC', value: 'VSC' }
];

// 21:00 → 23:00 toutes les 20 min => 21:00, 21:20, ... 22:40
function pad2(n) { return String(n).padStart(2, '0'); }
function buildFixedTimes() {
  const out = [];
  const start = 21 * 60;
  const end = 23 * 60;
  const step = 20;
  for (let t = start; t < end; t += step) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    out.push(`${pad2(h)}:${pad2(m)}`);
  }
  return out;
}
const FIXED_TIMES = buildFixedTimes(); // ["21:00","21:20",...,"22:40"]

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

function getTodayJourParis() {
  const fmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long' });
  const w = String(fmt.format(new Date()) || '').toLowerCase();
  if (w.includes('lundi')) return 'lundi';
  if (w.includes('mardi')) return 'mardi';
  if (w.includes('mercredi')) return 'mercredi';
  if (w.includes('jeudi')) return 'jeudi';
  if (w.includes('vendredi')) return 'vendredi';
  if (w.includes('samedi')) return 'samedi';
  if (w.includes('dimanche')) return 'dimanche';
  return 'lundi';
}

/* ===================== UI STATE (mémoire) ===================== */
const uiState = new Map();
function getStateKey(guildId, userId) { return `${guildId}:${userId}`; }

/* ===================== DATA PERSIST ===================== */
/**
 * planning[jour] = {
 *   times: ["22:20","22:40"],
 *   comps: ["VPG BELGIQUE"],
 *   notes: { "22:20": "CRIMSON ELITE", "22:40": "..." }
 * }
 */
function getSavedPlanning(guildConfig) {
  const p = guildConfig?.planning;
  return (p && typeof p === 'object') ? p : {};
}

function sanitizeNotesMap(notes) {
  const src = (notes && typeof notes === 'object') ? notes : {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    const key = String(k || '').trim();
    if (!FIXED_TIMES.includes(key)) continue;
    const val = String(v || '').trim();
    if (!val) continue;
    out[key] = val.slice(0, 200);
  }
  return out;
}

function readDaySaved(savedPlanning, jour) {
  const d = savedPlanning?.[jour];
  const times = Array.isArray(d?.times) ? d.times.filter(x => FIXED_TIMES.includes(x)) : [];
  const comps = Array.isArray(d?.comps) ? d.comps.filter(x => COMPETITIONS.some(c => c.value === x)) : [];
  const notes = sanitizeNotesMap(d?.notes);
  return { times, comps, notes };
}

function uniqueSorted(arr) {
  return [...new Set((arr || []).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function clampText(t, max = 180) {
  const s = String(t || '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/* ===================== RENDER ===================== */
function lineSep(width = 28) { return '━'.repeat(width); }
function centerText(txt, width = 28) {
  const t = String(txt || '').trim();
  if (t.length >= width) return t;
  const left = Math.floor((width - t.length) / 2);
  const right = width - t.length - left;
  return ' '.repeat(left) + t + ' '.repeat(right);
}

function renderDayBlock(jour, dayData) {
  const width = 28;
  const header = [
    lineSep(width),
    centerText(dayLabelFR(jour), width),
    lineSep(width)
  ];

  const times = Array.isArray(dayData?.times) ? uniqueSorted(dayData.times) : [];
  const comps = Array.isArray(dayData?.comps) ? uniqueSorted(dayData.comps) : [];
  const notes = (dayData?.notes && typeof dayData.notes === 'object') ? dayData.notes : {};

  const compsTxt = comps.length ? comps.join(' • ') : '';

  const body = times.length
    ? times.map((t) => {
        const noteForTime = String(notes?.[t] || '').trim();
        // ✅ NOTE avant COMPETS
        const suffix =
          (noteForTime && compsTxt) ? `${noteForTime} • ${compsTxt}` :
          (noteForTime) ? noteForTime :
          (compsTxt) ? compsTxt :
          '—';

        return `${t} ▸ ${clampText(suffix, 220)}`;
      })
    : ['—'];

  return ['```', ...header, ...body, '```'].join('\n');
}

function renderWeekBlocks(savedPlanning) {
  const blocks = [];
  for (const j of JOURS) blocks.push(renderDayBlock(j, readDaySaved(savedPlanning, j)));
  return blocks.join('\n\n');
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

/* ===================== UI BUILDERS ===================== */
function buildTimesMenu(state) {
  const selected = Array.isArray(state?.times) ? state.times : [];
  const options = FIXED_TIMES.map(t => ({
    label: t,
    value: t,
    default: selected.includes(t)
  }));

  return new StringSelectMenuBuilder()
    .setCustomId('planning:times')
    .setPlaceholder('Horaires — coche ce que tu veux')
    .setMinValues(0)
    .setMaxValues(options.length)
    .addOptions(options);
}

function buildCompsMenu(state) {
  const selected = Array.isArray(state?.comps) ? state.comps : [];
  const options = COMPETITIONS.map(c => ({
    label: c.label,
    value: c.value,
    default: selected.includes(c.value)
  }));

  return new StringSelectMenuBuilder()
    .setCustomId('planning:comps')
    .setPlaceholder('Compétitions — coche ce que tu veux')
    .setMinValues(0)
    .setMaxValues(options.length)
    .addOptions(options);
}

function buildButtonsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('planning:save_replace').setStyle(ButtonStyle.Success).setLabel('Enregistrer (REMPLACER)'),
    new ButtonBuilder().setCustomId('planning:save_add').setStyle(ButtonStyle.Primary).setLabel('Enregistrer (AJOUTER)'),
    new ButtonBuilder().setCustomId('planning:note_time').setStyle(ButtonStyle.Secondary).setLabel('✍️ Note horaire'),
    new ButtonBuilder().setCustomId('planning:clear').setStyle(ButtonStyle.Danger).setLabel('Tout vider'),
    new ButtonBuilder().setCustomId('planning:cancel').setStyle(ButtonStyle.Secondary).setLabel('Fermer')
  );
}

function buildUiMessageContent(guildCfg, jour, state) {
  const preview = renderDayBlock(jour, state);
  const clubName = guildCfg?.clubName || 'CLUB';
  return `**${clubName}** — **${dayLabelFR(jour)}**\n_Coche/décoche, puis ajoute tes notes par horaire._\n\n${preview}`;
}

function buildUiComponents(state) {
  return [
    new ActionRowBuilder().addComponents(buildTimesMenu(state)),
    new ActionRowBuilder().addComponents(buildCompsMenu(state)),
    buildButtonsRow()
  ];
}

/* ===================== SAUVEGARDE ===================== */
function saveDay(guildId, guildCfg, jour, mode, incomingState) {
  const savedPlanning = getSavedPlanning(guildCfg);
  const currentDay = readDaySaved(savedPlanning, jour);

  const inTimes = uniqueSorted((incomingState?.times || []).filter(x => FIXED_TIMES.includes(x)));
  const inComps = uniqueSorted((incomingState?.comps || []).filter(x => COMPETITIONS.some(c => c.value === x)));
  const inNotes = sanitizeNotesMap(incomingState?.notes);

  let nextDay;

  if (mode === 'add') {
    const mergedTimes = uniqueSorted([...(currentDay.times || []), ...inTimes]);
    const mergedComps = uniqueSorted([...(currentDay.comps || []), ...inComps]);

    const mergedNotes = { ...(currentDay.notes || {}), ...inNotes };
    const cleanedNotes = {};
    for (const t of mergedTimes) if (mergedNotes[t]) cleanedNotes[t] = mergedNotes[t];

    nextDay = { times: mergedTimes, comps: mergedComps, notes: cleanedNotes };
  } else {
    const cleanedNotes = {};
    for (const t of inTimes) if (inNotes[t]) cleanedNotes[t] = inNotes[t];
    nextDay = { times: inTimes, comps: inComps, notes: cleanedNotes };
  }

  const nextPlanning = { ...savedPlanning, [jour]: nextDay };
  updateGuildConfig(guildId, { planning: nextPlanning });
  return nextDay;
}

function clearDay(guildId, guildCfg, jour) {
  const savedPlanning = getSavedPlanning(guildCfg);
  const nextPlanning = { ...savedPlanning, [jour]: { times: [], comps: [], notes: {} } };
  updateGuildConfig(guildId, { planning: nextPlanning });
  return nextPlanning[jour];
}

/* ===================== MODAL NOTE HORAIRE (FIXED) ===================== */
function buildNoteTimeModal(state) {
  const modal = new ModalBuilder()
    .setCustomId('planning:modal_note_time')
    .setTitle('Note par horaire');

  const suggestedTime =
    Array.isArray(state?.times) && state.times.length ? state.times[0] : '22:20';

  // ✅ IMPORTANT : label <= 45 caractères (sinon modal -> erreur Discord)
  const inputTime = new TextInputBuilder()
    .setCustomId('planning:time_input')
    .setLabel('Heure (ex: 22:20)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(5)
    .setPlaceholder(suggestedTime)
    .setValue(suggestedTime);

  const inputNote = new TextInputBuilder()
    .setCustomId('planning:note_input')
    .setLabel('Note (vide = supprimer)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(200)
    .setPlaceholder('Ex: CRIMSON ELITE / LASPHINX FC');

  modal.addComponents(
    new ActionRowBuilder().addComponents(inputTime),
    new ActionRowBuilder().addComponents(inputNote)
  );

  return modal;
}

/* ===================== ROUTAGE INTERACTIONS (menus/boutons) ===================== */
async function handleComponentInteraction(interaction) {
  const customId = interaction.customId || '';
  if (!customId.startsWith('planning:')) return false;
  if (!interaction.guildId) return false;

  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};
  const savedPlanning = getSavedPlanning(guildCfg);

  const key = getStateKey(guildId, userId);
  const fallbackJour = getTodayJourParis();

  const st = uiState.get(key) || { jour: fallbackJour, times: [], comps: [], notes: {} };
  st.jour = normalizeJour(st.jour) || fallbackJour;
  st.notes = (st.notes && typeof st.notes === 'object') ? st.notes : {};

  if (!st.__loadedFromSaved) {
    const daySaved = readDaySaved(savedPlanning, st.jour);
    st.times = daySaved.times;
    st.comps = daySaved.comps;
    st.notes = daySaved.notes || {};
    st.__loadedFromSaved = true;
  }

  // MENUS
  if (interaction.isStringSelectMenu()) {
    await interaction.deferUpdate().catch(() => {});

    if (customId === 'planning:times') {
      st.times = uniqueSorted((interaction.values || []).filter(x => FIXED_TIMES.includes(x)));
      const pruned = {};
      for (const t of st.times) if (st.notes?.[t]) pruned[t] = st.notes[t];
      st.notes = pruned;
    }

    if (customId === 'planning:comps') {
      st.comps = uniqueSorted((interaction.values || []).filter(x => COMPETITIONS.some(c => c.value === x)));
    }

    uiState.set(key, st);

    await interaction.editReply({
      content: buildUiMessageContent(guildCfg, st.jour, st),
      components: buildUiComponents(st)
    }).catch(() => {});

    return true;
  }

  // BOUTONS
  if (interaction.isButton()) {
    if (customId === 'planning:note_time') {
      uiState.set(key, st);
      await interaction.showModal(buildNoteTimeModal(st)).catch(() => {});
      return true;
    }

    await interaction.deferUpdate().catch(() => {});

    if (customId === 'planning:cancel') {
      uiState.delete(key);
      await interaction.editReply({ content: '✅ Configuration planning fermée.', components: [] }).catch(() => {});
      return true;
    }

    if (customId === 'planning:clear') {
      const cleared = clearDay(guildId, guildCfg, st.jour);
      st.times = cleared.times || [];
      st.comps = cleared.comps || [];
      st.notes = cleared.notes || {};
      uiState.set(key, st);

      await interaction.editReply({
        content: buildUiMessageContent(guildCfg, st.jour, st),
        components: buildUiComponents(st)
      }).catch(() => {});

      return true;
    }

    if (customId === 'planning:save_add' || customId === 'planning:save_replace') {
      const mode = (customId === 'planning:save_add') ? 'add' : 'replace';
      const saved = saveDay(guildId, guildCfg, st.jour, mode, st);

      st.times = saved.times || [];
      st.comps = saved.comps || [];
      st.notes = saved.notes || {};
      uiState.set(key, st);

      await interaction.editReply({
        content: `✅ **${dayLabelFR(st.jour)}** enregistré (${mode === 'add' ? 'AJOUT' : 'REMPLACEMENT'}).\n\n${renderDayBlock(st.jour, st)}`,
        components: buildUiComponents(st)
      }).catch(() => {});

      return true;
    }
  }

  return false;
}

/* ===================== ROUTAGE MODAL (note horaire) ===================== */
async function handleModalSubmit(interaction) {
  const customId = interaction.customId || '';
  if (customId !== 'planning:modal_note_time') return false;
  if (!interaction.guildId) return false;

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const key = getStateKey(guildId, userId);

  const st = uiState.get(key);
  if (!st) {
    await interaction.reply({ content: '⚠️ Session planning introuvable. Relance `/planning edit`.', ephemeral: true }).catch(() => {});
    return true;
  }

  const timeRaw = (interaction.fields.getTextInputValue('planning:time_input') || '').trim();
  const noteRaw = (interaction.fields.getTextInputValue('planning:note_input') || '').trim();

  if (!FIXED_TIMES.includes(timeRaw)) {
    await interaction.reply({
      content: `❌ Heure invalide. Heures possibles : ${FIXED_TIMES.join(' / ')}`,
      ephemeral: true
    }).catch(() => {});
    return true;
  }

  const times = Array.isArray(st.times) ? st.times : [];
  if (!times.includes(timeRaw)) {
    await interaction.reply({
      content: `⚠️ Tu dois d’abord **cocher** l’horaire **${timeRaw}** dans le menu Horaires.`,
      ephemeral: true
    }).catch(() => {});
    return true;
  }

  st.notes = (st.notes && typeof st.notes === 'object') ? st.notes : {};

  if (!noteRaw) delete st.notes[timeRaw];
  else st.notes[timeRaw] = noteRaw.slice(0, 200);

  uiState.set(key, st);

  await interaction.reply({
    content:
      `✅ Note mise à jour pour **${dayLabelFR(st.jour)}** à **${timeRaw}**.\n\n` +
      `${renderDayBlock(st.jour, st)}\n\n` +
      `➡️ Reviens sur le message planning et clique **Enregistrer**.`,
    ephemeral: true
  }).catch(() => {});

  return true;
}

/* ===================== SLASH COMMAND ===================== */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('planning')
    .setDescription('Planning : horaires + compétitions + notes par horaire.')
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
    )

    .addSubcommand(sc =>
      sc
        .setName('edit')
        .setDescription('Ouvre les cases + notes par horaire.')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Optionnel : si vide → jour actuel')
            .setRequired(false)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};
    const savedPlanning = getSavedPlanning(guildCfg);

    if (sub === 'show') {
      const jourOpt = normalizeJour(interaction.options.getString('jour'));
      const content = jourOpt
        ? renderDayBlock(jourOpt, readDaySaved(savedPlanning, jourOpt))
        : renderWeekBlocks(savedPlanning);

      const chunks = chunkMessage(content);
      await interaction.reply({ content: chunks[0], ephemeral: false });
      for (const extra of chunks.slice(1)) await interaction.followUp({ content: extra, ephemeral: false }).catch(() => {});
      return;
    }

    if (sub === 'post') {
      const guild = interaction.guild;
      const targetChannel = interaction.options.getChannel('salon') || interaction.channel;
      const jourOpt = normalizeJour(interaction.options.getString('jour'));

      const me = guild.members.me;
      const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
      if (!targetChannel?.permissionsFor?.(me)?.has(needed)) {
        return interaction.reply({ content: `❌ Je ne peux pas écrire dans <#${targetChannel?.id || 'inconnu'}>.`, ephemeral: true });
      }

      const content = jourOpt
        ? renderDayBlock(jourOpt, readDaySaved(savedPlanning, jourOpt))
        : renderWeekBlocks(savedPlanning);

      for (const part of chunkMessage(content)) await targetChannel.send({ content: part }).catch(() => {});

      return interaction.reply({
        content: `📌 Planning posté dans <#${targetChannel.id}>${jourOpt ? ` (**${dayLabelFR(jourOpt)}**)` : ''}.`,
        ephemeral: true
      });
    }

    if (sub === 'edit') {
      const jourOpt = normalizeJour(interaction.options.getString('jour')) || getTodayJourParis();
      const daySaved = readDaySaved(savedPlanning, jourOpt);

      const st = {
        jour: jourOpt,
        times: daySaved.times || [],
        comps: daySaved.comps || [],
        notes: daySaved.notes || {},
        __loadedFromSaved: true
      };

      uiState.set(getStateKey(interaction.guildId, interaction.user.id), st);

      return interaction.reply({
        content: buildUiMessageContent(guildCfg, jourOpt, st),
        components: buildUiComponents(st),
        ephemeral: true
      });
    }
  },

  handleComponentInteraction,
  handleModalSubmit
};
