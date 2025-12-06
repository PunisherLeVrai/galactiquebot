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

const RAPPORTS_DIR = path.join(__dirname, '../rapports');
const DEFAULT_COLOR = 0xff4db8;

// IDs fixes pour INTER GALACTIQUE
const IG_GUILD_ID = '1392639720491581551';
const IG_REMINDER_12H_CHANNEL_ID = '1429059902852173936'; // rappel 12h (salon dispo)
const IG_REPORT_CHANNEL_ID = '1446471718943326259';       // rapport détaillé 12h & 17h
const IG_PANEL_CHANNEL_ID = '1393774851218735216';        // panneau de dispos

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
    hour12: false
  });

  const parts = fmt.formatToParts(new Date());
  const get = (type) => parts.find(p => p.type === type)?.value;

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const weekday = (get('weekday') || '').toLowerCase();

  const isoDate =
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // On normalise le nom du jour pour coller aux clés de config
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
    console.warn(
      `⚠️ [AUTO] Aucun rôle joueur/essai configuré pour ${guild.id}`
    );
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

  if (!dispoChannelId) {
    console.warn('⚠️ [AUTO] mainDispoChannelId manquant pour IG');
    return;
  }

  const panelChannel = await guild.channels
    .fetch(IG_PANEL_CHANNEL_ID)
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
  if (urls.lundi) {
    row1.addComponents(
      new ButtonBuilder()
        .setLabel('LUNDI')
        .setStyle(ButtonStyle.Link)
        .setURL(urls.lundi)
    );
  }
  if (urls.mardi) {
    row1.addComponents(
      new ButtonBuilder()
        .setLabel('MARDI')
        .setStyle(ButtonStyle.Link)
        .setURL(urls.mardi)
    );
  }
  if (row1.components.length) rows.push(row1);

  const row2 = new ActionRowBuilder();
  if (urls.mercredi) {
    row2.addComponents(
      new ButtonBuilder()
        .setLabel('MERCREDI')
        .setStyle(ButtonStyle.Link)
        .setURL(urls.mercredi)
    );
  }
  if (urls.jeudi) {
    row2.addComponents(
      new ButtonBuilder()
        .setLabel('JEUDI')
        .setStyle(ButtonStyle.Link)
        .setURL(urls.jeudi)
    );
  }
  if (row2.components.length) rows.push(row2);

  const row3 = new ActionRowBuilder();
  if (urls.vendredi) {
    row3.addComponents(
      new ButtonBuilder()
        .setLabel('VENDREDI')
        .setStyle(ButtonStyle.Link)
        .setURL(urls.vendredi)
    );
  }
  if (urls.samedi) {
    row3.addComponents(
      new ButtonBuilder()
        .setLabel('SAMEDI')
        .setStyle(ButtonStyle.Link)
        .setURL(urls.samedi)
    );
  }
  if (row3.components.length) rows.push(row3);

  const row4 = new ActionRowBuilder();
  if (urls.dimanche) {
    row4.addComponents(
      new ButtonBuilder()
        .setLabel('DIMANCHE')
        .setStyle(ButtonStyle.Link)
        .setURL(urls.dimanche)
    );
  }
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

  const {
    cfg,
    nonRepondus,
    messageURL,
    dispoChannel
  } = data;

  const clubName = cfg.clubName || guild.name || 'INTER GALACTIQUE';

  const channel = await guild.channels
    .fetch(IG_REMINDER_12H_CHANNEL_ID)
    .catch(() => null);
  if (!channel) {
    console.warn('⚠️ [AUTO] Salon de rappel 12h introuvable');
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
   RAPPORTS 12h & 17h — même embed que /disponibilites mode "embed_detaille"
============================================================ */

async function sendDetailedReportIG(client, hourLabel) {
  const { jour } = getParisParts();
  const guild = client.guilds.cache.get(IG_GUILD_ID);
  if (!guild) return;

  if (!['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].includes(jour)) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const {
    cfg,
    presentsAll,
    absentsAll,
    nonRepondus,
    rowBtn
  } = data;

  const color = getEmbedColorFromConfig(guild.id);
  const clubName = cfg.clubName || guild.name || 'INTER GALACTIQUE';

  const reportChannel = await guild.channels
    .fetch(IG_REPORT_CHANNEL_ID)
    .catch(() => null);
  if (!reportChannel) {
    console.warn('⚠️ [AUTO] Salon de rapport introuvable');
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`📅 RAPPORT - ${jour.toUpperCase()}`)
    .addFields(
      {
        name: `✅ Présents (${presentsAll.size})`,
        value: idsLine(presentsAll)
      },
      {
        name: `❌ Ont dit absent (${absentsAll.size})`,
        value: idsLine(absentsAll)
      },
      {
        name: `⏳ N’ont pas réagi (${nonRepondus.size})`,
        value: idsLine(nonRepondus)
      }
    )
    .setFooter({ text: `${clubName} ⚫ Rapport automatisé` })
    .setTimestamp();

  await reportChannel.send({
    embeds: [embed],
    components: [rowBtn],
    allowedMentions: IG_AUTOMATION.mentionInReports
      ? { parse: ['users'] }
      : { parse: [] }
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

  const {
    cfg,
    dispoChannel,
    message,
    reacted,
    yes,
    no,
    eligibles,
    messageURL
  } = data;

  const clubName = cfg.clubName || guild.name || 'INTER GALACTIQUE';
  const color = getEmbedColorFromConfig(guild.id);

  // 1) Snapshot JSON
  try {
    if (!fs.existsSync(RAPPORTS_DIR)) {
      fs.mkdirSync(RAPPORTS_DIR, { recursive: true });
    }

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

    const snapPath = path.join(
      RAPPORTS_DIR,
      `snapshot-${jour}-${isoDate}.json`
    );
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
  if (clean.length > room) {
    clean = clean.slice(0, room - 1) + '…';
  }
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
  if (suffixParts.length) {
    full += ' | ' + suffixParts.join(' | ');
  }

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

  const changes = [];
  const unchanged = [];
  const blocked = [];
  const errors = [];

  for (const member of members.values()) {
    const newNick = buildNickname(member, tag, hierarchyRoles, teamRoles, posteRoles);
    const current = member.nickname || member.user.username;

    if (current === newNick) {
      unchanged.push(member);
      continue;
    }

    if (!member.manageable) {
      blocked.push(member);
      continue;
    }

    try {
      await member.setNickname(newNick, 'Synchronisation pseudos XIG (auto)');
      await sleep(SLEEP_MS);
    } catch (e) {
      errors.push({ member, err: String(e?.message || e) });
      continue;
    }

    changes.push({ member, from: current, to: newNick });
  }

  console.log(
    `🧾 [AUTO] Sync pseudos : modifiés=${changes.length}, ok=${unchanged.length}, ` +
    `bloqués=${blocked.length}, erreurs=${errors.length}`
  );
}

/* ============================================================
   INIT SCHEDULER
============================================================ */

function initScheduler(client) {
  console.log('⏰ Initialisation du scheduler automatique (10h / 12h / 17h / 22h + sync pseudos)…');

  let lastNoonDate = null;
  let last17Date = null;
  let lastPanelKey = null; // pour 10h & 22h
  let lastNickKey = null;  // pour sync pseudos horaire

  setInterval(async () => {
    const { hour, minute, isoDate: dateKey } = getParisParts();

    // 10h00 & 22h00 → panneau de disponibilités
    if ((hour === 10 || hour === 22) && minute === 0) {
      const panelKey = `${dateKey}-${hour}`;
      if (lastPanelKey !== panelKey) {
        lastPanelKey = panelKey;
        console.log(`⏰ [AUTO] Tick panneau ${hour}h pour ${dateKey}`);
        try {
          await sendDispoPanelIG(client);
        } catch (e) {
          console.error('❌ [AUTO] Erreur tâche panneau dispos :', e);
        }
      }
    }

    // 12h00 → rappel + rapport intermédiaire
    if (hour === 12 && minute === 0 && lastNoonDate !== dateKey) {
      lastNoonDate = dateKey;
      console.log(`⏰ [AUTO] Tick 12h pour ${dateKey}`);
      try {
        await runNoonReminderIG(client);
        await sendDetailedReportIG(client, '12h');
      } catch (e) {
        console.error('❌ [AUTO] Erreur tâche 12h :', e);
      }
    }

    // 17h00 → rapport final + fermeture
    if (hour === 17 && minute === 0 && last17Date !== dateKey) {
      last17Date = dateKey;
      console.log(`⏰ [AUTO] Tick 17h pour ${dateKey}`);
      try {
        await sendDetailedReportIG(client, '17h');
        await closeDisposAt17IG(client);
      } catch (e) {
        console.error('❌ [AUTO] Erreur tâche 17h :', e);
      }
    }

    // 🔁 Sync pseudos automatique — toutes les heures à H:10
    if (minute === 10) {
      const nickKey = `${dateKey}-${hour}`;
      if (lastNickKey !== nickKey) {
        lastNickKey = nickKey;
        console.log(`⏰ [AUTO] Tick sync pseudos ${hour}h10 pour ${dateKey}`);
        try {
          await autoSyncNicknamesIG(client);
        } catch (e) {
          console.error('❌ [AUTO] Erreur sync pseudos auto :', e);
        }
      }
    }
  }, 60 * 1000); // vérification toutes les minutes
}

module.exports = {
  initScheduler,
  // exports pour la commande de test
  sendDispoPanelIG,
  runNoonReminderIG,
  sendDetailedReportIG,
  closeDisposAt17IG,
  autoSyncNicknamesIG
};
