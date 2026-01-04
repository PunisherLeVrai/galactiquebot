// utils/scheduler.js
const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require('discord.js');

const { getGuildConfig } = require('./config');
const { SNAPSHOT_DIR, ensureSnapshotDirectory } = require('./paths');
const { buildNickname } = require('./nickname'); // ✅ NEW: format configurable + réutilisé partout

const DEFAULT_COLOR = 0xff4db8;

/* ============================================================
   LOG
============================================================ */
function logInfo(...args) { console.log('ℹ️ [AUTO]', ...args); }
function logWarn(...args) { console.log('⚠️ [AUTO]', ...args); }
function logErr(...args)  { console.error('❌ [AUTO]', ...args); }

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

const sanitize = (t) =>
  String(t || '').replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]');

function isEligibleDay(jour) {
  return ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'].includes(jour);
}

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
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

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
 * - on déclenche si NOW est après l'heure cible et dans une période de grâce
 * - graceMin par défaut = 10 minutes (si redémarrage à 12:07 -> OK)
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

  return {
    timezone,

    noon: {
      enabled: noon.enabled ?? true,
      hour: noonTime.hour,
      minute: noonTime.minute,
      // windowMin conservé, mais on utilise surtout graceMin
      windowMin: Number.isFinite(noon.windowMin) ? noon.windowMin : 2,
      graceMin: Number.isFinite(noon.graceMin) ? noon.graceMin : 10,
      mentionInReminder: noon.mentionInReminder ?? true,
      mentionInReports: noon.mentionInReports ?? false
    },

    close: {
      enabled: close.enabled ?? true,
      hour: closeTime.hour,
      minute: closeTime.minute,
      windowMin: Number.isFinite(close.windowMin) ? close.windowMin : 2,
      graceMin: Number.isFinite(close.graceMin) ? close.graceMin : 10,
      clearReactions: close.clearReactions ?? true,
      sendCloseMessage: close.sendCloseMessage ?? true
    },

    weekly: {
      enabled: weekly.enabled ?? true,
      day: (weekly.day || 'dimanche').toLowerCase(),
      hour: weeklyTime.hour,
      minute: weeklyTime.minute,
      windowMin: Number.isFinite(weekly.windowMin) ? weekly.windowMin : 2,
      graceMin: Number.isFinite(weekly.graceMin) ? weekly.graceMin : 10
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
   DISPOS : RÉCUP DATA
============================================================ */
function idsLine(colOrArray) {
  const arr = Array.isArray(colOrArray) ? colOrArray : [...colOrArray.values()];
  if (!arr.length) return '_Aucun_';

  if (arr[0] && arr[0].id && arr[0].user) {
    return arr
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map(m => `<@${m.id}>`)
      .join(' - ');
  }

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
    // force fetch -> meilleur quand cache / partials
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

  // sécurise: fetch des réactions si cache vide
  try {
    if (!message.reactions.cache.size) await message.fetch(true).catch(() => {});
  } catch {}

  for (const [, reaction] of message.reactions.cache) {
    const emojiName = reaction.emoji?.name;
    if (!['✅', '❌'].includes(emojiName)) continue;

    // fetch users ayant réagi (API)
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

async function sendDetailedReportForGuild(client, guildId, jour, hourLabel, schedule) {
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

  await reportChannel.send({
    embeds: [embed],
    components: [data.rowBtn],
    allowedMentions: schedule.noon.mentionInReports ? { parse: ['users'] } : { parse: [] }
  }).catch(() => {});
}

/* ============================================================
   CLOSE : FERMETURE + SNAPSHOT (heure configurable)
============================================================ */
async function closeDisposForGuild(client, guildId, jour, isoDate, schedule) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const clubName = getClubName(data.cfg, guild);
  const color = getEmbedColorFromConfig(guild.id);

  // Snapshot persistant
  try {
    ensureSnapshotDirectory();

    const snapshot = {
      type: 'dispos',
      guildId: guild.id,
      clubName,
      jour,
      date: isoDate,
      messageId: data.message.id,
      channelId: data.dispoChannel.id,
      reacted: [...data.reacted],
      presents: [...data.yes],
      absents: [...data.no],
      eligibles: [...data.eligibles.keys()]
    };

    const snapPath = path.join(SNAPSHOT_DIR, `dispos-${jour}-${isoDate}.json`);
    fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2), 'utf8');
    logInfo(`✅ snapshot écrit: ${snapPath}`);
  } catch (e) {
    logErr('snapshot dispo (écriture):', e?.message || e);
  }

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
   RAPPORT SEMAINE via SNAPSHOTS
============================================================ */
const DISPO_SNAP_REGEX =
  /^dispos-(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)-(\d{4}-\d{2}-\d{2})\.json$/i;

function parseISODate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return new Date(y, mo - 1, da, 0, 0, 0, 0);
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, delta) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + delta);
  return x;
}

