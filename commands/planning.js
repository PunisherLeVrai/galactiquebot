// commands/planning.js
// ✅ PLANNING (menus) + LIGNE PAR HORAIRE (modal) + DATE PAR JOUR (modal) + AJOUTER / REMPLACER
// - /planning show [jour] -> affiche jour OU semaine
// - /planning post [salon] [jour] -> poste jour OU semaine
// - /planning edit [jour] -> UI (horaires + config ligne + date)
//
// ✅ Mise en forme (sans résultats) :
// 📅 **Lundi 12 Janvier**
// 🔹 21h00 — VS **REDUS EFC** *(MATCH AMICAL)*
//
// Structure sauvegardée :
// planning[jour] = {
//   dateLabel: "12 Janvier",            // optionnel
//   times: ["21:00","21:20"],
//   entries: {
//     "21:00": { opponent: "REDUS EFC", comp: "MATCH AMICAL" },
//     "21:20": { opponent: "PAC ES", comp: "MATCH AMICAL" }
//   }
// }

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

const DAYS_MATCH = new Set(['lundi', 'mardi', 'mercredi', 'jeudi']);
const DAYS_FREE = new Set(['vendredi', 'samedi', 'dimanche']);

/* ===================== HELPERS ===================== */
function normalizeJour(j) {
  const x = String(j || '').trim().toLowerCase();
  return JOURS.includes(x) ? x : null;
}

function dayLabelFR_Title(jour) {
  const map = {
    lundi: 'Lundi',
    mardi: 'Mardi',
    mercredi: 'Mercredi',
    jeudi: 'Jeudi',
    vendredi: 'Vendredi',
    samedi: 'Samedi',
    dimanche: 'Dimanche'
  };
  return map[jour] || String(jour || '');
}

