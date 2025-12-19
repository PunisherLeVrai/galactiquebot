// index.js (FINAL)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  Collection,
  GatewayIntentBits,
  ActivityType,
  EmbedBuilder
} = require('discord.js');

const { getGlobalConfig, getGuildConfig } = require('./utils/config');
const { initScheduler } = require('./utils/scheduler');
const { ensureSnapshotDirectory } = require('./utils/paths');

// 🔧 S'assurer que le dossier snapshots existe AVANT toute automation
ensureSnapshotDirectory();

// --- IDs SERVEURS ---
const IG_GUILD_ID = '1392639720491581551';
const SUPPORT_GUILD_ID = '1444745566004449506';

// --- Client Discord ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// --- Nom du bot ---
let BOT_NAME = 'GalactiqueBot';

// --- Helper couleur embed ---
const DEFAULT_COLOR = 0xff4db8;
function getEmbedColorForGuild(guildId) {
  const cfg = getGuildConfig(guildId) || {};
  const hex = cfg.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

/* ============================================================
   COMPTEURS DE MEMBRES
============================================================ */

function buildSupportCounterName(count) {
  return `GalactiqueBot — ${count} membres`;
}
function buildInterCounterName(count) {
  return `INTER GALACTIQUE — ${count} membres`;
}

async function updateMemberCounter(guildId) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const cfg = getGuildConfig(guildId) || {};
    const counterId = cfg.memberCounterChannelId;
    if (!counterId || counterId === '0') return;

    await guild.members.fetch().catch(() => {});
    const count = guild.memberCount;

    const channel =
      guild.channels.cache.get(counterId) ||
      await client.channels.fetch(counterId).catch(() => null);

    if (!channel) {
      console.warn(`⚠️ [COUNTER] Salon compteur introuvable : ${counterId} (guild ${guildId})`);
      return;
    }

    const newName =
      guildId === SUPPORT_GUILD_ID
        ? buildSupportCounterName(count)
        : buildInterCounterName(count);

    if (channel.name === newName) return;

    await channel.setName(newName, 'Mise à jour compteur de membres');
    console.log(`🔢 [COUNTER] ${guild.name} => ${newName}`);
  } catch (err) {
    console.error('❌ [COUNTER] Erreur update compteur :', err);
  }
}

/* ============================================================
   CHARGEMENT DES COMMANDES
============================================================ */

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
  const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const command = require(path.join(commandsPath, file));
      if (command?.data?.name && typeof command.execute === 'function') {
        client.commands.set(command.data.name, command);
      } else {
        console.warn(`⚠️ [CMD] Commande ignorée (structure invalide) : ${file}`);
      }
    } catch (e) {
      console.error(`❌ [CMD] Impossible de charger : ${file}`, e);
    }
  }
} else {
  console.warn('⚠️ [CMD] Dossier /commands introuvable.');
}

/* ============================================================
   WELCOME MESSAGES
============================================================ */

async function sendWelcomeInterGalactique(member) {
  try {
    const cfg = getGuildConfig(member.guild.id) || {};
    const welcomeId = cfg.welcomeChannelId;

    if (!welcomeId || welcomeId === '0') return;

    const channel = await member.guild.channels.fetch(welcomeId).catch(() => null);
    if (!channel) return;

    const total = member.guild.memberCount;

    const description =
      `👋 Tu viens de rejoindre la **structure XIG INTER GALACTIQUE** ${member}.\n` +
      `Nous sommes désormais **${total}** membres. 🎉\n\n` +
      `### 📌 1) LIRE LE RÈGLEMENT\n` +
      `👉 <#1393771863821389976>\n` +
      `Aucune excuse ne sera acceptée.\n\n` +
      `### 🙋 2) FAIRE TA PRÉSENTATION\n` +
      `👉 <#1447255582485643547>\n\n` +
      `### 📅 3) TENIR TES DISPONIBILITÉS À JOUR\n` +
      `**Disponible (✅) — Indisponible (❌)**\n` +
      `👉 <#1429059902852173936>\n` +
      `L’implication quotidienne est obligatoire.\n\n` +
      `🛡️ **XIG INTER GALACTIQUE — Discipline, engagement, performance**`;

    const embed = new EmbedBuilder()
      .setColor(getEmbedColorForGuild(member.guild.id))
      .setAuthor({ name: 'Nouvelle arrivée — XIG INTER GALACTIQUE' })
      .setDescription(description)
      .setFooter({ text: 'INTER GALACTIQUE — GalactiqueBot' })
      .setTimestamp();

    await channel.send({ content: `${member}`, embeds: [embed] });
    console.log(`🙌 [WELCOME] IG envoyé à ${member.user.tag}`);
  } catch (err) {
    console.error('❌ [WELCOME] Erreur IG :', err);
  }
}

async function sendWelcomeSupport(member) {
  try {
    const cfg = getGuildConfig(member.guild.id) || {};
    const welcomeId = cfg.welcomeChannelId;

    if (!welcomeId || welcomeId === '0') return;

    const channel = await member.guild.channels.fetch(welcomeId).catch(() => null);
    if (!channel) return;

    const total = member.guild.memberCount;

    const supportMention = cfg.supportChannelId ? `<#${cfg.supportChannelId}>` : '`#support`';
    const helpRoleMention = cfg.helpRoleId ? `<@&${cfg.helpRoleId}>` : '`@Aide`';

    const embed = new EmbedBuilder()
      .setColor(getEmbedColorForGuild(member.guild.id))
      .setAuthor({ name: 'Ho ! Un nouveau membre !' })
      .setDescription(
        `🐙 Bienvenue sur **GalactiqueBot Support** ${member} !\n` +
        `Nous sommes désormais **${total}** membres. 🎉\n\n` +
        `» Pose ta question dans ${supportMention} et mentionne ${helpRoleMention}.\n\n` +
        `If you speak English, you can also ask in ${supportMention}.`
      )
      .setFooter({ text: 'GalactiqueBot Support' })
      .setTimestamp();

    await channel.send({ content: `${member}`, embeds: [embed] });
    console.log(`🙌 [WELCOME] Support envoyé à ${member.user.tag}`);
  } catch (err) {
    console.error('❌ [WELCOME] Erreur Support :', err);
  }
}

