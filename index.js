// index.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');

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

/* ============================================================
   🚑 RAILWAY FIX ABSOLU
   → Le serveur HTTP DOIT démarrer IMMÉDIATEMENT
============================================================ */

const PORT = process.env.PORT || 3000;

const healthServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
});

healthServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 [HEALTH] Serveur actif sur le port ${PORT}`);
});

/* ============================================================
   DATA / SNAPSHOTS
============================================================ */

ensureSnapshotDirectory();

/* ============================================================
   IDS FIXES
============================================================ */

const IG_GUILD_ID = '1392639720491581551';
const SUPPORT_GUILD_ID = '1444745566004449506';

/* ============================================================
   CLIENT DISCORD
============================================================ */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ]
});

/* ============================================================
   CONFIG
============================================================ */

const globalConfig = getGlobalConfig();
const BOT_NAME = globalConfig.botName || 'GalactiqueBot';

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
   COMMANDES
============================================================ */

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
  for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const cmd = require(path.join(commandsPath, file));
    if (cmd?.data?.name) {
      client.commands.set(cmd.data.name, cmd);
    }
  }
}

/* ============================================================
   READY
============================================================ */

client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  const activities = [
    'Surveillance du club',
    'Gestion des disponibilités',
    'Rapports automatisés',
    'GalactiqueBot en service'
  ];

  let i = 0;
  setInterval(() => {
    client.user.setPresence({
      activities: [{ name: activities[i], type: ActivityType.Watching }],
      status: 'online'
    });
    i = (i + 1) % activities.length;
  }, 300000);

  // Logs démarrage
  for (const guild of client.guilds.cache.values()) {
    const cfg = getGuildConfig(guild.id);
    if (!cfg?.logChannelId || cfg.logChannelId === '0') continue;

    const ch = await client.channels.fetch(cfg.logChannelId).catch(() => null);
    if (!ch) continue;

    await ch.send({
      embeds: [
        new EmbedBuilder()
          .setColor(getEmbedColorForGuild(guild.id))
          .setTitle(`🚀 ${BOT_NAME} EN LIGNE`)
          .setDescription(`Serveur : **${cfg.clubName || guild.name}**`)
          .setTimestamp()
      ]
    });
  }

  // ✅ SCHEDULER (INTACT)
  initScheduler(client);
});

/* ============================================================
   INTERACTIONS
============================================================ */

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction);
  } catch (e) {
    console.error(e);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Erreur.', ephemeral: true });
    }
  }
});

/* ============================================================
   SHUTDOWN PROPRE
============================================================ */

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM reçu – arrêt propre');
  try { healthServer.close(); } catch {}
  try { await client.destroy(); } catch {}
  process.exit(0);
});

/* ============================================================
   LOGIN
============================================================ */

if (!process.env.TOKEN) {
  console.error('❌ TOKEN manquant');
  process.exit(1);
}

client.login(process.env.TOKEN);
