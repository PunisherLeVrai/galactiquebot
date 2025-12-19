// index.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');

const {
  Client,
  Collection,
  GatewayIntentBits,
  ActivityType
} = require('discord.js');

const { getGlobalConfig } = require('./utils/config');
const { initScheduler } = require('./utils/scheduler');
const { ensureSnapshotDirectory } = require('./utils/paths');

// ✅ Snapshots persistants
ensureSnapshotDirectory();

/* ============================================================
   GUILDS CIBLÉS (UNIQUEMENT IGA + DOR)
============================================================ */
const IG_GUILD_ID  = '1392639720491581551';
const DOR_GUILD_ID = '1410246320324870217';
const TARGET_GUILD_IDS = new Set([IG_GUILD_ID, DOR_GUILD_ID]);

/* ============================================================
   HEALTHCHECK (Railway Web Service)
   - Si PORT existe, on ouvre un mini serveur HTTP "OK"
   - Si PORT n'existe pas, on ne fait rien (worker / autre)
============================================================ */
let healthServer = null;

function startHealthcheck() {
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
    console.log(`🌐 [HEALTH] OK sur :${port}`);
  });

  healthServer.on('error', (e) => {
    console.error('❌ [HEALTH] Erreur serveur:', e);
  });
}
startHealthcheck();

/* ============================================================
   CLIENT DISCORD
============================================================ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers
  ]
});

/* ============================================================
   COMMANDES SLASH
============================================================ */
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
  const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const cmd = require(path.join(commandsPath, file));
    if (!cmd?.data?.name || typeof cmd.execute !== 'function') continue;
    client.commands.set(cmd.data.name, cmd);
  }
} else {
  console.warn('⚠️ Dossier /commands introuvable.');
}

/* ============================================================
   READY
============================================================ */
client.once('ready', async () => {
  const globalConfig = getGlobalConfig() || {};
  const BOT_NAME = globalConfig.botName || 'GalactiqueBot';

  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  console.log(`🟢 ${BOT_NAME} prêt (IGA + DOR).`);

  // Presence (léger)
  const activities = [
    'Dispos 12h/17h',
    'Snapshots 17h',
    'Rapport semaine (dimanche)',
    'Sync pseudos'
  ];
  let i = 0;
  const updatePresence = () => {
    client.user.setPresence({
      activities: [{ name: activities[i], type: ActivityType.Watching }],
      status: 'online'
    });
    i = (i + 1) % activities.length;
  };
  updatePresence();
  setInterval(updatePresence, 300000);

  // ✅ Scheduler
  initScheduler(client, { targetGuildIds: TARGET_GUILD_IDS });
});

/* ============================================================
   INTERACTIONS (SLASH)
============================================================ */
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ✅ Ignore tout ce qui n'est pas IGA/DOR
  const gid = interaction.guild?.id;
  if (!gid || !TARGET_GUILD_IDS.has(gid)) {
    return interaction.reply({
      content: '❌ Ce bot est configuré uniquement pour **IGA** et **DOR**.',
      ephemeral: true
    }).catch(() => {});
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error('❌ Erreur commande :', err);
    const msg = { content: '❌ Une erreur est survenue.', ephemeral: true };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

/* ============================================================
   LOG ERREURS + ARRÊT PROPRE
============================================================ */
process.on('unhandledRejection', (e) => console.error('🚨 unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('💥 uncaughtException:', e));

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM reçu — fermeture propre...');
  try { if (healthServer) healthServer.close(); } catch {}
  try { await client.destroy(); } catch {}
  // pas de process.exit() forcé
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
