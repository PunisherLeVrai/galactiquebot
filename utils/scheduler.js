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
const { SNAPSHOT_DIR } = require('./paths');

const DEFAULT_COLOR = 0xff4db8;

/* ============================================================
   🔒 IGA ONLY — HARD BLOCK
============================================================ */
const IGA_GUILD_ID = '1392639720491581551';

// ✅ Même si index.js passe d'autres guildIds, on ne garde que IGA
const DEFAULT_ALLOWED_GUILDS = [IGA_GUILD_ID];

const AUTOMATION = {
  timezone: 'Europe/Paris',

  // 12h : rappel public + rapport
  enableNoonReminder: true,
  mentionInReminder: true,
  mentionInReports: false,

  // 17h : fermeture + snapshot
  clearReactionsAt17: true,
  sendCloseMessageAt17: true
};

/* =========================
   UTILS
========================= */

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

function getParisParts() {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: AUTOMATION.timezone || 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
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
  if (hour === 24) hour = 0;

  const weekday = (get('weekday') || '').toLowerCase();
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const mapJour = {
    dimanche: 'dimanche', lundi: 'lundi', mardi: 'mardi', mercredi: 'mercredi',
    jeudi: 'jeudi', vendredi: 'vendredi', samedi: 'samedi'
  };
  const jour = mapJour[weekday] || 'lundi';

  return { year, month, day, hour, minute, isoDate, jour };
}

function idsLine(colOrArray) {
  const arr = Array.isArray(colOrArray) ? colOrArray : [...colOrArray.values()];
  if (!arr.length) return '_Aucun_';

  // Collection de GuildMember
  if (arr[0] && arr[0].id && arr[0].user) {
    return arr
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map(m => `<@${m.id}>`)
      .join(' - ');
  }

  // Array d'IDs
  return arr.map(id => `<@${id}>`).join(' - ');
}

/* ------------------------- Utils dates ------------------------- */

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

function inWindow(minute, start, end) {
  return minute >= start && minute <= end;
}

function isEligibleDay(jour) {
  return ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'].includes(jour);
}

/* ============================================================
   CIBLAGE SERVEURS — IGA ONLY
============================================================ */

function computeTargetGuildIds(client, opts = {}) {
  const present = new Set([...client.guilds.cache.keys()]);

  const source =
    (opts.targetGuildIds instanceof Set) ? [...opts.targetGuildIds] :
    (Array.isArray(opts.targetGuildIds)) ? opts.targetGuildIds :
    DEFAULT_ALLOWED_GUILDS;

  // ✅ Filtre présence + ✅ HARD BLOCK IGA ONLY
  return source
    .filter(id => present.has(id))
    .filter(id => String(id) === String(IGA_GUILD_ID));
}

/* ============================================================
   DISPOS : RÉCUP DATA
============================================================ */

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
    message = await dispoChannel.messages.fetch(dispoMessageId);
  } catch {
    return null;
  }

  await guild.members.fetch().catch(() => {});

  const roleJoueur = roleJoueurId ? guild.roles.cache.get(roleJoueurId) : null;
  const roleEssai  = roleEssaiId  ? guild.roles.cache.get(roleEssaiId)  : null;

  const reacted = new Set();
  const yes = new Set();
  const no = new Set();

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

async function runNoonReminderForGuild(client, guildId, jour) {
  if (String(guildId) !== String(IGA_GUILD_ID)) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const ids = [...data.nonRepondus.values()].map(m => m.id);

  if (!ids.length) {
    await data.dispoChannel.send({
      content: `✅ Tout le monde a réagi pour **${jour.toUpperCase()}** !`,
      allowedMentions: { parse: [] }
    });
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
      allowedMentions: AUTOMATION.mentionInReminder ? { users: first, parse: [] } : { parse: [] }
    });
  }

  for (const batch of batches) {
    await data.dispoChannel.send({
      content: batch.map(id => `<@${id}>`).join(' - '),
      allowedMentions: AUTOMATION.mentionInReminder ? { users: batch, parse: [] } : { parse: [] }
    });
  }
}

