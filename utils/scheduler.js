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
const RAPPORTS_DIR = path.join(__dirname, '../rapports');

const AUTOMATION = {
  timezone: 'Europe/Paris',
  mentionInReminder: true,
  mentionInReports: false,
  clearReactionsAt17: true,
  sendCloseMessageAt17: true
};

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

/**
 * Date/heure Paris fiable (corrige le cas "24")
 */
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

  const isoDate =
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const mapJour = {
    'dimanche': 'dimanche',
    'lundi': 'lundi',
    'mardi': 'mardi',
    'mercredi': 'mercredi',
    'jeudi': 'jeudi',
    'vendredi': 'vendredi',
    'samedi': 'samedi'
  };
  const jour = mapJour[weekday] || 'lundi';

  return { year, month, day, hour, minute, isoDate, jour };
}

function idsLine(colOrArray) {
  const arr = Array.isArray(colOrArray)
    ? colOrArray
    : [...colOrArray.values()];
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

/* ============================================================
   SERVEURS
============================================================ */

function getAllGuildIds(client) {
  return [...client.guilds.cache.keys()];
}

function getEligibleDayKey(jour) {
  return ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'].includes(jour);
}

/* ============================================================
   SNAPSHOTS COMPO (/rapports)
============================================================ */

function readCompoSnapshotsInRange(fromDate, toDate) {
  const snaps = [];
  if (!fs.existsSync(RAPPORTS_DIR)) return snaps;

  const files = fs.readdirSync(RAPPORTS_DIR)
    .filter(f => f.startsWith('compo-') && f.endsWith('.json'));

  for (const f of files) {
    try {
      const full = path.join(RAPPORTS_DIR, f);
      const js = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (js.type !== 'compo') continue;

      const fileDate = js.date ? parseISODate(js.date) : null;
      if (!fileDate) continue;

      if (fileDate >= fromDate && fileDate <= toDate) {
        snaps.push({ file: f, date: fileDate, data: js });
      }
    } catch {}
  }

  snaps.sort((a, b) => a.date - b.date);
  return snaps;
}

/* ============================================================
   SNAPSHOTS DISPOS (SNAPSHOT_DIR)
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

/* ============================================================
   DISPOS : RÉCUP DATA
============================================================ */

async function fetchDispoDataForDay(guild, jour) {
  const cfg = getGuildConfig(guild.id) || {};
  const dispoMessages = cfg.dispoMessages || {};
  const dispoMessageId = dispoMessages[jour];
  const dispoChannelId = cfg.mainDispoChannelId;
  const rolesCfg = cfg.roles || {};

  if (!isValidId(dispoChannelId) || !isValidId(dispoMessageId)) return null;

  const roleJoueurId = isValidId(rolesCfg.joueur) ? rolesCfg.joueur : null;
  const roleEssaiId = isValidId(rolesCfg.essai) ? rolesCfg.essai : null;
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
  const roleEssai = roleEssaiId ? guild.roles.cache.get(roleEssaiId) : null;

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
    const hasEssai = roleEssai ? m.roles.cache.has(roleEssai.id) : false;
    return hasJoueur || hasEssai;
  });

  const nonRepondus = eligibles.filter(m => !reacted.has(m.id));
  const presentsAll = guild.members.cache.filter(m => !m.user.bot && yes.has(m.id));
  const absentsAll = guild.members.cache.filter(m => !m.user.bot && no.has(m.id));

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
   DISPOS : PANNEAU (10h / 22h)
============================================================ */