/* ============================================================
   READY
============================================================ */

// Anti double scheduler (crucial sur Railway / redéploiements)
let schedulerStarted = false;

client.once('ready', async () => {
  try {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);

    // 🧠 Charger config globale
    const globalConfig = getGlobalConfig();
    BOT_NAME = globalConfig?.botName || 'GalactiqueBot';
    console.log(`🧠 Config globale OK — botName = ${BOT_NAME}`);

    // 🎮 Présence
    const activities = [
      'Gestion des disponibilités',
      'Rapports automatisés',
      'Surveillance des compos',
      'XIG INTER GALACTIQUE',
      'GalactiqueBot opérationnel'
    ];

    let idx = 0;
    const setPresence = () => {
      client.user.setPresence({
        activities: [{ name: activities[idx], type: ActivityType.Watching }],
        status: 'online'
      });
      idx = (idx + 1) % activities.length;
    };

    setPresence();
    setInterval(setPresence, 300000);

    // 📣 Logs de démarrage par serveur (si logChannelId défini)
    for (const guild of client.guilds.cache.values()) {
      const cfg = getGuildConfig(guild.id) || {};
      const logId = cfg.logChannelId;
      if (!logId || logId === '0') continue;

      const ch = await client.channels.fetch(logId).catch(() => null);
      if (!ch) continue;

      const embed = new EmbedBuilder()
        .setColor(getEmbedColorForGuild(guild.id))
        .setTitle(`🚀 ${BOT_NAME.toUpperCase()} EN LIGNE`)
        .setDescription(`✅ Bot opérationnel sur **${guild.name}**`)
        .setFooter({ text: `${BOT_NAME} ⚡ Système automatisé` })
        .setTimestamp();

      await ch.send({ embeds: [embed] }).catch(() => {});
    }

    // 🔢 Update compteurs au démarrage
    await updateMemberCounter(SUPPORT_GUILD_ID);
    await updateMemberCounter(IG_GUILD_ID);

    // ⏰ LANCEMENT DU SCHEDULER (UNE SEULE FOIS)
    if (!schedulerStarted) {
      schedulerStarted = true;
      console.log('⏰ Démarrage du scheduler automatique…');
      initScheduler(client);

      // ❤️ Heartbeat : prouve que le process tourne encore
      setInterval(() => {
        console.log(`❤️ [HEARTBEAT] Scheduler vivant — ${new Date().toISOString()}`);
      }, 10 * 60 * 1000);
    } else {
      console.warn('⚠️ Scheduler déjà démarré (anti double-run).');
    }

    console.log(`🟢 ${BOT_NAME} prêt.`);
  } catch (err) {
    console.error('💥 Erreur dans ready():', err);
  }
});

/* ============================================================
   ARRIVÉES / DÉPARTS
============================================================ */

client.on('guildMemberAdd', async (member) => {
  try {
    if (member.guild.id === IG_GUILD_ID) {
      await sendWelcomeInterGalactique(member);

      // 🎫 Rôle recrue auto si configuré
      const cfg = getGuildConfig(member.guild.id) || {};
      const recrueId = cfg.roles?.recrue;
      if (recrueId && recrueId !== '0') {
        const role = member.guild.roles.cache.get(recrueId);
        if (role) {
          await member.roles.add(role, 'Arrivée serveur — rôle recrue auto').catch(() => {});
        }
      }

      await updateMemberCounter(IG_GUILD_ID);
      return;
    }

    if (member.guild.id === SUPPORT_GUILD_ID) {
      await sendWelcomeSupport(member);
      await updateMemberCounter(SUPPORT_GUILD_ID);
    }
  } catch (err) {
    console.error('❌ [guildMemberAdd] erreur:', err);
  }
});

client.on('guildMemberRemove', async (member) => {
  try {
    if (member.guild.id === IG_GUILD_ID) {
      await updateMemberCounter(IG_GUILD_ID);
      return;
    }
    if (member.guild.id === SUPPORT_GUILD_ID) {
      await updateMemberCounter(SUPPORT_GUILD_ID);
    }
  } catch (err) {
    console.error('❌ [guildMemberRemove] erreur:', err);
  }
});

/* ============================================================
   INTERACTIONS (COMMANDES SLASH)
============================================================ */

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    // utile si commandes pas (re)deploy côté Discord
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`❌ Erreur commande /${interaction.commandName}`, err);

    const msg = { content: '❌ Une erreur est survenue.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

/* ============================================================
   LOG ERREURS GLOBALES
============================================================ */

process.on('unhandledRejection', err => {
  console.error('🚨 Unhandled Rejection:', err);
});
process.on('uncaughtException', err => {
  console.error('💥 Uncaught Exception:', err);
});

/* ============================================================
   LOGIN
============================================================ */

if (!process.env.TOKEN) {
  console.error('❌ TOKEN manquant dans .env');
  process.exit(1);
}

client.login(process.env.TOKEN);
