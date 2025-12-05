// utils/scheduler.js
const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { getGuildConfig } = require('./config');

const RAPPORTS_DIR = path.join(__dirname, '../rapports');
const DEFAULT_COLOR = 0xff4db8;

// IDs fixes pour INTER GALACTIQUE
const IG_GUILD_ID = '1392639720491581551';
const IG_REMINDER_12H_CHANNEL_ID = '1429059902852173936'; // rappel 12h (salon dispo)
const IG_REPORT_CHANNEL_ID = '1446471718943326259';       // rapport détaillé 12h & 17h
const IG_PANEL_CHANNEL_ID = '1393774851218735216';        // panneau de dispos (ton salon)

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

const sanitize = (t) =>
  String(t || '').replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]');

function getParisNow() {
  return new Date(
    new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })
  );
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function getJourString(d) {
  // 0 = dimanche, 1 = lundi, ...
  const map = [
    'dimanche',
    'lundi',
    'mardi',
    'mercredi',
    'jeudi',
    'vendredi',
    'samedi'
  ];
  return map[d.getDay()];
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

  // URLs vers chaque message de dispo
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

  // Si on n'a aucun lien, on ne spam pas
  if (!Object.values(urls).some(Boolean)) {
    console.warn('⚠️ [AUTO] Aucun message de dispo configuré pour le panneau');
    return;
  }

  // Construction des lignes de boutons (max 5 par ligne)
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
   RAPPEL 12h
============================================================ */

async function runNoonReminderIG(client) {
  const now = getParisNow();
  const guild = client.guilds.cache.get(IG_GUILD_ID);
  if (!guild) return;

  const jour = getJourString(now); // "lundi" etc.
  if (!['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].includes(jour)) return;

  const data = await fetchDispoDataForDay(guild, jour);
  if (!data) return;

  const {
    cfg,
    nonRepondus,
    rowBtn,
    messageURL
  } = data;

  const color = getEmbedColorFromConfig(guild.id);
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

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`📣 RAPPEL DISPONIBILITÉS — ${jour.toUpperCase()}`)
    .setDescription(
      absentsArr.length === 0
        ? '✅ Tout le monde a déjà réagi aux disponibilités du jour.'
        : [
            'Merci de réagir aux disponibilités du jour ✅ / ❌',
            '',
            `🧵 [Voir le message du jour](${messageURL})`,
            '',
            `⏳ **Membres n’ayant pas réagi (${absentsArr.length}) :**`,
            idsLine(absentsArr)
          ].join('\n')
    )
    .setFooter({ text: `${clubName} ⚫ Rappel automatisé (12h)` })
    .setTimestamp();

  await channel.send({
    embeds: [embed],
    components: [rowBtn],
    allowedMentions: IG_AUTOMATION.mentionInReminder && ids.length
      ? { users: ids, parse: [] }
      : { parse: [] }
  });

  console.log(`📣 [AUTO] Rappel 12h envoyé pour ${jour} (IG).`);
}

/* ============================================================
   RAPPORTS 12h & 17h
============================================================ */

async function sendDetailedReportIG(client, hourLabel) {
  const now = getParisNow();
  const guild = client.guilds.cache.get(IG_GUILD_ID);
  if (!guild) return;

  const jour = getJourString(now);
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
    .setTitle(`📅 RAPPORT ${hourLabel} — ${jour.toUpperCase()}`)
    .setDescription(
      hourLabel === '12h'
        ? '📊 Rapport intermédiaire généré automatiquement à **12h**.'
        : '📊 Rapport final généré automatiquement à **17h**.'
    )
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
    .setFooter({ text: `${clubName} ⚫ Rapport automatisé (${hourLabel})` })
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
   FERMETURE 17h
============================================================ */

async function closeDisposAt17IG(client) {
  const now = getParisNow();
  const guild = client.guilds.cache.get(IG_GUILD_ID);
  if (!guild) return;

  const jour = getJourString(now);
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
  const dateStr = toISODate(getParisNow());

  // 1) Snapshot JSON
  try {
    if (!fs.existsSync(RAPPORTS_DIR)) {
      fs.mkdirSync(RAPPORTS_DIR, { recursive: true });
    }

    const snapshot = {
      jour,
      date: dateStr,
      messageId: message.id,
      channelId: dispoChannel.id,
      reacted: [...reacted],
      presents: [...yes],
      absents: [...no],
      eligibles: [...eligibles.keys()]
    };

    const snapPath = path.join(
      RAPPORTS_DIR,
      `snapshot-${jour}-${dateStr}.json`
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
   INIT SCHEDULER
============================================================ */

function initScheduler(client) {
  console.log('⏰ Initialisation du scheduler automatique (10h / 12h / 17h / 22h)…');

  let lastNoonDate = null;
  let last17Date = null;
  let lastPanelKey = null; // pour 10h & 22h

  setInterval(async () => {
    const now = getParisNow();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const dateKey = toISODate(now);

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
  }, 60 * 1000); // vérification toutes les minutes
}

module.exports = {
  initScheduler
};