async function sendDispoPanelForGuild(client, guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const cfg = getGuildConfig(guild.id) || {};
  const dispoMessages = cfg.dispoMessages || {};
  const dispoChannelId = cfg.mainDispoChannelId;
  const panelChannelId = cfg.panelChannelId;

  if (!isValidId(dispoChannelId) || !isValidId(panelChannelId)) return;

  const panelChannel = await guild.channels.fetch(panelChannelId).catch(() => null);
  if (!panelChannel || !panelChannel.isTextBased()) return;

  const makeUrl = (jourKey) => {
    const msgId = dispoMessages[jourKey];
    if (!isValidId(msgId)) return null;
    return `https://discord.com/channels/${guild.id}/${dispoChannelId}/${msgId}`;
  };

  const urls = {
    lundi: makeUrl('lundi'),
    mardi: makeUrl('mardi'),
    mercredi: makeUrl('mercredi'),
    jeudi: makeUrl('jeudi'),
    vendredi: makeUrl('vendredi'),
    samedi: makeUrl('samedi'),
    dimanche: makeUrl('dimanche')
  };

  if (!Object.values(urls).some(Boolean)) return;

  const rows = [];

  const row1 = new ActionRowBuilder();
  if (urls.lundi) row1.addComponents(new ButtonBuilder().setLabel('LUNDI').setStyle(ButtonStyle.Link).setURL(urls.lundi));
  if (urls.mardi) row1.addComponents(new ButtonBuilder().setLabel('MARDI').setStyle(ButtonStyle.Link).setURL(urls.mardi));
  if (row1.components.length) rows.push(row1);

  const row2 = new ActionRowBuilder();
  if (urls.mercredi) row2.addComponents(new ButtonBuilder().setLabel('MERCREDI').setStyle(ButtonStyle.Link).setURL(urls.mercredi));
  if (urls.jeudi) row2.addComponents(new ButtonBuilder().setLabel('JEUDI').setStyle(ButtonStyle.Link).setURL(urls.jeudi));
  if (row2.components.length) rows.push(row2);

  const row3 = new ActionRowBuilder();
  if (urls.vendredi) row3.addComponents(new ButtonBuilder().setLabel('VENDREDI').setStyle(ButtonStyle.Link).setURL(urls.vendredi));
  if (urls.samedi) row3.addComponents(new ButtonBuilder().setLabel('SAMEDI').setStyle(ButtonStyle.Link).setURL(urls.samedi));
  if (row3.components.length) rows.push(row3);

  const row4 = new ActionRowBuilder();
  if (urls.dimanche) row4.addComponents(new ButtonBuilder().setLabel('DIMANCHE').setStyle(ButtonStyle.Link).setURL(urls.dimanche));
  if (row4.components.length) rows.push(row4);

  const content = [
    '⚠️ **Confirmez vos disponibilités immédiatement.** Réagissez avec ✅ ou ❌.',
    '🎯 **Aucune excuse.** Chaque réponse est obligatoire.',
    '',
    '@everyone'
  ].join('\n');

  await panelChannel.send({
    content,
    components: rows,
    allowedMentions: { parse: ['everyone'] }
  });

  console.log(`📌 [AUTO] Panneau dispos envoyé: ${getClubName(cfg, guild)} (${guild.id})`);
}

