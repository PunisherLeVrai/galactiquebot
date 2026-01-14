// utils/scheduler.js — SANS SNAPSHOTS (clean)
// ✔ noon: rappel + rapport
// ✔ close: rapport + fermeture (lock embed + clear reactions + message)
// ✔ nickSync: synchro pseudos
// ✖ snapshots supprimés
// ✖ weekly snapshots supprimé

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

// 🔒 Anti-mentions accidentelles
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
 * on déclenche si NOW est après l'heure cible et dans une période de grâce
 */
function withinGraceAfter(nowH, nowM, targetH, targetM, graceMin = 10) {
  const now = minutesOfDay(nowH, nowM);
  const target = minutesOfDay(targetH, targetM);
  return now >= target && now <= (target + graceMin);
}

/* ============================================================
   SCHEDULE PAR SERVEUR (configurable dans servers.json)
   NOTE: weekly supprimé (snapshots supprimés)
============================================================ */
function getScheduleForGuild(guildId) {
  const cfg = getGuildConfig(guildId) || {};
  const s = cfg.automationSchedule || {};

  const timezone = s.timezone || 'Europe/Paris';

  const noon = s.noon || {};
  const close = s.close || {};
  const nickSync = s.nickSync || {};

  const noonTime = parseTimeHHMM(noon.time, { hour: 12, minute: 0 });
  const closeTime = parseTimeHHMM(close.time, { hour: 17, minute: 0 });

  return {
    timezone,

    noon: {
      enabled: noon.enabled ?? true,
      hour: noonTime.hour,
      minute: noonTime.minute,
      graceMin: Number.isFinite(noon.graceMin) ? noon.graceMin : 10,
      mentionInReminder: noon.mentionInReminder ?? true,
      mentionInReports: noon.mentionInReports ?? false
    },

    close: {
      enabled: close.enabled ?? true,
      hour: closeTime.hour,
      minute: closeTime.minute,
      graceMin: Number.isFinite(close.graceMin) ? close.graceMin : 10,
      clearReactions: close.clearReactions ?? true,
      sendCloseMessage: close.sendCloseMessage ?? true
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
   CLOSE : FERMETURE (heure configurable) — SANS SNAPSHOT
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
  logInfo('Scheduler ON (robuste) : noon / close / nickSync (snapshots OFF)');

  // lastRun[guildId] = { noon, close, nick }
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

        const state = lastRun.get(gid) || { noon: null, close: null, nick: null };

        // --- NOON (rappel + rapport) ---
        if (
          schedule.noon.enabled &&
          withinGraceAfter(hour, minute, schedule.noon.hour, schedule.noon.minute, schedule.noon.graceMin)
        ) {
          const key = `${dateKey}-noon-${schedule.noon.hour}:${schedule.noon.minute}`;
          if (state.noon !== key) {
            state.noon = key;
            logInfo(`NOON ${gid} -> ${jour} (${schedule.noon.hour}:${String(schedule.noon.minute).padStart(2,'0')})`);

            try { await runNoonReminderForGuild(client, gid, jour, schedule); }
            catch (e) { logErr(`noon reminder (${gid})`, e?.message || e); }

            try {
              await sendDetailedReportForGuild(
                client, gid, jour,
                `${schedule.noon.hour}h${String(schedule.noon.minute).padStart(2,'0')}`,
                schedule
              );
            } catch (e) {
              logErr(`noon report (${gid})`, e?.message || e);
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
            logInfo(`CLOSE ${gid} -> ${jour} (${schedule.close.hour}:${String(schedule.close.minute).padStart(2,'0')})`);

            try {
              await sendDetailedReportForGuild(
                client, gid, jour,
                `${schedule.close.hour}h${String(schedule.close.minute).padStart(2,'0')}`,
                schedule
              );
            } catch (e) {
              logErr(`close report (${gid})`, e?.message || e);
            }

            try { await closeDisposForGuild(client, gid, jour, schedule); }
            catch (e) { logErr(`close (${gid})`, e?.message || e); }
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

  tick().catch(() => {});
  setInterval(() => tick().catch(() => {}), TICK_MS);
}

module.exports = {
  initScheduler,

  // exposés (debug/tests)
  runNoonReminderForGuild,
  sendDetailedReportForGuild,
  closeDisposForGuild,
  autoSyncNicknamesForGuild
};
