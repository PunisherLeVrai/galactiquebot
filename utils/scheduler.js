// utils/scheduler.js — SANS SNAPSHOTS (clean) + LOGS EN EMBED + RAPPORT SEMAINE (JEUDI) SANS SNAPSHOTS
// ✔ noon: rappel + rapport (dispos du jour)
// ✔ close: rapport + fermeture (lock embed + clear reactions + message)
// ✔ weekly: rapport semaine (calculé via salon logDisposChannelId) -> JEUDI (configurable)
// ✔ nickSync: synchro pseudos
// ✖ snapshots supprimés
//
// Requiert dans servers.json :
// - logChannelId (où le bot log en embed)
// - logDisposChannelId (salon "LOGIS DISPO" pour calculer la semaine)
// - automationSchedule.weekly (enabled/day/time/lookbackDays)
//
// Important:
// - Le rapport semaine est calculé à partir des embeds "📅 RAPPORT - ..." postés dans logDisposChannelId.
// - Le scheduler poste aussi les rapports journaliers dans logDisposChannelId (si configuré) pour alimenter le calcul semaine.

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require('discord.js');

const { getGuildConfig } = require('./config');
const { buildNickname } = require('./nickname');

const DEFAULT_COLOR = 0xff4db8;

/* ============================================================
   UTILS BASIQUES
============================================================ */
function isValidId(id) {
  return !!id && id !== '0';
}

function getClubName(cfg, guild) {
  return cfg?.clubName || guild?.name || 'Club';
}

function getEmbedColorFromConfig(guildId) {
  const cfg = getGuildConfig(guildId) || {};
  const hex = cfg.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

// 🔒 Anti-mentions accidentelles (everyone/here/roles). Les mentions users restent OK.
const sanitize = (t) =>
  String(t || '').replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]');

function isEligibleDay(jour) {
  return ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'].includes(jour);
}

function pad2(n) { return String(n).padStart(2, '0'); }

/* ============================================================
   DATE/TIME EUROPE/PARIS (ou timezone config)
============================================================ */
function getParisParts(timezone = 'Europe/Paris') {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long',
    hour12: false
  });

  const parts = fmt.formatToParts(new Date());
  const get = (type) => parts.find(p => p.type === type)?.value;

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));

  let hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  if (hour === 24) hour = 0;

  const weekday = (get('weekday') || '').toLowerCase();
  const isoDate = `${year}-${pad2(month)}-${pad2(day)}`;

  const mapJour = {
    dimanche: 'dimanche', lundi: 'lundi', mardi: 'mardi', mercredi: 'mercredi',
    jeudi: 'jeudi', vendredi: 'vendredi', samedi: 'samedi'
  };
  const jour = mapJour[weekday] || 'lundi';

  return { year, month, day, hour, minute, second, isoDate, jour };
}

function parseTimeHHMM(str, fallback = { hour: 12, minute: 0 }) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23) return fallback;
  if (mi < 0 || mi > 59) return fallback;
  return { hour: h, minute: mi };
}

function minutesOfDay(hour, minute) {
  return (Number(hour) * 60) + Number(minute);
}

/**
 * Fenêtre "inratable":
 * on déclenche si NOW est après l'heure cible et dans une période de grâce
 */
function withinGraceAfter(nowH, nowM, targetH, targetM, graceMin = 10) {
  const now = minutesOfDay(nowH, nowM);
  const target = minutesOfDay(targetH, targetM);
  return now >= target && now <= (target + graceMin);
}