function readDispoSnapshotsInRange(fromDate, toDate, guildId) {
  const snaps = [];
  if (!fs.existsSync(SNAPSHOT_DIR)) return snaps;

  const files = fs.readdirSync(SNAPSHOT_DIR).filter(f => DISPO_SNAP_REGEX.test(f));
  for (const f of files) {
    const m = DISPO_SNAP_REGEX.exec(f);
    if (!m) continue;

    const fileDate = parseISODate(m[2]);
    if (!fileDate) continue;

    if (fileDate >= fromDate && fileDate <= toDate) {
      try {
        const js = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8'));
        if (guildId && String(js?.guildId || '') !== String(guildId)) continue;
        snaps.push({ file: f, date: fileDate, data: js });
      } catch {}
    }
  }

  snaps.sort((a, b) => a.date - b.date);
  return snaps;
}

async function autoWeekDispoReportForGuild(client, guildId, schedule) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const cfg = getGuildConfig(guild.id) || {};
  const reportChannelId = cfg.rapportChannelId;
  if (!isValidId(reportChannelId)) return;

  const reportChannel = await guild.channels.fetch(reportChannelId).catch(() => null);
  if (!reportChannel || !reportChannel.isTextBased()) return;

  const color = getEmbedColorFromConfig(guild.id);
  const clubLabel = getClubName(cfg, guild);

  const nowParis = getParisParts(schedule.timezone);
  const end = new Date(nowParis.year, nowParis.month - 1, nowParis.day);
  const start = addDays(end, -6);

  const debutStr = toISO(start);
  const finStr = toISO(end);

  const fromDate = parseISODate(debutStr);
  const toDate = parseISODate(finStr);

  const snaps = readDispoSnapshotsInRange(fromDate, toDate, guild.id);

  if (!snaps.length) {
    const embedEmpty = new EmbedBuilder()
      .setColor(color)
      .setTitle('📅 Check semaine (snapshots)')
      .setDescription(`⚠️ Aucun snapshot dispo sur **${debutStr} → ${finStr}**.`)
      .setFooter({ text: `${clubLabel} • Rapport snapshots` })
      .setTimestamp();

    await reportChannel.send({ embeds: [embedEmpty], allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  await guild.members.fetch().catch(() => {});
  const misses = new Map();
  let used = 0;
  let skipped = 0;

  for (const s of snaps) {
    const data = s.data || {};
    const reacted = new Set(Array.isArray(data.reacted) ? data.reacted : []);
    const eligibles = Array.isArray(data.eligibles) ? data.eligibles : null;

    if (!eligibles?.length) { skipped++; continue; }

    used++;
    for (const id of eligibles) {
      if (!reacted.has(id)) misses.set(id, (misses.get(id) || 0) + 1);
    }
  }

  const entries = [...misses.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const headerLines = [
    '📅 **Check semaine (Snapshots)**',
    `🗓️ Période : **${debutStr} → ${finStr}**`,
    `📂 Snapshots utilisés : **${used}**`,
    skipped ? `⚠️ Ignorés : **${skipped}** (incomplets)` : ''
  ].filter(Boolean);

  if (!entries.length) {
    const embedOK = new EmbedBuilder()
      .setColor(color)
      .setTitle('✅ Semaine OK — tout le monde a réagi')
      .setDescription(headerLines.join('\n'))
      .setFooter({ text: `${clubLabel} • Rapport snapshots` })
      .setTimestamp();

    await reportChannel.send({ embeds: [embedOK], allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  const asLine = (id, n) => {
    const m = guild.members.cache.get(id);
    return m ? `<@${id}> — **${n}** jour(s) sans réaction` : `\`${id}\` *(hors serveur)* — **${n}** jour(s)`;
  };

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⏳ Semaine — non-réagis (total : ${entries.length})`)
    .setDescription(headerLines.join('\n'))
    .addFields({
      name: 'Liste (top 20)',
      value: entries.slice(0, 20).map(([id, n]) => `• ${asLine(id, n)}`).join('\n').slice(0, 1024)
    })
    .setFooter({ text: `${clubLabel} • Rapport snapshots` })
    .setTimestamp();

  await reportChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

/* ============================================================
   SYNC PSEUDOS (auto) — ✅ utilise utils/nickname.js + nickname.format
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
    const newNick = buildNickname(member, nicknameCfg, cfg); // ✅ format + tag/club support
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
  ensureSnapshotDirectory();

  logInfo('Scheduler ON (robuste) : noon / close+snapshot / weekly / nickSync');

  // lastRun[guildId] = { noon, close, weekly, nick }
  const lastRun = new Map();
  let tickRunning = false;

  const TICK_MS = 15 * 1000; // ✅ 15s -> beaucoup plus fiable qu'1 minute

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
        if (schedule.noon.enabled && withinGraceAfter(hour, minute, schedule.noon.hour, schedule.noon.minute, schedule.noon.graceMin)) {
          const key = `${dateKey}-noon-${schedule.noon.hour}:${schedule.noon.minute}`;
          if (state.noon !== key) {
            state.noon = key;
            logInfo(`NOON ${gid} -> ${jour} (${schedule.noon.hour}:${String(schedule.noon.minute).padStart(2,'0')})`);
            try { await runNoonReminderForGuild(client, gid, jour, schedule); }
            catch (e) { logErr(`noon reminder (${gid})`, e?.message || e); }

            try { await sendDetailedReportForGuild(client, gid, jour, `${schedule.noon.hour}h${String(schedule.noon.minute).padStart(2,'0')}`, schedule); }
            catch (e) { logErr(`noon report (${gid})`, e?.message || e); }
          }
        }

        // --- CLOSE (rapport + fermeture + snapshot) ---
        if (schedule.close.enabled && withinGraceAfter(hour, minute, schedule.close.hour, schedule.close.minute, schedule.close.graceMin)) {
          const key = `${dateKey}-close-${schedule.close.hour}:${schedule.close.minute}`;
          if (state.close !== key) {
            state.close = key;
            logInfo(`CLOSE ${gid} -> ${jour} (${schedule.close.hour}:${String(schedule.close.minute).padStart(2,'0')})`);

            try { await sendDetailedReportForGuild(client, gid, jour, `${schedule.close.hour}h${String(schedule.close.minute).padStart(2,'0')}`, schedule); }
            catch (e) { logErr(`close report (${gid})`, e?.message || e); }

            try { await closeDisposForGuild(client, gid, jour, dateKey, schedule); }
            catch (e) { logErr(`close + snapshot (${gid})`, e?.message || e); }
          }
        }

        // --- WEEKLY ---
        const weeklyDayOk = jour === String(schedule.weekly.day || 'dimanche').toLowerCase();
        if (schedule.weekly.enabled && weeklyDayOk && withinGraceAfter(hour, minute, schedule.weekly.hour, schedule.weekly.minute, schedule.weekly.graceMin)) {
          const key = `${dateKey}-weekly-${schedule.weekly.hour}:${schedule.weekly.minute}`;
          if (state.weekly !== key) {
            state.weekly = key;
            logInfo(`WEEKLY ${gid} -> ${jour} (${schedule.weekly.hour}:${String(schedule.weekly.minute).padStart(2,'0')})`);
            try { await autoWeekDispoReportForGuild(client, gid, schedule); }
            catch (e) { logErr(`weekly snapshots (${gid})`, e?.message || e); }
          }
        }

        // --- NICK SYNC (tous les jours à minute X, 1 fois par heure) ---
        if (schedule.nickSync.enabled && minute === schedule.nickSync.minute) {
          const key = `${dateKey}-nick-${hour}`;
          if (state.nick !== key) {
            state.nick = key;
            try { await autoSyncNicknamesForGuild(client, gid, schedule); }
            catch (e) { logErr(`nick sync (${gid})`, e?.message || e); }
          }
        }

        lastRun.set(gid, state);
      }
    } finally {
      tickRunning = false;
    }
  };

  // ✅ tick régulier + tick immédiat (super utile après redéploiement)
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