/* ============================================================
   DISPOS : 12h rappel / 12h&17h rapports / 17h fermeture
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
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const { nonRepondus, messageURL, dispoChannel } = data;

  const absentsArr = [...nonRepondus.values()];
  const ids = absentsArr.map(m => m.id);

  if (!ids.length) {
    await dispoChannel.send({ content: `✅ Tout le monde a réagi pour **${jour.toUpperCase()}** !`, allowedMentions: { parse: [] } });
    return;
  }

  const header = [
    `📣 **Rappel aux absents (${jour.toUpperCase()})**`,
    'Merci de réagir aux disponibilités du jour ✅❌',
    `➡️ [Accéder au message du jour](${messageURL})`
  ].join('\n');

  const batches = splitByMessageLimit(ids, header + '\n\n');

  const first = batches.shift();
  if (first?.length) {
    await dispoChannel.send({
      content: `${header}\n\n${first.map(id => `<@${id}>`).join(' - ')}`,
      allowedMentions: AUTOMATION.mentionInReminder ? { users: first, parse: [] } : { parse: [] }
    });
  }

  for (const batch of batches) {
    await dispoChannel.send({
      content: batch.map(id => `<@${id}>`).join(' - '),
      allowedMentions: AUTOMATION.mentionInReminder ? { users: batch, parse: [] } : { parse: [] }
    });
  }
}

async function sendDetailedReportForGuild(client, guildId, jour, hourLabel) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const { cfg, presentsAll, absentsAll, nonRepondus, rowBtn } = data;

  const reportChannelId = cfg.rapportChannelId;
  if (!isValidId(reportChannelId)) return;

  const reportChannel = await guild.channels.fetch(reportChannelId).catch(() => null);
  if (!reportChannel || !reportChannel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(getEmbedColorFromConfig(guild.id))
    .setTitle(`📅 RAPPORT - ${jour.toUpperCase()} (${hourLabel})`)
    .addFields(
      { name: `✅ Présents (${presentsAll.size})`, value: idsLine(presentsAll) },
      { name: `❌ Ont dit absent (${absentsAll.size})`, value: idsLine(absentsAll) },
      { name: `⏳ N’ont pas réagi (${nonRepondus.size})`, value: idsLine(nonRepondus) }
    )
    .setFooter({ text: `${getClubName(cfg, guild)} ⚫ Rapport automatisé` })
    .setTimestamp();

  await reportChannel.send({
    embeds: [embed],
    components: [rowBtn],
    allowedMentions: AUTOMATION.mentionInReports ? { parse: ['users'] } : { parse: [] }
  });
}

async function closeDisposAt17ForGuild(client, guildId, jour, isoDate) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const { cfg, dispoChannel, message, reacted, yes, no, eligibles, messageURL } = data;

  const clubName = getClubName(cfg, guild);
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
      messageId: message.id,
      channelId: dispoChannel.id,
      reacted: [...reacted],
      presents: [...yes],
      absents: [...no],
      eligibles: [...eligibles.keys()]
    };
    const snapPath = path.join(SNAPSHOT_DIR, `dispos-${jour}-${isoDate}.json`);
    fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ [AUTO] snapshot dispo 17h:', e);
  }

  // Lock embed
  try {
    const exist = message.embeds?.[0];
    if (exist) {
      const e = EmbedBuilder.from(exist);
      const desc = sanitize(exist.description || '');
      const lockLine = '🔒 **Disponibilités fermées** – merci de ne plus réagir.';
      if (!desc.includes('Disponibilités fermées')) {
        e.setDescription([desc, '', lockLine].filter(Boolean).join('\n'));
        e.setFooter({ text: `${clubName} ⚫ Disponibilités (fermées)` });
        e.setColor(color);
        await message.edit({ content: '', embeds: [e] });
      }
    }
  } catch {}

  if (AUTOMATION.clearReactionsAt17) {
    try { await message.reactions.removeAll(); } catch {}
  }

  if (AUTOMATION.sendCloseMessageAt17) {
    try {
      await dispoChannel.send({
        content: sanitize(
          [
            `🔒 **Les disponibilités pour ${jour.toUpperCase()} sont désormais fermées.**`,
            'Merci de votre compréhension.',
            '',
            `➡️ [Voir le message du jour](${messageURL})`
          ].join('\n')
        ),
        allowedMentions: { parse: [] }
      });
    } catch {}
  }
}

/* ============================================================
   COMPO 100% CONFIG
============================================================ */

function getCompoConfig(cfg) {
  const c = cfg?.compo || {};
  return {
    channelId: c.channelId,
    detectMode: c.detectMode || 'footer_or_reaction',
    footerContains: c.footerContains || 'Compo officielle',
    reactionEmoji: c.reactionEmoji || '✅'
  };
}

async function getCompoContextForGuild(client, guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  const cfg = getGuildConfig(guild.id) || {};
  const rolesCfg = cfg.roles || {};
  const convoqueRoleId = rolesCfg.convoque;

  const compoCfg = getCompoConfig(cfg);
  if (!isValidId(convoqueRoleId)) return null;
  if (!isValidId(compoCfg.channelId)) return null;

  const compoChannel = await guild.channels.fetch(compoCfg.channelId).catch(() => null);
  if (!compoChannel || !compoChannel.isTextBased()) return null;

  const botId = client.user.id;

  let compoMessage = null;
  try {
    const fetched = await compoChannel.messages.fetch({ limit: 50 });

    const byFooter = fetched.find(msg =>
      msg.author.id === botId &&
      msg.embeds?.[0]?.footer?.text?.includes(compoCfg.footerContains)
    );

    const byReaction = fetched.find(msg =>
      msg.author.id === botId &&
      msg.reactions?.cache?.some(r => r.emoji?.name === compoCfg.reactionEmoji)
    );

    if (compoCfg.detectMode === 'footer_only') compoMessage = byFooter || null;
    else if (compoCfg.detectMode === 'reaction_only') compoMessage = byReaction || null;
    else compoMessage = byFooter || byReaction || null;

    if (!compoMessage) return null;
  } catch {
    return null;
  }

  await guild.members.fetch().catch(() => {});

  const convoques = guild.members.cache.filter(
    m => !m.user.bot && m.roles.cache.has(convoqueRoleId)
  );
  if (!convoques.size) return null;

  const validesSet = new Set();
  for (const [, reaction] of compoMessage.reactions.cache) {
    if (reaction.emoji?.name !== compoCfg.reactionEmoji) continue;
    const users = await reaction.users.fetch().catch(() => null);
    if (!users) continue;
    users.forEach(u => { if (!u.bot) validesSet.add(u.id); });
  }

  const valides = [];
  const nonValides = [];

  for (const m of convoques.values()) {
    if (validesSet.has(m.id)) valides.push(m);
    else nonValides.push(m);
  }

  return { guild, cfg, compoCfg, compoChannel, compoMessage, convoques, valides, nonValides };
}