/* ============================================================
   SCHEDULE PAR SERVEUR (configurable dans servers.json)
============================================================ */
function getScheduleForGuild(guildId) {
  const cfg = getGuildConfig(guildId) || {};
  const s = cfg.automationSchedule || {};

  const timezone = s.timezone || 'Europe/Paris';

  const noon = s.noon || {};
  const close = s.close || {};
  const weekly = s.weekly || {};
  const nickSync = s.nickSync || {};

  const noonTime = parseTimeHHMM(noon.time, { hour: 12, minute: 0 });
  const closeTime = parseTimeHHMM(close.time, { hour: 17, minute: 0 });
  const weeklyTime = parseTimeHHMM(weekly.time, { hour: 22, minute: 0 });

  // ✅ Compat: si ton servers.json a encore "windowMin", on le mappe vers graceMin
  const noonGrace = Number.isFinite(noon.graceMin) ? noon.graceMin : (Number.isFinite(noon.windowMin) ? noon.windowMin : 10);
  const closeGrace = Number.isFinite(close.graceMin) ? close.graceMin : (Number.isFinite(close.windowMin) ? close.windowMin : 10);
  const weeklyGrace = Number.isFinite(weekly.graceMin) ? weekly.graceMin : (Number.isFinite(weekly.windowMin) ? weekly.windowMin : 10);

  return {
    timezone,

    noon: {
      enabled: noon.enabled ?? true,
      hour: noonTime.hour,
      minute: noonTime.minute,
      graceMin: noonGrace,
      mentionInReminder: noon.mentionInReminder ?? true,
      mentionInReports: noon.mentionInReports ?? false
    },

    close: {
      enabled: close.enabled ?? true,
      hour: closeTime.hour,
      minute: closeTime.minute,
      graceMin: closeGrace,
      clearReactions: close.clearReactions ?? true,
      sendCloseMessage: close.sendCloseMessage ?? true
    },

    weekly: {
      enabled: weekly.enabled ?? false,
      day: String(weekly.day || 'jeudi').toLowerCase(),
      hour: weeklyTime.hour,
      minute: weeklyTime.minute,
      graceMin: weeklyGrace,
      lookbackDays: Number.isFinite(weekly.lookbackDays) ? weekly.lookbackDays : 7
    },

    nickSync: {
      enabled: nickSync.enabled ?? true,
      minute: Number.isFinite(nickSync.minute) ? nickSync.minute : 10,
      sleepMs: Number.isFinite(nickSync.sleepMs) ? nickSync.sleepMs : 350
    }
  };
}

/* ============================================================
   CIBLAGE SERVEURS
============================================================ */
function computeTargetGuildIds(client, opts = {}) {
  const present = new Set([...client.guilds.cache.keys()]);

  const manual =
    (opts.targetGuildIds instanceof Set) ? [...opts.targetGuildIds] :
    (Array.isArray(opts.targetGuildIds)) ? opts.targetGuildIds :
    null;

  const base = manual && manual.length ? manual : [...present];

  return base
    .filter(id => present.has(id))
    .filter(id => !!getGuildConfig(id));
}