async function sendDetailedReportForGuild(client, guildId, jour, hourLabel) {
  if (String(guildId) !== String(IGA_GUILD_ID)) return;

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
      { name: `✅ Présents (${data.presentsAll.size})`, value: idsLine(data.presentsAll) },
      { name: `❌ Ont dit absent (${data.absentsAll.size})`, value: idsLine(data.absentsAll) },
      { name: `⏳ N’ont pas réagi (${data.nonRepondus.size})`, value: idsLine(data.nonRepondus) }
    )
    .setFooter({ text: `${getClubName(data.cfg, guild)} ⚫ Rapport automatisé` })
    .setTimestamp();

  await reportChannel.send({
    embeds: [embed],
    components: [data.rowBtn],
    allowedMentions: AUTOMATION.mentionInReports ? { parse: ['users'] } : { parse: [] }
  });
}

/* ============================================================
   17h : FERMETURE + SNAPSHOT
============================================================ */

async function closeDisposAt17ForGuild(client, guildId, jour, isoDate) {
  if (String(guildId) !== String(IGA_GUILD_ID)) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const clubName = getClubName(data.cfg, guild);
  const color = getEmbedColorFromConfig(guild.id);

  // Snapshot
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

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
  } catch (e) {
    console.error('❌ [AUTO] snapshot dispo 17h:', e);
  }

  // Lock embed
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
        await data.message.edit({ content: '', embeds: [e] });
      }
    }
  } catch {}

  if (AUTOMATION.clearReactionsAt17) {
    try { await data.message.reactions.removeAll(); } catch {}
  }

  if (AUTOMATION.sendCloseMessageAt17) {
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
   SEMAINE : DIMANCHE UNIQUEMENT (snapshots) — IGA ONLY
============================================================ */

const DISPO_SNAP_REGEX = /^dispos-(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)-(\d{4}-\d{2}-\d{2})\.json$/i;

function readDispoSnapshotsInRange(fromDate, toDate) {
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
        snaps.push({ file: f, date: fileDate, data: js });
      } catch {}
    }
  }

  snaps.sort((a, b) => a.date - b.date);
  return snaps;
}

