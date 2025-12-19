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

// --- Nom du bot (chargé APRÈS ready) ---
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
   CHARGEMENT DES COMMANDES
============================================================ */

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
  for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const command = require(path.join(commandsPath, file));
    if (command?.data?.name) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`⚠️ Commande ignorée : ${file}`);
    }
  }
}

/* ============================================================
   READY
============================================================ */

client.once('ready', async () => {
  try {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);

    // 🧠 Chargement SAFE de la config globale
    const globalConfig = getGlobalConfig();
    BOT_NAME = globalConfig.botName || 'GalactiqueBot';
    console.log(`🧠 Config globale chargée — botName = ${BOT_NAME}`);

    // 🎮 Présence
    const activities = [
      'Gestion des disponibilités',
      'Rapports automatisés',
      'Surveillance des compos',
      'XIG INTER GALACTIQUE',
      'GalactiqueBot opérationnel'
    ];

    let idx = 0;
    setInterval(() => {
      client.user.setPresence({
        activities: [{ name: activities[idx], type: ActivityType.Watching }],
        status: 'online'
      });
      idx = (idx + 1) % activities.length;
    }, 300000);

    // 📣 Logs de démarrage par serveur
    for (const guild of client.guilds.cache.values()) {
      const cfg = getGuildConfig(guild.id) || {};
      if (!cfg.logChannelId || cfg.logChannelId === '0') continue;

      const ch = await client.channels.fetch(cfg.logChannelId).catch(() => null);
      if (!ch) continue;

      const embed = new EmbedBuilder()
        .setColor(getEmbedColorForGuild(guild.id))
        .setTitle(`🚀 ${BOT_NAME} en ligne`)
        .setDescription(`✅ Bot opérationnel sur **${guild.name}**`)
        .setFooter({ text: `${BOT_NAME} ⚡ Système automatisé` })
        .setTimestamp();

      await ch.send({ embeds: [embed] });
    }

    // ⏰ LANCEMENT DU SCHEDULER (POINT CRITIQUE)
    console.log('⏰ Démarrage du scheduler automatique…');
    initScheduler(client);

    console.log(`🟢 ${BOT_NAME} prêt et fonctionnel.`);
  } catch (err) {
    console.error('💥 Erreur dans ready():', err);
  }
});

/* ============================================================
   INTERACTIONS (COMMANDES)
============================================================ */

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

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
   GESTION ERREURS GLOBALES
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