/* ============================================================
   LOGS EN EMBED (dans logChannelId)
============================================================ */
async function sendLogEmbed(client, guildId, level, title, lines = []) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const cfg = getGuildConfig(guildId) || {};
    const logChannelId = cfg.logChannelId;
    if (!isValidId(logChannelId)) return;

    const ch = await guild.channels.fetch(logChannelId).catch(() => null);
    if (!ch || !ch.isTextBased()) return;

    const color = getEmbedColorFromConfig(guildId);

    const lvl = String(level || 'INFO').toUpperCase();
    const icon = lvl === 'ERROR' ? '❌' : (lvl === 'WARN' ? '⚠️' : 'ℹ️');

    const desc = sanitize(
      (Array.isArray(lines) ? lines : [String(lines)])
        .filter(Boolean)
        .join('\n')
    ).slice(0, 3500);

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${icon} ${sanitize(title || 'Log')}`)
      .setDescription(desc || '_-_')
      .setFooter({ text: `${getClubName(cfg, guild)} • Scheduler` })
      .setTimestamp();

    await ch.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  } catch {
    // ne casse jamais le scheduler
  }
}

/* ============================================================
   DISPOS : OUTILS
============================================================ */
function idsLine(colOrArray) {
  const arr = Array.isArray(colOrArray) ? colOrArray : [...colOrArray.values()];
  if (!arr.length) return '_Aucun_';

  // Collection<Member>
  if (arr[0] && arr[0].id && arr[0].user) {
    return arr
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map(m => `<@${m.id}>`)
      .join(' - ');
  }

  // Array<string>
  return arr.map(id => `<@${id}>`).join(' - ');
}

async function fetchDispoDataForDay(guild, jour) {
  const cfg = getGuildConfig(guild.id) || {};
  const dispoMessageId = cfg.dispoMessages?.[jour];
  const dispoChannelId = cfg.mainDispoChannelId;

  if (!isValidId(dispoChannelId) || !isValidId(dispoMessageId)) return null;

  const roleJoueurId = isValidId(cfg.roles?.joueur) ? cfg.roles.joueur : null;
  const roleEssaiId  = isValidId(cfg.roles?.essai)  ? cfg.roles.essai  : null;
  if (!roleJoueurId && !roleEssaiId) return null;

  const dispoChannel = await guild.channels.fetch(dispoChannelId).catch(() => null);
  if (!dispoChannel || !dispoChannel.isTextBased()) return null;

  let message;
  try {
    message = await dispoChannel.messages.fetch({ message: dispoMessageId, force: true });
  } catch {
    return null;
  }

  await guild.members.fetch().catch(() => {});

  const roleJoueur = roleJoueurId ? guild.roles.cache.get(roleJoueurId) : null;
  const roleEssai  = roleEssaiId  ? guild.roles.cache.get(roleEssaiId)  : null;

  const reacted = new Set();
  const yes = new Set();
  const no = new Set();

  try { await message.fetch().catch(() => {}); } catch {}

  for (const [, reaction] of message.reactions.cache) {
    const emojiName = reaction.emoji?.name;
    if (!['✅', '❌'].includes(emojiName)) continue;

    const users = await reaction.users.fetch().catch(() => null);
    if (!users) continue;

    users.forEach(u => {
      if (u.bot) return;
      reacted.add(u.id);
      if (emojiName === '✅') yes.add(u.id);
      else no.add(u.id);
    });
  }

  const eligibles = guild.members.cache.filter(m => {
    if (m.user.bot) return false;
    const hasJoueur = roleJoueur ? m.roles.cache.has(roleJoueur.id) : false;
    const hasEssai  = roleEssai  ? m.roles.cache.has(roleEssai.id)  : false;
    return hasJoueur || hasEssai;
  });

  const nonRepondus = eligibles.filter(m => !reacted.has(m.id));
  const presentsAll = guild.members.cache.filter(m => !m.user.bot && yes.has(m.id));
  const absentsAll  = guild.members.cache.filter(m => !m.user.bot && no.has(m.id));

  const messageURL = `https://discord.com/channels/${guild.id}/${dispoChannelId}/${dispoMessageId}`;
  const rowBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Voir le message du jour')
      .setStyle(ButtonStyle.Link)
      .setURL(messageURL)
  );

  return {
    cfg,
    dispoChannel,
    message,
    messageURL,
    rowBtn,
    reacted,
    yes,
    no,
    eligibles,
    nonRepondus,
    presentsAll,
    absentsAll
  };
}