async function autoWeekDispoReportForGuild(client, guildId) {
  if (String(guildId) !== String(IGA_GUILD_ID)) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const cfg = getGuildConfig(guild.id) || {};
  const reportChannelId = cfg.rapportChannelId;
  if (!isValidId(reportChannelId)) return;

  const reportChannel = await guild.channels.fetch(reportChannelId).catch(() => null);
  if (!reportChannel || !reportChannel.isTextBased()) return;

  const color = getEmbedColorFromConfig(guild.id);
  const clubLabel = getClubName(cfg, guild);

  const nowParis = getParisParts();
  const end = new Date(nowParis.year, nowParis.month - 1, nowParis.day);
  const start = addDays(end, -6);

  const debutStr = toISO(start);
  const finStr = toISO(end);

  const fromDate = parseISODate(debutStr);
  const toDate = parseISODate(finStr);

  const snaps = readDispoSnapshotsInRange(fromDate, toDate)
    .filter(s => String(s.data?.guildId || '') === String(guild.id));

  if (!snaps.length) {
    const embedEmpty = new EmbedBuilder()
      .setColor(color)
      .setTitle('📅 Analyse disponibilités (auto semaine)')
      .setDescription(`⚠️ Aucun snapshot dispo sur **${debutStr} → ${finStr}**.`)
      .setFooter({ text: `${clubLabel} • Rapport snapshots auto` })
      .setTimestamp();

    await reportChannel.send({ embeds: [embedEmpty], allowedMentions: { parse: [] } });
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
    '📅 **Analyse disponibilités (Snapshots auto)**',
    `🗓️ Période : **${debutStr} → ${finStr}**`,
    `📂 Snapshots utilisés : **${used}**`,
    skipped ? `⚠️ Ignorés : **${skipped}** (incomplets)` : ''
  ].filter(Boolean);

  if (!entries.length) {
    const embedOK = new EmbedBuilder()
      .setColor(color)
      .setTitle('✅ Tous ont réagi au moins une fois (auto semaine)')
      .setDescription(headerLines.join('\n'))
      .setFooter({ text: `${clubLabel} • Rapport snapshots auto` })
      .setTimestamp();

    await reportChannel.send({ embeds: [embedOK], allowedMentions: { parse: [] } });
    return;
  }

  const asLine = (id, n) => {
    const m = guild.members.cache.get(id);
    return m ? `<@${id}> — **${n}** jour(s) sans réaction` : `\`${id}\` *(hors serveur)* — **${n}** jour(s)`;
  };

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⏳ Membres n’ayant pas réagi (auto, total : ${entries.length})`)
    .setDescription(headerLines.join('\n'))
    .addFields({
      name: 'Liste',
      value: entries.slice(0, 20).map(([id, n]) => `• ${asLine(id, n)}`).join('\n').slice(0, 1024)
    })
    .setFooter({ text: `${clubLabel} • Rapport snapshots auto` })
    .setTimestamp();

  await reportChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

/* ============================================================
   SYNC PSEUDOS — IGA ONLY (NOUVEAU FORMAT)
   Format: Pseudo | (Hiérarchie OU Team) | Poste(s)
============================================================ */

const MAX_LEN = 32;
const SLEEP_MS = 350;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function cleanPseudo(username, room = MAX_LEN) {
  if (!username) return 'Joueur';

  let clean = username.replace(/[^A-Za-z]/g, '');
  if (!clean.length) return 'Joueur';

  clean = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  if (clean.length > room) clean = clean.slice(0, room - 1) + '…';
  return clean;
}

function getHierarchy(member, hierarchyRoles = []) {
  const found = hierarchyRoles.find(r => member.roles.cache.has(r.id));
  return found ? found.label : null;
}

function getTeam(member, teamRoles = []) {
  const found = teamRoles.find(r => member.roles.cache.has(r.id));
  return found ? found.label : null;
}

function getPostes(member, posteRoles = []) {
  return posteRoles
    .filter(p => member.roles.cache.has(p.id))
    .map(p => p.label)
    .slice(0, 3);
}

// ✅ Nouveau format: Pseudo | (Hiérarchie OU Team) | Poste(s)
function buildNickname(member, nicknameCfg = {}) {
  const hierarchyRoles = Array.isArray(nicknameCfg.hierarchy) ? nicknameCfg.hierarchy : [];
  const teamRoles = Array.isArray(nicknameCfg.teams) ? nicknameCfg.teams : [];
  const posteRoles = Array.isArray(nicknameCfg.postes) ? nicknameCfg.postes : [];

  const hierarchy = getHierarchy(member, hierarchyRoles);
  const team = getTeam(member, teamRoles);

  // Priorité: hiérarchie -> sinon team
  const mid = hierarchy || team || '';

  const postesArr = getPostes(member, posteRoles);
  const postes = postesArr.length ? postesArr.join('/') : '';

  const pseudoBase = cleanPseudo(member.user.username, MAX_LEN);

  const parts = [pseudoBase, mid, postes].filter(Boolean);
  let full = parts.join(' | ');

  // Si dépasse 32: on réduit le pseudo en priorité
  if (full.length > MAX_LEN) {
    const suffix = parts.slice(1).join(' | ');
    const suffixStr = suffix ? ` | ${suffix}` : '';
    const roomForPseudo = Math.max(3, MAX_LEN - suffixStr.length);

    const trimmedPseudo = cleanPseudo(member.user.username, roomForPseudo);
    full = `${trimmedPseudo}${suffixStr}`;
  }

  return full.slice(0, MAX_LEN);
}

async function autoSyncNicknamesForGuild(client, guildId) {
  if (String(guildId) !== String(IGA_GUILD_ID)) return;

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
    const newNick = buildNickname(member, nicknameCfg);
    const current = member.nickname || member.user.username;

    if (current === newNick) continue;
    if (!member.manageable) continue;

    try {
      await member.setNickname(newNick, 'Synchronisation pseudos (auto)');
      await sleep(SLEEP_MS);
    } catch {}
  }
}

/* ============================================================
   INIT SCHEDULER — IGA ONLY
============================================================ */

function initScheduler(client, opts = {}) {
  console.log('⏰ Scheduler: IGA ONLY — 12h (rappel+rapport) / 17h (rapport+close+snapshot) / dimanche 22h (semaine) / sync pseudos H:10');

  const last = { noon: null, close17: null, week: null, nick: null };
  let tickRunning = false;

  setInterval(async () => {
    if (tickRunning) return;
    tickRunning = true;

    try {
      const { hour, minute, isoDate: dateKey, jour } = getParisParts();
      if (!isEligibleDay(jour)) return;

      const guildIds = computeTargetGuildIds(client, opts);
      if (!guildIds.length) return;

      // 12h → rappel + rapport (0-2)
      if (hour === 12 && inWindow(minute, 0, 2)) {
        const key = `${dateKey}-12`;
        if (last.noon !== key) {
          last.noon = key;

          for (const gid of guildIds) {
            try {
              if (AUTOMATION.enableNoonReminder) await runNoonReminderForGuild(client, gid, jour);
            } catch (e) {
              console.error(`❌ [AUTO] rappel 12h (${gid})`, e);
            }

            try {
              await sendDetailedReportForGuild(client, gid, jour, '12h');
            } catch (e) {
              console.error(`❌ [AUTO] rapport 12h (${gid})`, e);
            }
          }
        }
      }

      // 17h → rapport + fermeture (0-2)
      if (hour === 17 && inWindow(minute, 0, 2)) {
        const key = `${dateKey}-17`;
        if (last.close17 !== key) {
          last.close17 = key;

          for (const gid of guildIds) {
            try { await sendDetailedReportForGuild(client, gid, jour, '17h'); }
            catch (e) { console.error(`❌ [AUTO] rapport 17h (${gid})`, e); }

            try { await closeDisposAt17ForGuild(client, gid, jour, dateKey); }
            catch (e) { console.error(`❌ [AUTO] close 17h (${gid})`, e); }
          }
        }
      }

      // ✅ DIMANCHE uniquement : rapport semaine (22:04 - 22:06)
      if (jour === 'dimanche' && hour === 22 && inWindow(minute, 4, 6)) {
        const key = `${dateKey}-22-week`;
        if (last.week !== key) {
          last.week = key;

          for (const gid of guildIds) {
            try { await autoWeekDispoReportForGuild(client, gid); }
            catch (e) { console.error(`❌ [AUTO] dispo week (${gid})`, e); }
          }
        }
      }

      // Sync pseudos — toutes les heures à H:10
      if (minute === 10) {
        const key = `${dateKey}-${hour}`;
        if (last.nick !== key) {
          last.nick = key;

          for (const gid of guildIds) {
            try { await autoSyncNicknamesForGuild(client, gid); }
            catch (e) { console.error(`❌ [AUTO] sync pseudos (${gid})`, e); }
          }
        }
      }
    } finally {
      tickRunning = false;
    }
  }, 60 * 1000);
}

module.exports = {
  initScheduler,
  runNoonReminderForGuild,
  sendDetailedReportForGuild,
  closeDisposAt17ForGuild,
  autoWeekDispoReportForGuild,
  autoSyncNicknamesForGuild
};