function dayLabelFR_Upper(jour) {
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

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function uniqueSorted(arr) {
  return [...new Set((arr || []).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function clampText(t, max = 220) {
  const s = String(t || '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function hhmmToHhmmFR(hhmm) {
  // "21:00" -> "21h00"
  const s = String(hhmm || '').trim();
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return s;
  return `${m[1]}h${m[2]}`;
}

/* ===================== UI STATE (mémoire) ===================== */
const uiState = new Map();
function getStateKey(guildId, userId) { return `${guildId}:${userId}`; }

/* ===================== DATA PERSIST ===================== */
function getSavedPlanning(guildConfig) {
  const p = guildConfig?.planning;
  return isPlainObject(p) ? p : {};
}

function sanitizeEntriesMap(entries) {
  const src = isPlainObject(entries) ? entries : {};
  const out = {};

  for (const [timeKey, val] of Object.entries(src)) {
    const t = String(timeKey || '').trim();
    if (!FIXED_TIMES.includes(t)) continue;

    const obj = isPlainObject(val) ? val : {};
    const opponent = clampText(obj.opponent, 60).trim();
    const comp = clampText(obj.comp, 30).trim(); // ✅ libre (MATCH AMICAL, TOURNOI CPG, VPG SUISSE, etc.)

    if (!opponent && !comp) continue;
    out[t] = { opponent, comp };
  }

  return out;
}

function sanitizeDateLabel(dateLabel) {
  const s = String(dateLabel || '').trim();
  if (!s) return '';
  return clampText(s, 30);
}

function readDaySaved(savedPlanning, jour) {
  const d = savedPlanning?.[jour];

  const dateLabel = sanitizeDateLabel(d?.dateLabel);

  const times = Array.isArray(d?.times) // ✅ UNIQUEMENT heures fixes
    ? d.times.filter(x => FIXED_TIMES.includes(x))
    : [];

  const entries = sanitizeEntriesMap(d?.entries);

  // prune entries aux times
  const tset = new Set(times);
  const cleaned = {};
  for (const [t, v] of Object.entries(entries)) {
    if (tset.has(t)) cleaned[t] = v;
  }

  return {
    dateLabel,
    times: uniqueSorted(times),
    entries: cleaned
  };
}

/* ===================== RENDER (SANS RÉSULTATS) ===================== */
function buildLineForTime(jour, time, entry) {
  const timeFR = hhmmToHhmmFR(time);

  const opponent = String(entry?.opponent || '').trim();
  const comp = String(entry?.comp || '').trim();

  // Week-end : si user coche des horaires -> on reste en "VS ..."
  // Le fallback "SESSION LIBRE" se gère au niveau du jour.
  const opponentTxt = opponent ? `**${clampText(opponent, 60)}**` : `**À DÉFINIR**`;
  const compTxt = comp ? ` *(${clampText(comp, 30)})*` : '';

  // ✅ EXACT : "— VS **...** *(...)*"
  return `🔹 ${timeFR} — VS ${opponentTxt}${compTxt}`;
}

function renderDayFancy(jour, dayData) {
  const dayName = dayLabelFR_Title(jour);
  const dateLabel = String(dayData?.dateLabel || '').trim();
  const title = dateLabel ? `📅 **${dayName} ${dateLabel}**` : `📅 **${dayName}**`;

  const timesSelected = Array.isArray(dayData?.times) ? uniqueSorted(dayData.times) : [];
  const entries = isPlainObject(dayData?.entries) ? dayData.entries : {};

  let timesToShow;

  // Règles :
  // - Lundi→Jeudi : si aucun horaire coché -> afficher toutes les heures en VS À DÉFINIR
  // - Vendredi→Dimanche : si aucun horaire coché -> afficher "21h00 — SESSION LIBRE"
  if (DAYS_MATCH.has(jour)) {
    timesToShow = timesSelected.length ? timesSelected : FIXED_TIMES;
  } else if (DAYS_FREE.has(jour)) {
    if (!timesSelected.length) {
      return `${title}\n🔹 ${hhmmToHhmmFR('21:00')} — **SESSION LIBRE**`;
    }
    timesToShow = timesSelected;
  } else {
    timesToShow = timesSelected.length ? timesSelected : FIXED_TIMES;
  }

  const lines = timesToShow.map((t) => {
    const e = isPlainObject(entries?.[t]) ? entries[t] : {};
    return buildLineForTime(jour, t, e);
  });

  return [title, ...lines].join('\n');
}

function renderWeekFancy(savedPlanning) {
  return JOURS.map(j => renderDayFancy(j, readDaySaved(savedPlanning, j))).join('\n\n');
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
    label: hhmmToHhmmFR(t),
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

function buildButtonsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('planning:save_replace').setStyle(ButtonStyle.Success).setLabel('Enregistrer (REMPLACER)'),
    new ButtonBuilder().setCustomId('planning:save_add').setStyle(ButtonStyle.Primary).setLabel('Enregistrer (AJOUTER)'),
    new ButtonBuilder().setCustomId('planning:edit_line').setStyle(ButtonStyle.Secondary).setLabel('✍️ Ligne (VS + comp)'),
    new ButtonBuilder().setCustomId('planning:set_date').setStyle(ButtonStyle.Secondary).setLabel('🗓️ Date du jour'),
    new ButtonBuilder().setCustomId('planning:clear').setStyle(ButtonStyle.Danger).setLabel('Tout vider'),
    new ButtonBuilder().setCustomId('planning:cancel').setStyle(ButtonStyle.Secondary).setLabel('Fermer')
  );
}

function buildUiMessageContent(guildCfg, jour, state) {
  const clubName = guildCfg?.clubName || 'CLUB';
  const preview = renderDayFancy(jour, state);

  return (
    `**${clubName}** — **${dayLabelFR_Upper(jour)}**\n` +
    `_1) Coche tes horaires  2) "Ligne (VS + comp)"  3) "Date du jour" (optionnel)  4) Enregistrer._\n\n` +
    `${preview}`
  );
}

function buildUiComponents(state) {
  return [
    new ActionRowBuilder().addComponents(buildTimesMenu(state)),
    buildButtonsRow()
  ];
}

/* ===================== SAUVEGARDE ===================== */
function saveDay(guildId, guildCfg, jour, mode, incomingState) {
  const savedPlanning = getSavedPlanning(guildCfg);
  const currentDay = readDaySaved(savedPlanning, jour);

  const inTimes = uniqueSorted((incomingState?.times || []).filter(x => FIXED_TIMES.includes(x)));
  const inEntries = sanitizeEntriesMap(incomingState?.entries);
  const inDateLabel = sanitizeDateLabel(incomingState?.dateLabel);

  let nextDay;

  if (mode === 'add') {
    const mergedTimes = uniqueSorted([...(currentDay.times || []), ...inTimes]);

    // merge entries (incoming écrase la ligne de l'heure)
    const mergedEntries = { ...(currentDay.entries || {}), ...inEntries };

    // prune entries aux mergedTimes
    const cleaned = {};
    const set = new Set(mergedTimes);
    for (const [t, v] of Object.entries(mergedEntries)) {
      if (set.has(t)) cleaned[t] = v;
    }

    // date : si l'utilisateur a modifié la date dans l'UI -> on prend inDateLabel, sinon on conserve
    const dateLabel = inDateLabel || currentDay.dateLabel || '';

    nextDay = { dateLabel, times: mergedTimes, entries: cleaned };
  } else {
    // replace : remplace TOUT (times + entries), date = UI
    const cleaned = {};
    for (const t of inTimes) {
      if (inEntries[t]) cleaned[t] = inEntries[t];
    }
    nextDay = { dateLabel: inDateLabel || '', times: inTimes, entries: cleaned };
  }

  const nextPlanning = { ...savedPlanning, [jour]: nextDay };
  updateGuildConfig(guildId, { planning: nextPlanning });
  return nextDay;
}

function clearDay(guildId, guildCfg, jour) {
  const savedPlanning = getSavedPlanning(guildCfg);
  const nextPlanning = { ...savedPlanning, [jour]: { dateLabel: '', times: [], entries: {} } };
  updateGuildConfig(guildId, { planning: nextPlanning });
  return nextPlanning[jour];
}

/* ===================== MODALS ===================== */
function buildLineModal(state) {
  const modal = new ModalBuilder()
    .setCustomId('planning:modal_line')
    .setTitle('Ligne horaire');

  const suggestedTime =
    Array.isArray(state?.times) && state.times.length ? state.times[0] : '21:00';

  const entry = isPlainObject(state?.entries?.[suggestedTime]) ? state.entries[suggestedTime] : {};
  const suggestedOpponent = String(entry.opponent || '').slice(0, 60);
  const suggestedComp = String(entry.comp || '').slice(0, 30);

  const inputTime = new TextInputBuilder()
    .setCustomId('planning:time_input')
    .setLabel('Heure (ex: 21:00)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(5)
    .setPlaceholder(suggestedTime)
    .setValue(suggestedTime);

  const inputOpponent = new TextInputBuilder()
    .setCustomId('planning:opponent_input')
    .setLabel('Adversaire (ex: REDUS EFC)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(60)
    .setPlaceholder('À DÉFINIR')
    .setValue(suggestedOpponent);

  const inputComp = new TextInputBuilder()
    .setCustomId('planning:comp_input')
    .setLabel('Compétition (ex: VPG SUISSE / MATCH AMICAL)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(30)
    .setPlaceholder('MATCH AMICAL')
    .setValue(suggestedComp);

  modal.addComponents(
    new ActionRowBuilder().addComponents(inputTime),
    new ActionRowBuilder().addComponents(inputOpponent),
    new ActionRowBuilder().addComponents(inputComp)
  );

  return modal;
}

function buildDateModal(state) {
  const modal = new ModalBuilder()
    .setCustomId('planning:modal_date')
    .setTitle('Date du jour');

  const current = String(state?.dateLabel || '').trim();

  const inputDate = new TextInputBuilder()
    .setCustomId('planning:date_input')
    .setLabel('Date (ex: 12 Janvier)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(30)
    .setPlaceholder('12 Janvier')
    .setValue(current);

  modal.addComponents(
    new ActionRowBuilder().addComponents(inputDate)
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

  const st = uiState.get(key) || { jour: fallbackJour, dateLabel: '', times: [], entries: {} };
  st.jour = normalizeJour(st.jour) || fallbackJour;
  st.entries = isPlainObject(st.entries) ? st.entries : {};
  st.dateLabel = String(st.dateLabel || '').trim();

  if (!st.__loadedFromSaved) {
    const daySaved = readDaySaved(savedPlanning, st.jour);
    st.dateLabel = daySaved.dateLabel || '';
    st.times = daySaved.times || [];
    st.entries = daySaved.entries || {};
    st.__loadedFromSaved = true;
  }

  // MENUS
  if (interaction.isStringSelectMenu()) {
    await interaction.deferUpdate().catch(() => {});

    if (customId === 'planning:times') {
      st.times = uniqueSorted((interaction.values || []).filter(x => FIXED_TIMES.includes(x)));

      // prune entries si une heure n'est plus cochée
      const pruned = {};
      const set = new Set(st.times);
      for (const [t, v] of Object.entries(st.entries || {})) {
        if (set.has(t)) pruned[t] = v;
      }
      st.entries = pruned;
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
    if (customId === 'planning:edit_line') {
      uiState.set(key, st);
      await interaction.showModal(buildLineModal(st)).catch(() => {});
      return true;
    }

    if (customId === 'planning:set_date') {
      uiState.set(key, st);
      await interaction.showModal(buildDateModal(st)).catch(() => {});
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
      st.dateLabel = cleared.dateLabel || '';
      st.times = cleared.times || [];
      st.entries = cleared.entries || {};
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

      st.dateLabel = saved.dateLabel || '';
      st.times = saved.times || [];
      st.entries = saved.entries || {};
      uiState.set(key, st);

      await interaction.editReply({
        content:
          `✅ **${dayLabelFR_Upper(st.jour)}** enregistré (${mode === 'add' ? 'AJOUT' : 'REMPLACEMENT'}).\n\n` +
          `${renderDayFancy(st.jour, st)}`,
        components: buildUiComponents(st)
      }).catch(() => {});

      return true;
    }
  }

  return false;
}

/* ===================== ROUTAGE MODALS ===================== */
async function handleModalSubmit(interaction) {
  const customId = interaction.customId || '';
  if (!interaction.guildId) return false;

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const key = getStateKey(guildId, userId);

  const st = uiState.get(key);
  if (!st) {
    await interaction.reply({
      content: '⚠️ Session planning introuvable. Relance `/planning edit`.',
      ephemeral: true
    }).catch(() => {});
    return true;
  }

  // MODAL : ligne horaire
  if (customId === 'planning:modal_line') {
    const timeRaw = (interaction.fields.getTextInputValue('planning:time_input') || '').trim();
    const opponentRaw = (interaction.fields.getTextInputValue('planning:opponent_input') || '').trim();
    const compRaw = (interaction.fields.getTextInputValue('planning:comp_input') || '').trim();

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
        content: `⚠️ Tu dois d’abord **cocher** l’horaire **${hhmmToHhmmFR(timeRaw)}** dans le menu Horaires.`,
        ephemeral: true
      }).catch(() => {});
      return true;
    }

    st.entries = isPlainObject(st.entries) ? st.entries : {};

    const opponentFinal = clampText(opponentRaw, 60).trim();
    const compFinal = clampText(compRaw, 30).trim();

    // si tout est vide => suppression
    if (!opponentFinal && !compFinal) {
      delete st.entries[timeRaw];
    } else {
      st.entries[timeRaw] = {
        opponent: opponentFinal,
        comp: compFinal
      };
    }

    uiState.set(key, st);

    await interaction.reply({
      content:
        `✅ Ligne mise à jour pour **${dayLabelFR_Title(st.jour)}** à **${hhmmToHhmmFR(timeRaw)}**.\n\n` +
        `${renderDayFancy(st.jour, st)}\n\n` +
        `➡️ Reviens sur le message planning et clique **Enregistrer**.`,
      ephemeral: true
    }).catch(() => {});

    return true;
  }

  // MODAL : date
  if (customId === 'planning:modal_date') {
    const dateRaw = (interaction.fields.getTextInputValue('planning:date_input') || '').trim();
    st.dateLabel = sanitizeDateLabel(dateRaw);
    uiState.set(key, st);

    await interaction.reply({
      content:
        `✅ Date mise à jour pour **${dayLabelFR_Title(st.jour)}** : **${st.dateLabel || '(vide)'}**\n\n` +
        `${renderDayFancy(st.jour, st)}\n\n` +
        `➡️ Reviens sur le message planning et clique **Enregistrer**.`,
      ephemeral: true
    }).catch(() => {});

    return true;
  }

  return false;
}

/* ===================== SLASH COMMAND ===================== */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('planning')
    .setDescription('Planning : horaires + VS + compétition (sans résultats).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sc =>
      sc
        .setName('show')
        .setDescription('Affiche le planning (jour ou semaine).')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Optionnel : afficher un seul jour')
            .setRequired(false)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR_Upper(j), value: j })))
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
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR_Upper(j), value: j })))
        )
    )

    .addSubcommand(sc =>
      sc
        .setName('edit')
        .setDescription('Ouvre l’UI (horaires + ligne VS/comp + date).')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Optionnel : si vide → jour actuel')
            .setRequired(false)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR_Upper(j), value: j })))
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};
    const savedPlanning = getSavedPlanning(guildCfg);

    // SHOW
    if (sub === 'show') {
      const jourOpt = normalizeJour(interaction.options.getString('jour'));
      const content = jourOpt
        ? renderDayFancy(jourOpt, readDaySaved(savedPlanning, jourOpt))
        : renderWeekFancy(savedPlanning);

      const chunks = chunkMessage(content);
      await interaction.reply({ content: chunks[0], ephemeral: false });
      for (const extra of chunks.slice(1)) {
        await interaction.followUp({ content: extra, ephemeral: false }).catch(() => {});
      }
      return;
    }

    // POST
    if (sub === 'post') {
      const guild = interaction.guild;
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
        ? renderDayFancy(jourOpt, readDaySaved(savedPlanning, jourOpt))
        : renderWeekFancy(savedPlanning);

      for (const part of chunkMessage(content)) {
        await targetChannel.send({ content: part }).catch(() => {});
      }

      return interaction.reply({
        content: `📌 Planning posté dans <#${targetChannel.id}>${jourOpt ? ` (**${dayLabelFR_Upper(jourOpt)}**)` : ''}.`,
        ephemeral: true
      });
    }

    // EDIT
    if (sub === 'edit') {
      const jourOpt = normalizeJour(interaction.options.getString('jour')) || getTodayJourParis();
      const daySaved = readDaySaved(savedPlanning, jourOpt);

      const st = {
        jour: jourOpt,
        dateLabel: daySaved.dateLabel || '',
        times: daySaved.times || [],
        entries: daySaved.entries || {},
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
