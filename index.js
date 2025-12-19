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

ensureSnapshotDirectory();

// --- IDs fixes ---
const IG_GUILD_ID = '1392639720491581551';
const SUPPORT_GUILD_ID = '1444745566004449506';

// --- Client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// --- Bot name ---
const globalConfig = getGlobalConfig();
const BOT_NAME = globalConfig.botName || 'GalactiqueBot';

// --- Embed color ---
const DEFAULT_COLOR = 0xff4db8;
function getEmbedColorForGuild(guildId) {
  if (!guildId) return DEFAULT_COLOR;
  const cfg = getGuildConfig(guildId) || {};
  const hex = cfg.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

/* ============================================================
   HEALTHCHECK RAILWAY (démarre tout de suite)
============================================================ */
let healthServer = null;

function startHealthcheckServer() {
  const port = process.env.PORT;
  if (!port) {
    console.log('ℹ️ [HEALTH] PORT absent → pas de serveur HTTP (OK si non requis).');
    return;
  }

  if (healthServer) return;

  healthServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });

  healthServer.listen(Number(port), '0.0.0.0', () => {
    console.log(`🌐 [HEALTH] Serveur actif sur le port ${port}`);
  });

  healthServer.on('error', (e) => {
    console.error('❌ [HEALTH] Erreur serveur:', e);
  });
}
startHealthcheckServer();

/* ============================================================
   COMPTEUR MEMBRES
============================================================ */
function buildCounterName(clubName, count, fallback = 'Serveur') {
  const name = clubName || fallback;
  return `${name} — ${count} membres`;
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

    if (!channel) return;

    const clubName = cfg.clubName || guild.name;
    const newName = buildCounterName(clubName, count, guild.name);
    if (channel.name === newName) return;

    await channel.setName(newName, 'Mise à jour compteur membres');
    console.log(`🔢 [COUNTER] ${guild.name} → ${newName}`);
  } catch (err) {
    console.error('❌ [COUNTER] Erreur:', err);
  }
}

/* ============================================================
   COMMANDES
============================================================ */
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (!command?.data?.name) continue;
    client.commands.set(command.data.name, command);
  }
} else {
  console.warn('⚠️ Dossier /commands introuvable.');
}

/* ============================================================
   READY
============================================================ */
client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  console.log(`🟢 ${BOT_NAME} prêt !`);

  const activities = [
    'Surveillance du club',
    'Gestion des disponibilités',
    'Rapports automatisés',
    'Support : discord.gg/BrkeGC6JQE',
    'GalactiqueBot en service'
  ];

  let i = 0;
  const updatePresence = () => {
    const name = activities[i];
    client.user.setPresence({
      activities: [{ name, type: ActivityType.Watching }],
      status: 'online'
    });
    i = (i + 1) % activities.length;
  };

  updatePresence();
  setInterval(updatePresence, 300000);

  const baseStartEmbed = new EmbedBuilder()
    .setTitle(`🚀 ${BOT_NAME.toUpperCase()} EN LIGNE`)
    .setFooter({ text: `${BOT_NAME} ⚡ Système automatisé` })
    .setTimestamp();

  for (const guild of client.guilds.cache.values()) {
    const gConfig = getGuildConfig(guild.id) || {};
    const logChannelId = gConfig.logChannelId;
    if (!logChannelId || logChannelId === '0') continue;

    try {
      const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
      if (!logChannel) continue;

      const embed = EmbedBuilder.from(baseStartEmbed)
        .setColor(getEmbedColorForGuild(guild.id))
        .setDescription(`✅ Bot opérationnel sur **${gConfig.clubName || guild.name}**`);

      await logChannel.send({ embeds: [embed] });
    } catch (err) {
      console.error(`❌ Log démarrage (${guild.id})`, err);
    }
  }

  await updateMemberCounter(SUPPORT_GUILD_ID);
  await updateMemberCounter(IG_GUILD_ID);

  initScheduler(client);
});

/* ============================================================
   INTERACTIONS
============================================================ */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error('❌ Erreur commande :', error);
    const msg = { content: '❌ Une erreur est survenue.', ephemeral: true };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

/* ============================================================
   ERREURS + SIGTERM
============================================================ */
process.on('unhandledRejection', (e) => console.error('🚨 unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('💥 uncaughtException:', e));

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM reçu — fermeture propre...');
  try { if (healthServer) healthServer.close(); } catch {}
  try { await client.destroy(); } catch {}
  // ✅ pas de process.exit() forcé
});

/* ============================================================
   LOGIN
============================================================ */
const token = process.env.TOKEN;
if (!token) {
  console.error('❌ TOKEN manquant dans .env');
  process.exit(1);
}

client.login(token);
