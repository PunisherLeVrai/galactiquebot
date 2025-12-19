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
const { SNAPSHOT_DIR } = require('./paths'); // 📁 snapshots persistants

const DEFAULT_COLOR = 0xff4db8;

// IDs fixes : uniquement le serveur INTER GALACTIQUE
const IG_GUILD_ID = '1392639720491581551';

// 📁 Dossier des snapshots /rapports (compos)
const RAPPORTS_DIR = path.join(__dirname, '../rapports');

// 🔧 Channels fixes pour IG
const COMPO_CHANNEL_ID = '1393774911557861407';      // Salon compositions
const RAPPORT_CHANNEL_ID_IG = '1446471718943326259'; // Salon rapports détaillés

// ⚙️ Options d’automatisation pour IG
const IG_AUTOMATION = {
  timezone: 'Europe/Paris',
  mentionInReminder: true,
  mentionInReports: false,
  clearReactionsAt17: true,
  sendCloseMessageAt17: true
};

// --- Utils de couleur et de texte ---
function getEmbedColorFromConfig(guildId) {
  const cfg = getGuildConfig(guildId) || {};
  const hex = cfg.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

// Anti-mentions
const sanitize = (t) =>
  String(t || '').replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]');

/**
 * Récupère la date/heure de Paris de manière fiable.
 * Retourne : { year, month, day, hour, minute, isoDate, jour }
 */
function getParisParts() {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: IG_AUTOMATION.timezone || 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    hour12: false,
    hourCycle: 'h23' // évite le "24" possible dans certains contextes
  });

  const parts = fmt.formatToParts(new Date());
  const get = (type) => parts.find(p => p.type === type)?.value;

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));

  // 👇 sécurité si Intl renvoie "24"
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;

  const minute = Number(get('minute'));
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

// Format liste de mentions sur une ligne
function idsLine(colOrArray) {
  const arr = Array.isArray(colOrArray)
    ? colOrArray
    : [...colOrArray.values()];
  if (!arr.length) return '_Aucun_';

  // Si ce sont des GuildMember
  if (arr[0] && arr[0].id && arr[0].user) {
    return arr
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map(m => `<@${m.id}>`)
      .join(' - ');
  }

  // Si ce sont des IDs
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

/* --------------------- Lecture snapshots COMPO (/rapports) ----------------------- */

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
    } catch {
      // ignore
    }
  }

  snaps.sort((a, b) => a.date - b.date);
  return snaps;
}

/* --------------------- Lecture snapshots DISPOS (SNAPSHOT_DIR) ------------------- */

const DISPO_SNAP_REGEX = /^dispos-(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)-(\d{4}-\d{2}-\d{2})\.json$/i;

function readDispoSnapshotsInRange(fromDate, toDate) {
  const snaps = [];
  if (!fs.existsSync(SNAPSHOT_DIR)) return snaps;

  const files = fs.readdirSync(SNAPSHOT_DIR)
    .filter(f => DISPO_SNAP_REGEX.test(f));

  for (const f of files) {
    const m = DISPO_SNAP_REGEX.exec(f);
    if (!m) continue;
    const fileDate = parseISODate(m[2]);
    if (!fileDate) continue;

    if (fileDate >= fromDate && fileDate <= toDate) {
      try {
        const js = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8'));
        snaps.push({ file: f, date: fileDate, data: js });
      } catch {
        // ignore
      }
    }
  }

  snaps.sort((a, b) => a.date - b.date);
  return snaps;
}