async function autoVerifierCompoReminderForGuild(client, guildId, label = '') {
  const ctx = await getCompoContextForGuild(client, guildId);
  if (!ctx) return;

  const { guild, cfg, compoChannel, compoMessage, convoques, valides, nonValides } = ctx;

  const color = getEmbedColorFromConfig(guild.id);
  const clubLabel = getClubName(cfg, guild);
  const url = `https://discord.com/channels/${guild.id}/${compoChannel.id}/${compoMessage.id}`;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('📋 Vérification de la composition (rappel)')
    .setDescription(
      [
        `📨 Message : [Lien vers la compo](${url})`,
        `👥 Convoqués : **${convoques.size}**`,
        `✅ Validé : **${valides.length}**`,
        `⏳ Non validé : **${nonValides.length}**`,
        `🕒 Rappel automatique : **${label || 'auto'}**`
      ].join('\n')
    )
    .addFields(
      { name: '✅ Validé', value: idsLine(valides).slice(0, 1024) },
      { name: '⏳ Non validé', value: idsLine(nonValides).slice(0, 1024) }
    )
    .setFooter({ text: `${clubLabel} • Vérification compo (rappel ${label || ''})` })
    .setTimestamp();

  const ids = nonValides.map(m => m.id);

  await compoChannel.send({
    content: ids.length ? ids.map(id => `<@${id}>`).join(' - ') : '✅ Tous les convoqués ont validé la compo.',
    embeds: [embed],
    allowedMentions: ids.length ? { users: ids, parse: [] } : { parse: [] }
  });
}

async function autoVerifierCompoFinalForGuild(client, guildId, label = '20h') {
  const { isoDate } = getParisParts();
  const ctx = await getCompoContextForGuild(client, guildId);
  if (!ctx) return;

  const { guild, cfg, compoChannel, compoMessage, convoques, valides, nonValides } = ctx;

  const color = getEmbedColorFromConfig(guild.id);
  const clubLabel = getClubName(cfg, guild);
  const url = `https://discord.com/channels/${guild.id}/${compoChannel.id}/${compoMessage.id}`;

  // Snapshot final compo
  try {
    if (!fs.existsSync(RAPPORTS_DIR)) fs.mkdirSync(RAPPORTS_DIR, { recursive: true });

    const snap = {
      type: 'compo',
      guildId: guild.id,
      clubName: clubLabel,
      date: isoDate,
      channelId: compoChannel.id,
      messageId: compoMessage.id,
      convoques: [...convoques.values()].map(m => m.id),
      valides: valides.map(m => m.id),
      non_valides: nonValides.map(m => m.id)
    };

    const filePath = path.join(RAPPORTS_DIR, `compo-${isoDate}-${compoMessage.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(snap, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ [AUTO COMPO] snapshot final:', e);
  }

  // Clear reactions
  try { await compoMessage.reactions.removeAll(); } catch {}

  // Rapport final (dans rapportChannelId) SANS mentions
  const embedFinal = new EmbedBuilder()
    .setColor(color)
    .setTitle('📋 Vérification finale de la composition')
    .setDescription(
      [
        `📨 Message : [Lien vers la compo](${url})`,
        `👥 Convoqués : **${convoques.size}**`,
        `✅ Validé : **${valides.length}**`,
        `⏳ Non validé : **${nonValides.length}**`,
        `💾 Snapshot final enregistré dans \`/rapports\`.`,
        `🕒 Rapport final automatique : **${label}**`
      ].join('\n')
    )
    .addFields(
      { name: '✅ Validé', value: idsLine(valides).slice(0, 1024) },
      { name: '⏳ Non validé', value: idsLine(nonValides).slice(0, 1024) }
    )
    .setFooter({ text: `${clubLabel} • Vérification compo (finale ${label})` })
    .setTimestamp();

  const reportChannelId = cfg.rapportChannelId;
  if (!isValidId(reportChannelId)) return;

  const reportChannel = await guild.channels.fetch(reportChannelId).catch(() => null);
  if (!reportChannel || !reportChannel.isTextBased()) return;

  await reportChannel.send({ embeds: [embedFinal], allowedMentions: { parse: [] } });
}