/* ============================================================
   12h : RAPPEL + RAPPORT
============================================================ */
function splitByMessageLimit(allIds, headerText = '', sep = ' - ', limit = 1900) {
  const batches = [];
  let cur = [];
  let curLen = headerText.length;

  for (const id of allIds) {
    const mention = `<@${id}>`;
    const addLen = (cur.length ? sep.length : 0) + mention.length;

    if (curLen + addLen > limit) {
      batches.push(cur);
      cur = [id];
      curLen = headerText.length + mention.length;
    } else {
      cur.push(id);
      curLen += addLen;
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

async function runNoonReminderForGuild(client, guildId, jour, schedule) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const ids = [...data.nonRepondus.values()].map(m => m.id);

  if (!ids.length) {
    await data.dispoChannel.send({
      content: `✅ Tout le monde a réagi pour **${jour.toUpperCase()}** !`,
      allowedMentions: { parse: [] }
    }).catch(() => {});
    return;
  }

  const header = [
    `📣 **Rappel aux absents (${jour.toUpperCase()})**`,
    'Merci de réagir aux disponibilités du jour ✅❌',
    `➡️ [Accéder au message du jour](${data.messageURL})`
  ].join('\n');

  const batches = splitByMessageLimit(ids, header + '\n\n');
  const first = batches.shift();

  if (first?.length) {
    await data.dispoChannel.send({
      content: `${header}\n\n${first.map(id => `<@${id}>`).join(' - ')}`,
      allowedMentions: schedule.noon.mentionInReminder ? { users: first, parse: [] } : { parse: [] }
    }).catch(() => {});
  }

  for (const batch of batches) {
    await data.dispoChannel.send({
      content: batch.map(id => `<@${id}>`).join(' - '),
      allowedMentions: schedule.noon.mentionInReminder ? { users: batch, parse: [] } : { parse: [] }
    }).catch(() => {});
  }
}

async function sendDetailedReportForGuild(client, guildId, jour, hourLabel, schedule, extra = {}) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const reportChannelId = data.cfg.rapportChannelId;
  if (!isValidId(reportChannelId)) return;

  const reportChannel = await guild.channels.fetch(reportChannelId).catch(() => null);
  if (!reportChannel || !reportChannel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(getEmbedColorFromConfig(guild.id))
    .setTitle(`📅 RAPPORT - ${jour.toUpperCase()} (${hourLabel})`)
    .addFields(
      { name: `✅ Présents (${data.presentsAll.size})`, value: idsLine(data.presentsAll).slice(0, 1024) || '_Aucun_' },
      { name: `❌ Ont dit absent (${data.absentsAll.size})`, value: idsLine(data.absentsAll).slice(0, 1024) || '_Aucun_' },
      { name: `⏳ N’ont pas réagi (${data.nonRepondus.size})`, value: idsLine(data.nonRepondus).slice(0, 1024) || '_Aucun_' }
    )
    .setFooter({ text: `${getClubName(data.cfg, guild)} ⚫ Rapport automatisé` })
    .setTimestamp();

  if (extra?.description) {
    embed.setDescription(sanitize(extra.description).slice(0, 3500));
  }

  await reportChannel.send({
    embeds: [embed],
    components: [data.rowBtn],
    allowedMentions: schedule.noon.mentionInReports ? { parse: ['users'] } : { parse: [] }
  }).catch(() => {});

  // Alimentation du salon LOGIS DISPO (source pour le rapport semaine)
  if (isValidId(data.cfg.logDisposChannelId)) {
    const logCh = await guild.channels.fetch(data.cfg.logDisposChannelId).catch(() => null);
    if (logCh?.isTextBased()) {
      await logCh.send({
        embeds: [embed],
        components: [data.rowBtn],
        allowedMentions: { parse: [] }
      }).catch(() => {});
    }
  }
}

/* ============================================================
   CLOSE : FERMETURE — SANS SNAPSHOT
============================================================ */
async function closeDisposForGuild(client, guildId, jour, schedule) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const clubName = getClubName(data.cfg, guild);
  const color = getEmbedColorFromConfig(guild.id);

  // Lock embed (si embed existant)
  try {
    const exist = data.message.embeds?.[0];
    if (exist) {
      const e = EmbedBuilder.from(exist);
      const desc = sanitize(exist.description || '');
      const lockLine = '🔒 **Disponibilités fermées** – merci de ne plus réagir.';
      if (!desc.includes('Disponibilités fermées')) {
        e.setDescription([desc, '', lockLine].filter(Boolean).join('\n'));
        e.setFooter({ text: `${clubName} ⚫ Disponibilités (fermées)` });
        e.setColor(color);
        await data.message.edit({ content: '', embeds: [e] }).catch(() => {});
      }
    }
  } catch {}

  if (schedule.close.clearReactions) {
    try { await data.message.reactions.removeAll(); } catch {}
  }

  if (schedule.close.sendCloseMessage) {
    try {
      await data.dispoChannel.send({
        content: sanitize(
          [
            `🔒 **Les disponibilités pour ${jour.toUpperCase()} sont désormais fermées.**`,
            'Merci de votre compréhension.',
            '',
            `➡️ [Voir le message du jour](${data.messageURL})`
          ].join('\n')
        ),
        allowedMentions: { parse: [] }
      });
    } catch {}
  }
}

/* ============================================================
   RAPPORT SEMAINE (SANS SNAPSHOTS) — Calcul via salon logDisposChannelId
============================================================ */
function parseMentionsFromText(text) {
  const s = String(text || '');
  const ids = new Set();
  const re = /<@(\d{17,20})>/g;
  let m;
  while ((m = re.exec(s))) ids.add(m[1]);
  return [...ids];
}

function isDailyReportEmbed(embed) {
  const title = String(embed?.title || '');
  return title.startsWith('📅 RAPPORT - ');
}

/**
 * Fetch messages dans un salon jusqu'à atteindre sinceMs ou un plafond.
 * (évite le "limit=100" insuffisant quand le salon est très actif)
 */
async function fetchMessagesSince(channel, sinceMs, hardCap = 600) {
  const out = [];
  let beforeId = null;

  while (out.length < hardCap) {
    const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }).catch(() => null);
    if (!batch || batch.size === 0) break;

    const values = [...batch.values()];
    out.push(...values);

    const oldest = values[values.length - 1];
    beforeId = oldest.id;

    // stop si on est déjà plus vieux que la fenêtre
    if (oldest.createdTimestamp < sinceMs) break;
  }

  return out;
}