// Récupère toutes les infos de disponibilités du jour
async function fetchDispoDataForDay(guild, jour) {
  const cfg = getGuildConfig(guild.id) || {};
  const dispoMessages = cfg.dispoMessages || {};
  const dispoMessageId = dispoMessages[jour];
  const dispoChannelId = cfg.mainDispoChannelId;
  const rolesCfg = cfg.roles || {};

  if (!dispoChannelId || !dispoMessageId) {
    console.warn(
      `⚠️ [AUTO] Salon ou message dispo manquant pour ${jour} sur ${guild.id}`
    );
    return null;
  }

  const roleJoueurId = rolesCfg.joueur || null;
  const roleEssaiId = rolesCfg.essai || null;

  if (!roleJoueurId && !roleEssaiId) {
    console.warn(`⚠️ [AUTO] Aucun rôle joueur/essai configuré pour ${guild.id}`);
    return null;
  }

  const dispoChannel = await guild.channels
    .fetch(dispoChannelId)
    .catch(() => null);
  if (!dispoChannel) {
    console.warn(`⚠️ [AUTO] Salon dispo introuvable ${dispoChannelId}`);
    return null;
  }

  let message;
  try {
    message = await dispoChannel.messages.fetch(dispoMessageId);
  } catch {
    console.warn(
      `⚠️ [AUTO] Message de dispo introuvable ${dispoMessageId} dans ${dispoChannelId}`
    );
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

  const presentsAll = guild.members.cache.filter(
    m => !m.user.bot && yes.has(m.id)
  );
  const absentsAll = guild.members.cache.filter(
    m => !m.user.bot && no.has(m.id)
  );

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
   PANNEAU DE DISPONIBILITÉS (10h & 22h)
============================================================ */

async function sendDispoPanelIG(client) {
  const guild = client.guilds.cache.get(IG_GUILD_ID);
  if (!guild) return;

  const cfg = getGuildConfig(guild.id) || {};
  const dispoMessages = cfg.dispoMessages || {};
  const dispoChannelId = cfg.mainDispoChannelId;
  const panelChannelId = cfg.panelChannelId;

  if (!dispoChannelId) {
    console.warn('⚠️ [AUTO] mainDispoChannelId manquant pour IG');
    return;
  }
  if (!panelChannelId) {
    console.warn('⚠️ [AUTO] panelChannelId manquant pour IG');
    return;
  }

  const panelChannel = await guild.channels
    .fetch(panelChannelId)
    .catch(() => null);
  if (!panelChannel) {
    console.warn('⚠️ [AUTO] Salon panneau de dispos introuvable');
    return;
  }

  const makeUrl = (jourKey) => {
    const msgId = dispoMessages[jourKey];
    if (!msgId) return null;
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

  if (!Object.values(urls).some(Boolean)) {
    console.warn('⚠️ [AUTO] Aucun message de dispo configuré pour le panneau');
    return;
  }

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
    '🎯 **Aucune excuse.** Chaque réponse est obligatoire pour l’organisation de l’équipe.',
    'Merci de respecter les consignes.',
    '',
    '@everyone'
  ].join('\n');

  await panelChannel.send({
    content,
    components: rows,
    allowedMentions: { parse: ['everyone'] }
  });

  console.log('📌 [AUTO] Panneau de disponibilités envoyé (IG).');
}

/* ============================================================
   RAPPEL 12h — même comportement que /disponibilites mode "rappel_absents"
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

async function runNoonReminderIG(client) {
  const { jour } = getParisParts();
  const guild = client.guilds.cache.get(IG_GUILD_ID);
  if (!guild) return;

  if (!['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].includes(jour)) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const { cfg, nonRepondus, messageURL, dispoChannel } = data;

  // Rappel envoyé dans le salon des disponibilités (mainDispoChannelId)
  const channel = dispoChannel;
  if (!channel) {
    console.warn('⚠️ [AUTO] Salon de rappel 12h introuvable (mainDispoChannelId)');
    return;
  }

  const absentsArr = [...nonRepondus.values()];
  const ids = absentsArr.map(m => m.id);

  if (absentsArr.length === 0) {
    await channel.send({
      content: `✅ Tout le monde a réagi pour **${jour.toUpperCase()}** !`,
      allowedMentions: { parse: [] }
    });
    console.log(`📣 [AUTO] Rappel 12h : aucun absent (${jour})`);
    return;
  }

  const header = [
    `📣 **Rappel aux absents (${jour.toUpperCase()})**`,
    'Merci de réagir aux disponibilités du jour ✅❌',
    `➡️ ${dispoChannel} — [Accéder au message du jour](${messageURL})`
  ].join('\n');

  const batches = splitByMessageLimit(ids, header + '\n\n');

  try {
    const first = batches.shift();
    if (first && first.length) {
      await channel.send({
        content: `${header}\n\n${first.map(id => `<@${id}>`).join(' - ')}`,
        allowedMentions: IG_AUTOMATION.mentionInReminder
          ? { users: first, parse: [] }
          : { parse: [] }
      });
    }

    for (const batch of batches) {
      await channel.send({
        content: batch.map(id => `<@${id}>`).join(' - '),
        allowedMentions: IG_AUTOMATION.mentionInReminder
          ? { users: batch, parse: [] }
          : { parse: [] }
      });
    }
  } catch (e) {
    console.error('❌ [AUTO] Erreur envoi rappel 12h :', e);
  }

  console.log(`📣 [AUTO] Rappel 12h envoyé pour ${jour} (IG) — ${ids.length} absents.`);
}

/* ============================================================
   RAPPORTS 12h & 17h
============================================================ */

async function sendDetailedReportIG(client, hourLabel) {
  const { jour } = getParisParts();
  const guild = client.guilds.cache.get(IG_GUILD_ID);
  if (!guild) return;

  if (!['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].includes(jour)) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const { cfg, presentsAll, absentsAll, nonRepondus, rowBtn } = data;

  const color = getEmbedColorFromConfig(guild.id);
  const clubName = cfg.clubName || guild.name || 'INTER GALACTIQUE';

  const reportChannelId = cfg.rapportChannelId || RAPPORT_CHANNEL_ID_IG;
  if (!reportChannelId || reportChannelId === '0') {
    console.warn('⚠️ [AUTO] rapportChannelId manquant pour IG');
    return;
  }

  const reportChannel = await guild.channels.fetch(reportChannelId).catch(() => null);
  if (!reportChannel) {
    console.warn('⚠️ [AUTO] Salon de rapport introuvable');
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`📅 RAPPORT - ${jour.toUpperCase()}`)
    .addFields(
      { name: `✅ Présents (${presentsAll.size})`, value: idsLine(presentsAll) },
      { name: `❌ Ont dit absent (${absentsAll.size})`, value: idsLine(absentsAll) },
      { name: `⏳ N’ont pas réagi (${nonRepondus.size})`, value: idsLine(nonRepondus) }
    )
    .setFooter({ text: `${clubName} ⚫ Rapport automatisé` })
    .setTimestamp();

  await reportChannel.send({
    embeds: [embed],
    components: [rowBtn],
    allowedMentions: IG_AUTOMATION.mentionInReports ? { parse: ['users'] } : { parse: [] }
  });

  console.log(`📊 [AUTO] Rapport ${hourLabel} envoyé pour ${jour} (IG).`);
}

/* ============================================================
   FERMETURE 17h (snapshot + verrouillage)
============================================================ */

async function closeDisposAt17IG(client) {
  const { jour, isoDate } = getParisParts();
  const guild = client.guilds.cache.get(IG_GUILD_ID);
  if (!guild) return;

  if (!['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].includes(jour)) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const { cfg, dispoChannel, message, reacted, yes, no, eligibles, messageURL } = data;

  const clubName = cfg.clubName || guild.name || 'INTER GALACTIQUE';
  const color = getEmbedColorFromConfig(guild.id);

  // 1) Snapshot JSON (dans SNAPSHOT_DIR persistant)
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

    const snapshot = {
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
    console.log(`💾 [AUTO] Snapshot sauvegardé ${snapPath}`);
  } catch (e) {
    console.error('❌ [AUTO] Erreur écriture snapshot 17h :', e);
  }

  // 2) Marquer le message comme "Disponibilités fermées"
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
  } catch (e) {
    console.error('❌ [AUTO] Erreur lors de la mise à jour de l’embed dispo :', e);
  }

  // 3) Suppression des réactions
  if (IG_AUTOMATION.clearReactionsAt17) {
    try {
      await message.reactions.removeAll();
      console.log('🧹 [AUTO] Réactions supprimées sur le message de dispo.');
    } catch (e) {
      console.error('❌ [AUTO] Impossible de supprimer les réactions :', e);
    }
  }

  // 4) Message "dispos fermées"
  if (IG_AUTOMATION.sendCloseMessageAt17) {
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
    } catch (e) {
      console.error('❌ [AUTO] Erreur envoi message "dispos fermées" :', e);
    }
  }

  console.log(`🔒 [AUTO] Dispos fermées pour ${jour} (IG).`);
}

/* ============================================================
   SYNC PSEUDOS AUTO (toutes les heures à H:10)
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

    const roomForPseudo = Math.max(
      3,
      MAX_LEN - (fixedPrefix.length ? fixedPrefix.length + 1 : 0) - suffix.length
    );

    const trimmedPseudo = cleanPseudo(member.user.username, roomForPseudo);
    full = fixedPrefix.length
      ? `${fixedPrefix} ${trimmedPseudo}${suffix}`
      : `${trimmedPseudo}${suffix}`;
  }

  return full.slice(0, MAX_LEN);
}

async function autoSyncNicknamesIG(client) {
  const guild = client.guilds.cache.get(IG_GUILD_ID);
  if (!guild) return;

  const me = guild.members.me;
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
    console.warn('⚠️ [AUTO] Pas la permission ManageNicknames pour sync pseudos.');
    return;
  }

  const cfg = getGuildConfig(guild.id) || {};
  const tag = cfg.tag || 'XIG';

  const nicknameCfg = cfg.nickname || {};
  const hierarchyRoles = Array.isArray(nicknameCfg.hierarchy) ? nicknameCfg.hierarchy : [];
  const teamRoles = Array.isArray(nicknameCfg.teams) ? nicknameCfg.teams : [];
  const posteRoles = Array.isArray(nicknameCfg.postes) ? nicknameCfg.postes : [];

  if (!hierarchyRoles.length && !teamRoles.length && !posteRoles.length) {
    console.warn('⚠️ [AUTO] Config nickname.* manquante, sync pseudos ignorée.');
    return;
  }

  await guild.members.fetch().catch(() => {});
  const members = guild.members.cache.filter(m => !m.user.bot);

  let changed = 0, blocked = 0, errors = 0;

  for (const member of members.values()) {
    const newNick = buildNickname(member, tag, hierarchyRoles, teamRoles, posteRoles);
    const current = member.nickname || member.user.username;

    if (current === newNick) continue;

    if (!member.manageable) {
      blocked++;
      continue;
    }

    try {
      await member.setNickname(newNick, 'Synchronisation pseudos XIG (auto)');
      await sleep(SLEEP_MS);
      changed++;
    } catch {
      errors++;
    }
  }

  console.log(`🧾 [AUTO] Sync pseudos : modifiés=${changed}, bloqués=${blocked}, erreurs=${errors}`);
}

/* ============================================================
   LOGIQUE COMPO — PARTAGÉE (rappels + final)
============================================================ */

async function getCompoContextIG(client) {
  const guild = client.guilds.cache.get(IG_GUILD_ID);
  if (!guild) return null;

  const cfg = getGuildConfig(guild.id) || {};
  const convoqueRoleId = cfg.roles?.convoque || null;
  if (!convoqueRoleId) {
    console.warn('⚠️ [AUTO COMPO] roles.convoque manquant dans servers.json');
    return null;
  }

  const compoChannel = await guild.channels.fetch(COMPO_CHANNEL_ID).catch(() => null);
  if (!compoChannel || !compoChannel.isTextBased()) {
    console.warn('⚠️ [AUTO COMPO] Salon composition introuvable ou non textuel');
    return null;
  }

  const botId = client.user.id;

  // Auto-détection du message de compo
  let compoMessage;
  try {
    const fetched = await compoChannel.messages.fetch({ limit: 50 });

    compoMessage = fetched.find(msg =>
      msg.author.id === botId &&
      msg.embeds?.[0]?.footer?.text?.includes('Compo officielle')
    );

    if (!compoMessage) {
      compoMessage = fetched.find(msg =>
        msg.author.id === botId &&
        msg.reactions?.cache?.some(r => r.emoji?.name === '✅')
      );
    }

    if (!compoMessage) {
      console.warn('⚠️ [AUTO COMPO] Aucun message de compo trouvé (auto-détection)');
      return null;
    }
  } catch (e) {
    console.error('❌ [AUTO COMPO] Erreur recherche auto compo :', e);
    return null;
  }

  await guild.members.fetch().catch(() => {});

  const convoques = guild.members.cache.filter(
    m => !m.user.bot && m.roles.cache.has(convoqueRoleId)
  );
  if (!convoques.size) {
    console.warn('⚠️ [AUTO COMPO] Aucun convoqué trouvé (rôle vide).');
    return null;
  }

  const validesSet = new Set();
  for (const [, reaction] of compoMessage.reactions.cache) {
    if (reaction.emoji?.name !== '✅') continue;

    const users = await reaction.users.fetch().catch(() => null);
    if (!users) continue;

    users.forEach(u => {
      if (!u.bot) validesSet.add(u.id);
    });
  }

  const valides = [];
  const nonValides = [];

  for (const m of convoques.values()) {
    if (validesSet.has(m.id)) valides.push(m);
    else nonValides.push(m);
  }

  return { guild, cfg, compoChannel, compoMessage, convoques, valides, nonValides };
}

/* ============================================================
   AUTO VERIFIER_COMPO — RAPPEL (18h / 19h / 19h30)
============================================================ */

async function autoVerifierCompoReminderIG(client, label = '') {
  const ctx = await getCompoContextIG(client);
  if (!ctx) return;

  const { guild, cfg, compoChannel, compoMessage, convoques, valides, nonValides } = ctx;

  const color = getEmbedColorFromConfig(guild.id);
  const clubLabel = cfg.clubName || guild.name || 'INTER GALACTIQUE';
  const url = `https://discord.com/channels/${guild.id}/${compoChannel.id}/${compoMessage.id}`;

  const formatMentions = (arr) =>
    arr.length ? arr.map(m => `<@${m.id}>`).join(' - ') : '_Aucun_';

  const baseDescription = [
    `📨 Message : [Lien vers la compo](${url})`,
    `👥 Convoqués : **${convoques.size}**`,
    `✅ Validé : **${valides.length}**`,
    `⏳ Non validé : **${nonValides.length}**`,
    `🕒 Rappel automatique : **${label || 'auto'}**`
  ].join('\n');

  const embedCompo = new EmbedBuilder()
    .setColor(color)
    .setTitle('📋 Vérification de la composition (rappel)')
    .setDescription(baseDescription)
    .addFields(
      { name: '✅ Validé', value: formatMentions(valides).slice(0, 1024) },
      { name: '⏳ Non validé', value: formatMentions(nonValides).slice(0, 1024) }
    )
    .setFooter({ text: `${clubLabel} • Vérification compo (rappel ${label || ''})` })
    .setTimestamp();

  const nonValidesIds = nonValides.map(m => m.id);

  try {
    await compoChannel.send({
      content: nonValidesIds.length
        ? nonValidesIds.map(id => `<@${id}>`).join(' - ')
        : '✅ Tous les convoqués ont validé la compo.',
      embeds: [embedCompo],
      allowedMentions: nonValidesIds.length
        ? { users: nonValidesIds, parse: [] }
        : { parse: [] }
    });
  } catch (e) {
    console.error('❌ [AUTO COMPO] Erreur envoi rappel compo :', e);
  }

  console.log(`📋 [AUTO COMPO] Rappel compo ${label || 'auto'} envoyé. Non validés: ${nonValidesIds.length}`);
}

/* ============================================================
   AUTO VERIFIER_COMPO — FINAL 20h
============================================================ */

async function autoVerifierCompoIG(client, label = '20h') {
  const { isoDate } = getParisParts();
  const ctx = await getCompoContextIG(client);
  if (!ctx) return;

  const { guild, cfg, compoChannel, compoMessage, convoques, valides, nonValides } = ctx;

  const color = getEmbedColorFromConfig(guild.id);
  const clubLabel = cfg.clubName || guild.name || 'INTER GALACTIQUE';
  const url = `https://discord.com/channels/${guild.id}/${compoChannel.id}/${compoMessage.id}`;

  const formatMentions = (arr) =>
    arr.length ? arr.map(m => `<@${m.id}>`).join(' - ') : '_Aucun_';

  // 1️⃣ Snapshot final UNIQUE dans /rapports
  try {
    if (!fs.existsSync(RAPPORTS_DIR)) fs.mkdirSync(RAPPORTS_DIR, { recursive: true });

    const snap = {
      type: 'compo',
      date: isoDate,
      channelId: compoChannel.id,
      messageId: compoMessage.id,
      convoques: [...convoques.values()].map(m => m.id),
      valides: valides.map(m => m.id),
      non_valides: nonValides.map(m => m.id)
    };

    const filePath = path.join(RAPPORTS_DIR, `compo-${isoDate}-${compoMessage.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(snap, null, 2), 'utf8');

    console.log(`💾 [AUTO COMPO] Snapshot final compo : ${filePath}`);
  } catch (e) {
    console.error('❌ [AUTO COMPO] Erreur snapshot compo final :', e);
  }

  // 2️⃣ Suppression des réactions sur la compo
  try {
    await compoMessage.reactions.removeAll();
    console.log('🧹 [AUTO COMPO] Réactions supprimées sur la compo.');
  } catch (e) {
    console.error('❌ [AUTO COMPO] Impossible de supprimer les réactions sur la compo :', e);
  }

  // 3️⃣ Rapport final (embed) SANS mentions → UNIQUEMENT DANS RAPPORTS AUTO
  const baseDescription = [
    `📨 Message : [Lien vers la compo](${url})`,
    `👥 Convoqués : **${convoques.size}**`,
    `✅ Validé : **${valides.length}**`,
    `⏳ Non validé : **${nonValides.length}**`,
    `💾 Snapshot final enregistré dans \`/rapports\`.`,
    `🕒 Rapport final automatique : **${label}**`
  ].join('\n');

  const embedFinal = new EmbedBuilder()
    .setColor(color)
    .setTitle('📋 Vérification finale de la composition')
    .setDescription(baseDescription)
    .addFields(
      { name: '✅ Validé', value: formatMentions(valides).slice(0, 1024) },
      { name: '⏳ Non validé', value: formatMentions(nonValides).slice(0, 1024) }
    )
    .setFooter({ text: `${clubLabel} • Vérification compo (finale ${label})` })
    .setTimestamp();

  const rapportChannelId = cfg.rapportChannelId || RAPPORT_CHANNEL_ID_IG;
  const rapportChannel = (rapportChannelId && rapportChannelId !== '0')
    ? await guild.channels.fetch(rapportChannelId).catch(() => null)
    : null;

  if (rapportChannel) {
    try {
      await rapportChannel.send({ embeds: [embedFinal], allowedMentions: { parse: [] } });
    } catch (e) {
      console.error('❌ [AUTO COMPO] Erreur envoi rapport final dans le salon rapports :', e);
    }
  } else {
    console.warn('⚠️ [AUTO COMPO] Salon rapports introuvable pour IG (final).');
  }

  console.log(`📋 [AUTO COMPO] Rapport final compo ${label} envoyé. Non validés: ${nonValides.length}`);
}

/* ============================================================
   AUTO VERIFIER_COMPO_SEMAINE (mercredi & dimanche 22h)
============================================================ */

async function autoCompoWeekReportIG(client) {
  const guild = client.guilds.cache.get(IG_GUILD_ID);
  if (!guild) return;

  const cfg = getGuildConfig(guild.id) || {};
  const color = getEmbedColorFromConfig(guild.id);
  const clubLabel = cfg.clubName || guild.name || 'INTER GALACTIQUE';
  const rapportChannelId = cfg.rapportChannelId || RAPPORT_CHANNEL_ID_IG;

  const rapportChannel = await guild.channels.fetch(rapportChannelId).catch(() => null);
  if (!rapportChannel) {
    console.warn('⚠️ [AUTO COMPO SEMAINE] Salon rapports introuvable pour IG.');
    return;
  }

  const nowParis = getParisParts();
  const defaultEnd = new Date(nowParis.year, nowParis.month - 1, nowParis.day);
  const defaultStart = addDays(defaultEnd, -6);

  const debutStr = toISO(defaultStart);
  const finStr = toISO(defaultEnd);

  const fromDate = parseISODate(debutStr);
  const toDate = parseISODate(finStr);

  const snaps = readCompoSnapshotsInRange(fromDate, toDate);
  if (snaps.length === 0) {
    const embedEmpty = new EmbedBuilder()
      .setColor(color)
      .setTitle('📅 Vérification compos (auto semaine)')
      .setDescription(`⚠️ Aucun snapshot de compo trouvé dans \`/rapports\` sur la période **${debutStr} → ${finStr}**.`)
      .setFooter({ text: `${clubLabel} ⚫ Rapport compo (snapshots auto)` })
      .setTimestamp();

    await rapportChannel.send({ embeds: [embedEmpty], allowedMentions: { parse: [] } });
    console.log('⚠️ [AUTO COMPO SEMAINE] Aucun snapshot sur la période.');
    return;
  }

  await guild.members.fetch().catch(() => {});

  const misses = new Map();      // id -> nb de compo non validées
  const convocCount = new Map(); // id -> nb de compo où il était convoqué
  let snapshotsUsed = 0;

  for (const s of snaps) {
    const data = s.data || {};
    const convoques = Array.isArray(data.convoques) ? data.convoques : null;
    const nonValid = Array.isArray(data.non_valides) ? data.non_valides : null;
    if (!convoques || !nonValid) continue;

    snapshotsUsed++;
    const nonSet = new Set(nonValid);

    for (const id of convoques) {
      if (!convocCount.has(id)) convocCount.set(id, 0);
      convocCount.set(id, convocCount.get(id) + 1);

      if (nonSet.has(id)) {
        if (!misses.has(id)) misses.set(id, 0);
        misses.set(id, misses.get(id) + 1);
      }
    }
  }

  const entries = [...misses.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const headerLines = [
    `📅 **Vérification des compositions (auto / snapshots)**`,
    `Période : **${debutStr} → ${finStr}**`,
    `Snapshots pris en compte : **${snapshotsUsed}**`,
    'Portée : **Convoqués (serveur + hors serveur via snapshots)**'
  ];

  const asLine = (id, count) => {
    const member = guild.members.cache.get(id);
    const name = member ? member.displayName : `Utilisateur ${id}`;
    const suffix = member ? '' : ' *(hors serveur)*';
    const totalConv = convocCount.get(id) || count;
    return `${member ? `<@${id}>` : `\`${name}\``}${suffix} — **${count}** compo non validée(s) sur **${totalConv}** convocation(s)`;
  };

  if (!entries.length) {
    const embedOK = new EmbedBuilder()
      .setColor(color)
      .setTitle('✅ Aucun convoqué avec compo non validée sur la période (auto)')
      .setDescription(headerLines.join('\n'))
      .setFooter({ text: `${clubLabel} ⚫ Rapport compo (snapshots auto)` })
      .setTimestamp();

    await rapportChannel.send({ embeds: [embedOK], allowedMentions: { parse: [] } });
    console.log('✅ [AUTO COMPO SEMAINE] Aucun joueur avec compo non validée.');
    return;
  }

  const pageSize = 20;
  const pages = [];
  for (let i = 0; i < entries.length; i += pageSize) pages.push(entries.slice(i, i + pageSize));

  const first = pages.shift();
  const firstEmbed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⏳ Convoqués n’ayant pas validé (auto, total ${entries.length})`)
    .setDescription(headerLines.join('\n'))
    .addFields({
      name: 'Liste',
      value: first.map(([id, n]) => `• ${asLine(id, n)}`).join('\n').slice(0, 1024)
    })
    .setFooter({ text: `${clubLabel} ⚫ Rapport compo (snapshots auto)` })
    .setTimestamp();

  await rapportChannel.send({ embeds: [firstEmbed], allowedMentions: { parse: [] } });

  for (const page of pages) {
    const chunks = [];
    let cur = [];
    let curLen = 0;

    for (const [id, n] of page) {
      const line = `• ${asLine(id, n)}\n`;
      if (curLen + line.length > 1024) {
        chunks.push(cur.join(''));
        cur = [line];
        curLen = line.length;
      } else {
        cur.push(line);
        curLen += line.length;
      }
    }
    if (cur.length) chunks.push(cur.join(''));

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle('Suite')
      .setFooter({ text: `${clubLabel} ⚫ Rapport compo (snapshots auto)` })
      .setTimestamp();

    chunks.forEach((block, idx) => {
      embed.addFields({ name: idx === 0 ? 'Liste (suite)' : '…', value: block });
    });

    await rapportChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  console.log(`📊 [AUTO COMPO SEMAINE] Rapport auto envoyé (${debutStr} → ${finStr}).`);
}

/* ============================================================
   AUTO VERIFIER_SEMAINE dispo (snapshots 17h)
============================================================ */

async function autoWeekDispoReportIG(client) {
  const guild = client.guilds.cache.get(IG_GUILD_ID);
  if (!guild) return;

  const cfg = getGuildConfig(guild.id) || {};
  const color = getEmbedColorFromConfig(guild.id);
  const clubLabel = cfg.clubName || guild.name || 'INTER GALACTIQUE';
  const rapportChannelId = cfg.rapportChannelId || RAPPORT_CHANNEL_ID_IG;

  const rapportChannel = await guild.channels.fetch(rapportChannelId).catch(() => null);
  if (!rapportChannel) {
    console.warn('⚠️ [AUTO SEMAINE DISPO] Salon rapports introuvable pour IG.');
    return;
  }

  const nowParis = getParisParts();
  const defaultEnd = new Date(nowParis.year, nowParis.month - 1, nowParis.day);
  const defaultStart = addDays(defaultEnd, -6);

  const debutStr = toISO(defaultStart);
  const finStr = toISO(defaultEnd);

  const fromDate = parseISODate(debutStr);
  const toDate = parseISODate(finStr);

  const snaps = readDispoSnapshotsInRange(fromDate, toDate);
  if (snaps.length === 0) {
    const embedEmpty = new EmbedBuilder()
      .setColor(color)
      .setTitle('📅 Analyse disponibilités (auto semaine)')
      .setDescription(`⚠️ Aucun snapshot de disponibilités trouvé dans \`${SNAPSHOT_DIR}\` pour **${debutStr} → ${finStr}**.`)
      .setFooter({ text: `${clubLabel} • Rapport snapshots auto` })
      .setTimestamp();

    await rapportChannel.send({ embeds: [embedEmpty], allowedMentions: { parse: [] } });
    console.log('⚠️ [AUTO SEMAINE DISPO] Aucun snapshot sur la période.');
    return;
  }

  await guild.members.fetch().catch(() => {});

  const misses = new Map();    // id -> nb de jours sans réaction
  const daysCount = new Map(); // id -> nb de jours éligibles
  let snapshotsUsed = 0;
  let snapshotsSkipped = 0;

  for (const s of snaps) {
    const data = s.data || {};
    const reacted = new Set(Array.isArray(data.reacted) ? data.reacted : []);
    const eligibles = Array.isArray(data.eligibles) ? data.eligibles : null;

    if (!eligibles || eligibles.length === 0) {
      snapshotsSkipped++;
      continue;
    }

    snapshotsUsed++;

    for (const id of eligibles) {
      if (!misses.has(id)) misses.set(id, 0);
      if (!daysCount.has(id)) daysCount.set(id, 0);

      daysCount.set(id, daysCount.get(id) + 1);
      if (!reacted.has(id)) misses.set(id, misses.get(id) + 1);
    }
  }

  const entries = [...misses.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const headerLines = [
    '📅 **Analyse disponibilités (Snapshots auto)**',
    `🗓️ Période : **${debutStr} → ${finStr}**`,
    `📂 Snapshots utilisés : **${snapshotsUsed}**`,
    snapshotsSkipped ? `⚠️ Ignorés : **${snapshotsSkipped}** (incomplets)` : '',
    '🌐 Portée : membres du serveur + hors serveur'
  ].filter(Boolean);

  const asLine = (id, n) => {
    const m = guild.members.cache.get(id);
    return m
      ? `<@${id}> — **${n}** jour(s) sans réaction`
      : `\`${id}\` *(hors serveur)* — **${n}** jour(s)`;
  };

  if (entries.length === 0) {
    const embedOK = new EmbedBuilder()
      .setColor(color)
      .setTitle('✅ Tous ont réagi au moins une fois (auto semaine)')
      .setDescription(headerLines.join('\n'))
      .setFooter({ text: `${clubLabel} • Rapport snapshots auto` })
      .setTimestamp();

    await rapportChannel.send({ embeds: [embedOK], allowedMentions: { parse: [] } });
    console.log('✅ [AUTO SEMAINE DISPO] Tous ont réagi au moins une fois.');
    return;
  }

  const pageSize = 20;
  const pages = [];
  for (let i = 0; i < entries.length; i += pageSize) pages.push(entries.slice(i, i + pageSize));

  const first = pages.shift();
  const firstEmbed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⏳ Membres n’ayant pas réagi (auto, total : ${entries.length})`)
    .setDescription(headerLines.join('\n'))
    .addFields({
      name: 'Liste',
      value: first.map(([id, n]) => `• ${asLine(id, n)}`).join('\n').slice(0, 1024)
    })
    .setFooter({ text: `${clubLabel} • Rapport snapshots auto` })
    .setTimestamp();

  await rapportChannel.send({ embeds: [firstEmbed], allowedMentions: { parse: [] } });

  for (const page of pages) {
    const chunks = [];
    let cur = [];
    let len = 0;

    for (const [id, n] of page) {
      const line = `• ${asLine(id, n)}\n`;
      if (len + line.length > 1024) {
        chunks.push(cur.join(''));
        cur = [line];
        len = line.length;
      } else {
        cur.push(line);
        len += line.length;
      }
    }
    if (cur.length) chunks.push(cur.join(''));

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle('Suite')
      .setFooter({ text: `${clubLabel} • Rapport snapshots auto` })
      .setTimestamp();

    chunks.forEach((c, i) => {
      embed.addFields({ name: i === 0 ? 'Liste (suite)' : '…', value: c });
    });

    await rapportChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  console.log(`📊 [AUTO SEMAINE DISPO] Rapport auto envoyé (${debutStr} → ${finStr}).`);
}

/* ============================================================
   SCHEDULER STATE (persistant) + HELPERS
============================================================ */

function ensureDir(dir) {
  if (!dir) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const STATE_PATH = path.join(SNAPSHOT_DIR || __dirname, 'scheduler-state.json');

function loadState() {
  try {
    ensureDir(path.dirname(STATE_PATH));
    if (!fs.existsSync(STATE_PATH)) return { runs: {} };
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) || { runs: {} };
  } catch {
    return { runs: {} };
  }
}

function saveState(state) {
  try {
    ensureDir(path.dirname(STATE_PATH));
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

function alreadyRanToday(state, jobKey) {
  return Boolean(state?.runs?.[jobKey]);
}

function markRanToday(state, jobKey, info = {}) {
  if (!state.runs) state.runs = {};
  state.runs[jobKey] = {
    at: new Date().toISOString(),
    ...info
  };
  saveState(state);
}

function dailyJobKey(dateKey, name) {
  return `${dateKey}:${name}`;
}

/* ============================================================
   INIT SCHEDULER
============================================================ */

let _schedulerInterval = null;
let _schedulerStarted = false;

function initScheduler(client) {
  if (_schedulerStarted) {
    console.warn('⚠️ [SCHEDULER] initScheduler() appelé plusieurs fois → ignoré.');
    return;
  }
  _schedulerStarted = true;

  console.log('⏰ Initialisation du scheduler automatique (10h / 12h / 17h / 18h / 19h / 19h30 / 20h / 22h + sync pseudos)…');

  const state = loadState();

  // fenêtre large pour éviter de louper après reboot / lag (en minutes)
  const W = 10; // exécute si minute ∈ [target, target+W]

  // heartbeat pour vérifier que le tick tourne
  let lastHeartbeat = 0;

  const tick = async () => {
    const { hour, minute, isoDate: dateKey, jour } = getParisParts();

    // Heartbeat toutes les 10 minutes
    const now = Date.now();
    if (now - lastHeartbeat > 10 * 60 * 1000) {
      lastHeartbeat = now;
      console.log(`💓 [SCHEDULER] Tick OK — Paris ${dateKey} ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`);
    }

    const inWindow = (targetMin) => minute >= targetMin && minute <= (targetMin + W);

    // 10h00 → panneau
    if (hour === 10 && inWindow(0)) {
      const key = dailyJobKey(dateKey, 'panel-10');
      if (!alreadyRanToday(state, key)) {
        console.log(`⏰ [AUTO] Panel 10h (window) pour ${dateKey}`);
        try { await sendDispoPanelIG(client); } catch (e) { console.error('❌ [AUTO] Erreur panneau 10h :', e); }
        markRanToday(state, key);
      }
    }

    // 12h00 → rappel + rapport
    if (hour === 12 && inWindow(0)) {
      const key = dailyJobKey(dateKey, 'noon-12');
      if (!alreadyRanToday(state, key)) {
        console.log(`⏰ [AUTO] 12h (window) pour ${dateKey}`);
        try {
          await runNoonReminderIG(client);
          await sendDetailedReportIG(client, '12h');
        } catch (e) {
          console.error('❌ [AUTO] Erreur 12h :', e);
        }
        markRanToday(state, key);
      }
    }

    // 17h00 → rapport + fermeture
    if (hour === 17 && inWindow(0)) {
      const key = dailyJobKey(dateKey, 'close-17');
      if (!alreadyRanToday(state, key)) {
        console.log(`⏰ [AUTO] 17h (window) pour ${dateKey}`);
        try {
          await sendDetailedReportIG(client, '17h');
          await closeDisposAt17IG(client);
        } catch (e) {
          console.error('❌ [AUTO] Erreur 17h :', e);
        }
        markRanToday(state, key);
      }
    }

    // 18h00 → rappel compo
    if (hour === 18 && inWindow(0)) {
      const key = dailyJobKey(dateKey, 'compo-18');
      if (!alreadyRanToday(state, key)) {
        console.log(`⏰ [AUTO] Compo 18h (window) pour ${dateKey}`);
        try { await autoVerifierCompoReminderIG(client, '18h'); } catch (e) { console.error('❌ [AUTO] Erreur compo 18h :', e); }
        markRanToday(state, key);
      }
    }

    // 19h00 → rappel compo
    if (hour === 19 && inWindow(0)) {
      const key = dailyJobKey(dateKey, 'compo-19');
      if (!alreadyRanToday(state, key)) {
        console.log(`⏰ [AUTO] Compo 19h (window) pour ${dateKey}`);
        try { await autoVerifierCompoReminderIG(client, '19h'); } catch (e) { console.error('❌ [AUTO] Erreur compo 19h :', e); }
        markRanToday(state, key);
      }
    }

    // 19h30 → rappel compo (fenêtre 30→30+W)
    if (hour === 19 && inWindow(30)) {
      const key = dailyJobKey(dateKey, 'compo-1930');
      if (!alreadyRanToday(state, key)) {
        console.log(`⏰ [AUTO] Compo 19h30 (window) pour ${dateKey}`);
        try { await autoVerifierCompoReminderIG(client, '19h30'); } catch (e) { console.error('❌ [AUTO] Erreur compo 19h30 :', e); }
        markRanToday(state, key);
      }
    }

    // 20h00 → final compo
    if (hour === 20 && inWindow(0)) {
      const key = dailyJobKey(dateKey, 'compo-20-final');
      if (!alreadyRanToday(state, key)) {
        console.log(`⏰ [AUTO] Compo finale 20h (window) pour ${dateKey}`);
        try { await autoVerifierCompoIG(client, '20h'); } catch (e) { console.error('❌ [AUTO] Erreur compo 20h :', e); }
        markRanToday(state, key);
      }
    }

    // 22h00 → panneau + rapports semaine (mercredi/dimanche)
    if (hour === 22 && inWindow(0)) {
      // panneau 22h
      const keyPanel = dailyJobKey(dateKey, 'panel-22');
      if (!alreadyRanToday(state, keyPanel)) {
        console.log(`⏰ [AUTO] Panel 22h (window) pour ${dateKey}`);
        try { await sendDispoPanelIG(client); } catch (e) { console.error('❌ [AUTO] Erreur panneau 22h :', e); }
        markRanToday(state, keyPanel);
      }

      // semaine mercredi/dimanche
      if (jour === 'mercredi' || jour === 'dimanche') {
        const keyWeek = dailyJobKey(dateKey, `week-${jour}`);
        if (!alreadyRanToday(state, keyWeek)) {
          console.log(`⏰ [AUTO] Rapports semaine (${jour}) 22h (window) pour ${dateKey}`);
          try {
            await autoCompoWeekReportIG(client);
            await autoWeekDispoReportIG(client);
          } catch (e) {
            console.error('❌ [AUTO] Erreur rapports semaine 22h :', e);
          }
          markRanToday(state, keyWeek, { jour });
        }
      }
    }

    // 🔁 Sync pseudos : toutes les heures à H:10 (fenêtre 10→10+W)
    if (inWindow(10)) {
      const key = dailyJobKey(dateKey, `nick-${hour}`);
      if (!alreadyRanToday(state, key)) {
        console.log(`⏰ [AUTO] Sync pseudos ${hour}h10 (window) pour ${dateKey}`);
        try { await autoSyncNicknamesIG(client); } catch (e) { console.error('❌ [AUTO] Erreur sync pseudos :', e); }
        markRanToday(state, key, { hour });
      }
    }
  };

  // tick immédiat + interval
  tick().catch(() => {});
  _schedulerInterval = setInterval(() => tick().catch(() => {}), 60 * 1000);
}

module.exports = {
  initScheduler,
  // exports pour tests / commandes
  sendDispoPanelIG,
  runNoonReminderIG,
  sendDetailedReportIG,
  closeDisposAt17IG,
  autoSyncNicknamesIG,
  autoVerifierCompoIG,
  autoVerifierCompoReminderIG,
  autoCompoWeekReportIG,
  autoWeekDispoReportIG
};