/* ============================================================
   COMPO SEMAINE (par snapshots) — MULTI (si compo activée)
============================================================ */

async function autoCompoWeekReportForGuild(client, guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const cfg = getGuildConfig(guild.id) || {};
  const compoCfg = getCompoConfig(cfg);
  if (!isValidId(compoCfg.channelId)) return; // compo pas activée => skip

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

  const snaps = readCompoSnapshotsInRange(fromDate, toDate)
    .filter(s => String(s.data?.guildId || '') === String(guild.id));

  if (!snaps.length) {
    const embedEmpty = new EmbedBuilder()
      .setColor(color)
      .setTitle('📅 Vérification compos (auto semaine)')
      .setDescription(`⚠️ Aucun snapshot compo sur **${debutStr} → ${finStr}**.`)
      .setFooter({ text: `${clubLabel} ⚫ Rapport compo (snapshots auto)` })
      .setTimestamp();

    await reportChannel.send({ embeds: [embedEmpty], allowedMentions: { parse: [] } });
    return;
  }

  await guild.members.fetch().catch(() => {});

  const misses = new Map();
  const convocCount = new Map();
  let used = 0;

  for (const s of snaps) {
    const data = s.data || {};
    const convoques = Array.isArray(data.convoques) ? data.convoques : null;
    const nonValid = Array.isArray(data.non_valides) ? data.non_valides : null;
    if (!convoques || !nonValid) continue;

    used++;
    const nonSet = new Set(nonValid);

    for (const id of convoques) {
      convocCount.set(id, (convocCount.get(id) || 0) + 1);
      if (nonSet.has(id)) misses.set(id, (misses.get(id) || 0) + 1);
    }
  }

  const entries = [...misses.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  const headerLines = [
    '📅 **Vérification des compositions (auto / snapshots)**',
    `Période : **${debutStr} → ${finStr}**`,
    `Snapshots pris en compte : **${used}**`
  ];

  if (!entries.length) {
    const embedOK = new EmbedBuilder()
      .setColor(color)
      .setTitle('✅ Aucun convoqué avec compo non validée sur la période (auto)')
      .setDescription(headerLines.join('\n'))
      .setFooter({ text: `${clubLabel} ⚫ Rapport compo (snapshots auto)` })
      .setTimestamp();

    await reportChannel.send({ embeds: [embedOK], allowedMentions: { parse: [] } });
    return;
  }

  const asLine = (id, count) => {
    const member = guild.members.cache.get(id);
    const totalConv = convocCount.get(id) || count;
    return member
      ? `<@${id}> — **${count}** compo non validée(s) sur **${totalConv}** convocation(s)`
      : `\`${id}\` *(hors serveur)* — **${count}** / **${totalConv}**`;
  };

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⏳ Convoqués n’ayant pas validé (auto, total ${entries.length})`)
    .setDescription(headerLines.join('\n'))
    .addFields({
      name: 'Liste',
      value: entries.slice(0, 20).map(([id, n]) => `• ${asLine(id, n)}`).join('\n').slice(0, 1024)
    })
    .setFooter({ text: `${clubLabel} ⚫ Rapport compo (snapshots auto)` })
    .setTimestamp();

  await reportChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

/* ============================================================
   DISPO SEMAINE (snapshots 17h) — MULTI
============================================================ */

async function autoWeekDispoReportForGuild(client, guildId) {
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
  const daysCount = new Map();
  let used = 0;
  let skipped = 0;

  for (const s of snaps) {
    const data = s.data || {};
    const reacted = new Set(Array.isArray(data.reacted) ? data.reacted : []);
    const eligibles = Array.isArray(data.eligibles) ? data.eligibles : null;
    if (!eligibles?.length) { skipped++; continue; }

    used++;
    for (const id of eligibles) {
      daysCount.set(id, (daysCount.get(id) || 0) + 1);
      if (!reacted.has(id)) misses.set(id, (misses.get(id) || 0) + 1);
    }
  }

  const entries = [...misses.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

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
   SYNC PSEUDOS (config nickname.*) — MULTI (si configuré)
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

function buildNickname(member, tagFromConfig, hierarchyRoles, teamRoles, posteRoles) {
  const tag = tagFromConfig || 'XIG';
  const hierarchy = getHierarchy(member, hierarchyRoles);
  const team = getTeam(member, teamRoles);
  const postes = getPostes(member, posteRoles);

  const pseudoBase = cleanPseudo(member.user.username, MAX_LEN);
  let base = `${tag}${hierarchy ? ' ' + hierarchy : ''} ${pseudoBase}`.trim();

  const suffixParts = [];
  if (postes.length) suffixParts.push(postes.join('/'));
  if (team) suffixParts.push(team);

  let full = base;
  if (suffixParts.length) full += ' | ' + suffixParts.join(' | ');

  if (full.length > MAX_LEN) {
    const fixedPrefix = `${tag}${hierarchy ? ' ' + hierarchy : ''}`.trim();
    const suffix = suffixParts.length ? ' | ' + suffixParts.join(' | ') : '';
    const roomForPseudo = Math.max(3, MAX_LEN - (fixedPrefix.length ? fixedPrefix.length + 1 : 0) - suffix.length);
    const trimmedPseudo = cleanPseudo(member.user.username, roomForPseudo);
    full = fixedPrefix.length ? `${fixedPrefix} ${trimmedPseudo}${suffix}` : `${trimmedPseudo}${suffix}`;
  }

  return full.slice(0, MAX_LEN);
}

async function autoSyncNicknamesForGuild(client, guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const me = guild.members.me;
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageNicknames)) return;

  const cfg = getGuildConfig(guild.id) || {};
  const tag = cfg.tag || 'XIG';

  const nicknameCfg = cfg.nickname || {};
  const hierarchyRoles = Array.isArray(nicknameCfg.hierarchy) ? nicknameCfg.hierarchy : [];
  const teamRoles = Array.isArray(nicknameCfg.teams) ? nicknameCfg.teams : [];
  const posteRoles = Array.isArray(nicknameCfg.postes) ? nicknameCfg.postes : [];

  if (!hierarchyRoles.length && !teamRoles.length && !posteRoles.length) return;

  await guild.members.fetch().catch(() => {});
  const members = guild.members.cache.filter(m => !m.user.bot);

  for (const member of members.values()) {
    const newNick = buildNickname(member, tag, hierarchyRoles, teamRoles, posteRoles);
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
   INIT SCHEDULER — ANTI BUG 22H (anti-overlap + décalage)
============================================================ */

function inWindow(minute, start, end) {
  return minute >= start && minute <= end;
}

function initScheduler(client) {
  console.log('⏰ Scheduler auto: 10h/12h/17h/18h/19h/19h30/20h/22h + sync pseudos…');

  const last = {
    panel: null,
    noon: null,
    close17: null,
    nick: null,
    compo18: null,
    compo19: null,
    compo1930: null,
    compo20: null,
    week: null
  };

  let tickRunning = false;

  setInterval(async () => {
    if (tickRunning) return;
    tickRunning = true;

    try {
      const { hour, minute, isoDate: dateKey, jour } = getParisParts();
      if (!getEligibleDayKey(jour)) return;

      const guildIds = getAllGuildIds(client);

      // 10h & 22h → panneau (0-1)
      if ((hour === 10 || hour === 22) && inWindow(minute, 0, 1)) {
        const key = `${dateKey}-${hour}`;
        if (last.panel !== key) {
          last.panel = key;
          for (const gid of guildIds) {
            try { await sendDispoPanelForGuild(client, gid); } catch (e) {
              console.error(`❌ [AUTO] panneau (${gid})`, e);
            }
          }
        }
      }

      // 12h → rappel + rapport (0-2)
      if (hour === 12 && inWindow(minute, 0, 2)) {
        const key = `${dateKey}-12`;
        if (last.noon !== key) {
          last.noon = key;
          for (const gid of guildIds) {
            try { await runNoonReminderForGuild(client, gid, jour); } catch (e) {
              console.error(`❌ [AUTO] rappel 12h (${gid})`, e);
            }
            try { await sendDetailedReportForGuild(client, gid, jour, '12h'); } catch (e) {
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
            try { await sendDetailedReportForGuild(client, gid, jour, '17h'); } catch (e) {
              console.error(`❌ [AUTO] rapport 17h (${gid})`, e);
            }
            try { await closeDisposAt17ForGuild(client, gid, jour, dateKey); } catch (e) {
              console.error(`❌ [AUTO] close 17h (${gid})`, e);
            }
          }
        }
      }

      // 18h/19h/19h30/20h → compo (multi, si compo.channelId configuré)
      if (hour === 18 && inWindow(minute, 0, 2)) {
        const key = `${dateKey}-18-compo`;
        if (last.compo18 !== key) {
          last.compo18 = key;
          for (const gid of guildIds) {
            try { await autoVerifierCompoReminderForGuild(client, gid, '18h'); } catch (e) {
              console.error(`❌ [AUTO] compo 18h (${gid})`, e);
            }
          }
        }
      }

      if (hour === 19 && inWindow(minute, 0, 2)) {
        const key = `${dateKey}-19-compo`;
        if (last.compo19 !== key) {
          last.compo19 = key;
          for (const gid of guildIds) {
            try { await autoVerifierCompoReminderForGuild(client, gid, '19h'); } catch (e) {
              console.error(`❌ [AUTO] compo 19h (${gid})`, e);
            }
          }
        }
      }

      if (hour === 19 && inWindow(minute, 30, 32)) {
        const key = `${dateKey}-1930-compo`;
        if (last.compo1930 !== key) {
          last.compo1930 = key;
          for (const gid of guildIds) {
            try { await autoVerifierCompoReminderForGuild(client, gid, '19h30'); } catch (e) {
              console.error(`❌ [AUTO] compo 19h30 (${gid})`, e);
            }
          }
        }
      }

      if (hour === 20 && inWindow(minute, 0, 2)) {
        const key = `${dateKey}-20-compo`;
        if (last.compo20 !== key) {
          last.compo20 = key;
          for (const gid of guildIds) {
            try { await autoVerifierCompoFinalForGuild(client, gid, '20h'); } catch (e) {
              console.error(`❌ [AUTO] compo 20h (${gid})`, e);
            }
          }
        }
      }

      // 22h → semaine (MER/DIM) décalé (22:04-22:06)
      if (hour === 22 && inWindow(minute, 4, 6)) {
        const key = `${dateKey}-22-week`;
        if (last.week !== key) {
          last.week = key;

          if (jour === 'mercredi' || jour === 'dimanche') {
            for (const gid of guildIds) {
              try { await autoCompoWeekReportForGuild(client, gid); } catch (e) {
                console.error(`❌ [AUTO] compo week (${gid})`, e);
              }
              try { await autoWeekDispoReportForGuild(client, gid); } catch (e) {
                console.error(`❌ [AUTO] dispo week (${gid})`, e);
              }
            }
          }
        }
      }

      // Sync pseudos (multi) — toutes les heures à H:10
      if (minute === 10) {
        const key = `${dateKey}-${hour}`;
        if (last.nick !== key) {
          last.nick = key;
          for (const gid of guildIds) {
            try { await autoSyncNicknamesForGuild(client, gid); } catch (e) {
              console.error(`❌ [AUTO] sync pseudos (${gid})`, e);
            }
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

  // tests / exports
  sendDispoPanelForGuild,
  runNoonReminderForGuild,
  sendDetailedReportForGuild,
  closeDisposAt17ForGuild,

  // nicknames
  autoSyncNicknamesForGuild,

  // compo
  autoVerifierCompoReminderForGuild,
  autoVerifierCompoFinalForGuild,
  autoCompoWeekReportForGuild,

  // dispo week
  autoWeekDispoReportForGuild
};