async function autoWeekDispoReportForGuild(client, guildId, schedule) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const cfg = getGuildConfig(guild.id) || {};
  const reportChannelId = cfg.rapportChannelId;
  const logDisposChannelId = cfg.logDisposChannelId;

  if (!isValidId(reportChannelId) || !isValidId(logDisposChannelId)) {
    await sendLogEmbed(client, guildId, 'WARN', 'Rapport semaine ignoré', [
      !isValidId(reportChannelId) ? '• rapportChannelId manquant' : '',
      !isValidId(logDisposChannelId) ? '• logDisposChannelId manquant (salon LOGIS DISPO)' : ''
    ].filter(Boolean));
    return;
  }

  const reportChannel = await guild.channels.fetch(reportChannelId).catch(() => null);
  const logCh = await guild.channels.fetch(logDisposChannelId).catch(() => null);

  if (!reportChannel?.isTextBased() || !logCh?.isTextBased()) return;

  const color = getEmbedColorFromConfig(guild.id);
  const clubLabel = getClubName(cfg, guild);

  const lookbackDays = Math.max(2, Number(schedule.weekly.lookbackDays || 7));
  const sinceMs = Date.now() - (lookbackDays * 24 * 60 * 60 * 1000);

  const messages = await fetchMessagesSince(logCh, sinceMs, 600);
  if (!messages.length) return;

  // Filtre: messages du bot + embed rapport du jour
  const daily = messages
    .filter(m => m.createdTimestamp >= sinceMs)
    .filter(m => m.author?.id === client.user.id)
    .filter(m => Array.isArray(m.embeds) && m.embeds.length)
    .map(m => ({ msg: m, embed: m.embeds[0] }))
    .filter(x => isDailyReportEmbed(x.embed));

  if (!daily.length) {
    const embedEmpty = new EmbedBuilder()
      .setColor(color)
      .setTitle('📅 RAPPORT SEMAINE — Disponibilités')
      .setDescription(
        [
          '⚠️ Aucun rapport journalier détecté dans le salon **LOGIS DISPO** sur la période.',
          `🗓️ Fenêtre : **${lookbackDays}** jour(s)`,
          '',
          '➡️ Assure-toi que le scheduler envoie bien les rapports journaliers dans ce salon.'
        ].join('\n')
      )
      .setFooter({ text: `${clubLabel} • Rapport semaine` })
      .setTimestamp();

    await reportChannel.send({ embeds: [embedEmpty], allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  // Cumul des non-répondus par user
  const misses = new Map(); // userId -> count
  const usedDays = new Set(); // évite doublons si plusieurs rapports du même jour

  // Trier du plus récent au plus ancien
  daily.sort((a, b) => b.msg.createdTimestamp - a.msg.createdTimestamp);

  for (const { msg, embed } of daily) {
    const d = new Date(msg.createdTimestamp);
    const keyDay = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    if (usedDays.has(keyDay)) continue;
    usedDays.add(keyDay);

    const fields = Array.isArray(embed.fields) ? embed.fields : [];
    const nr = fields.find(f => String(f?.name || '').startsWith('⏳ N’ont pas réagi'));
    if (!nr?.value) continue;

    const ids = parseMentionsFromText(nr.value);
    for (const id of ids) {
      misses.set(id, (misses.get(id) || 0) + 1);
    }
  }

  const entries = [...misses.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const headerLines = [
    `🗓️ Fenêtre analysée : **${usedDays.size}** jour(s) (sur ${lookbackDays} demandés)`,
    `📌 Source : <#${logDisposChannelId}>`
  ];

  if (!entries.length) {
    const embedOK = new EmbedBuilder()
      .setColor(color)
      .setTitle('✅ RAPPORT SEMAINE — Tout le monde a réagi')
      .setDescription(headerLines.join('\n'))
      .setFooter({ text: `${clubLabel} • Rapport semaine` })
      .setTimestamp();

    await reportChannel.send({ embeds: [embedOK], allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  const linesTop = entries.slice(0, 25).map(([id, n]) => `• <@${id}> — **${n}** jour(s) sans réaction`);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⏳ RAPPORT SEMAINE — Non-réagis (total : ${entries.length})`)
    .setDescription(headerLines.join('\n'))
    .addFields({
      name: 'Classement (top 25)',
      value: linesTop.join('\n').slice(0, 1024)
    })
    .setFooter({ text: `${clubLabel} • Rapport semaine` })
    .setTimestamp();

  await reportChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

/* ============================================================
   SYNC PSEUDOS (auto)
============================================================ */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function autoSyncNicknamesForGuild(client, guildId, schedule) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const me = guild.members.me;
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageNicknames)) return;

  const cfg = getGuildConfig(guild.id) || {};
  const nicknameCfg = cfg.nickname || {};

  const hasAny =
    (Array.isArray(nicknameCfg.hierarchy) && nicknameCfg.hierarchy.length) ||
    (Array.isArray(nicknameCfg.teams) && nicknameCfg.teams.length) ||
    (Array.isArray(nicknameCfg.postes) && nicknameCfg.postes.length);

  if (!hasAny) return;

  await guild.members.fetch().catch(() => {});
  const members = guild.members.cache.filter(m => !m.user.bot);

  for (const member of members.values()) {
    const newNick = buildNickname(member, nicknameCfg, cfg);
    const current = member.nickname || member.user.username;

    if (current === newNick) continue;
    if (!member.manageable) continue;

    try {
      await member.setNickname(newNick, 'Synchronisation pseudos (auto)');
      await sleep(schedule.nickSync.sleepMs);
    } catch {}
  }
}

/* ============================================================
   INIT SCHEDULER (INRATABLE)
============================================================ */
function initScheduler(client, opts = {}) {
  // lastRun[guildId] = { noon, close, weekly, nick }
  const lastRun = new Map();
  let tickRunning = false;

  const TICK_MS = 15 * 1000;

  const tick = async () => {
    if (tickRunning) return;
    tickRunning = true;

    try {
      const guildIds = computeTargetGuildIds(client, opts);
      if (!guildIds.length) return;

      for (const gid of guildIds) {
        const schedule = getScheduleForGuild(gid);
        const { hour, minute, isoDate: dateKey, jour } = getParisParts(schedule.timezone);
        if (!isEligibleDay(jour)) continue;

        const state = lastRun.get(gid) || { noon: null, close: null, weekly: null, nick: null };

        // --- NOON (rappel + rapport) ---
        if (
          schedule.noon.enabled &&
          withinGraceAfter(hour, minute, schedule.noon.hour, schedule.noon.minute, schedule.noon.graceMin)
        ) {
          const key = `${dateKey}-noon-${schedule.noon.hour}:${schedule.noon.minute}`;
          if (state.noon !== key) {
            state.noon = key;

            await sendLogEmbed(client, gid, 'INFO', 'NOON — Rappel + Rapport', [
              `• Jour : **${jour.toUpperCase()}**`,
              `• Heure : **${pad2(schedule.noon.hour)}:${pad2(schedule.noon.minute)}**`
            ]);

            try { await runNoonReminderForGuild(client, gid, jour, schedule); }
            catch (e) {
              await sendLogEmbed(client, gid, 'ERROR', 'Erreur — Noon reminder', [String(e?.message || e)]);
            }

            try {
              await sendDetailedReportForGuild(
                client, gid, jour,
                `${schedule.noon.hour}h${pad2(schedule.noon.minute)}`,
                schedule
              );
            } catch (e) {
              await sendLogEmbed(client, gid, 'ERROR', 'Erreur — Noon report', [String(e?.message || e)]);
            }
          }
        }

        // --- CLOSE (rapport + fermeture) ---
        if (
          schedule.close.enabled &&
          withinGraceAfter(hour, minute, schedule.close.hour, schedule.close.minute, schedule.close.graceMin)
        ) {
          const key = `${dateKey}-close-${schedule.close.hour}:${schedule.close.minute}`;
          if (state.close !== key) {
            state.close = key;

            await sendLogEmbed(client, gid, 'INFO', 'CLOSE — Rapport + Fermeture', [
              `• Jour : **${jour.toUpperCase()}**`,
              `• Heure : **${pad2(schedule.close.hour)}:${pad2(schedule.close.minute)}**`,
              `• Clear reactions : **${schedule.close.clearReactions ? 'ON' : 'OFF'}**`,
              `• Message fermeture : **${schedule.close.sendCloseMessage ? 'ON' : 'OFF'}**`
            ]);

            try {
              await sendDetailedReportForGuild(
                client, gid, jour,
                `${schedule.close.hour}h${pad2(schedule.close.minute)}`,
                schedule
              );
            } catch (e) {
              await sendLogEmbed(client, gid, 'ERROR', 'Erreur — Close report', [String(e?.message || e)]);
            }

            try { await closeDisposForGuild(client, gid, jour, schedule); }
            catch (e) {
              await sendLogEmbed(client, gid, 'ERROR', 'Erreur — Close (fermeture)', [String(e?.message || e)]);
            }
          }
        }

        // --- WEEKLY (JEUDI par défaut) — Rapport semaine sans snapshots ---
        const weeklyDayOk = jour === String(schedule.weekly.day || 'jeudi').toLowerCase();
        if (
          schedule.weekly.enabled &&
          weeklyDayOk &&
          withinGraceAfter(hour, minute, schedule.weekly.hour, schedule.weekly.minute, schedule.weekly.graceMin)
        ) {
          const key = `${dateKey}-weekly-${schedule.weekly.hour}:${schedule.weekly.minute}`;
          if (state.weekly !== key) {
            state.weekly = key;

            await sendLogEmbed(client, gid, 'INFO', 'WEEKLY — Rapport semaine', [
              `• Jour : **${jour.toUpperCase()}**`,
              `• Heure : **${pad2(schedule.weekly.hour)}:${pad2(schedule.weekly.minute)}**`,
              `• Fenêtre : **${schedule.weekly.lookbackDays}** jour(s)`
            ]);

            try { await autoWeekDispoReportForGuild(client, gid, schedule); }
            catch (e) {
              await sendLogEmbed(client, gid, 'ERROR', 'Erreur — Weekly report', [String(e?.message || e)]);
            }
          }
        }

        // --- NICK SYNC (tous les jours à minute X, 1 fois par heure) ---
        if (schedule.nickSync.enabled && minute === schedule.nickSync.minute) {
          const key = `${dateKey}-nick-${hour}`;
          if (state.nick !== key) {
            state.nick = key;

            await sendLogEmbed(client, gid, 'INFO', 'NICKSYNC — Synchronisation pseudos', [
              `• Heure : **${pad2(hour)}:${pad2(minute)}**`,
              `• Sleep : **${schedule.nickSync.sleepMs}ms**`
            ]);

            try { await autoSyncNicknamesForGuild(client, gid, schedule); }
            catch (e) {
              await sendLogEmbed(client, gid, 'ERROR', 'Erreur — Nick sync', [String(e?.message || e)]);
            }
          }
        }

        lastRun.set(gid, state);
      }
    } finally {
      tickRunning = false;
    }
  };

  tick().catch(() => {});
  setInterval(() => tick().catch(() => {}), TICK_MS);
}

module.exports = {
  initScheduler,

  // exposés (debug/tests)
  runNoonReminderForGuild,
  sendDetailedReportForGuild,
  closeDisposForGuild,
  autoWeekDispoReportForGuild,
  autoSyncNicknamesForGuild
};
