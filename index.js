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
  Partials
} = require('discord.js');

const { getGlobalConfig } = require('./utils/config');
const { initScheduler } = require('./utils/scheduler');
const { ensureSnapshotDirectory } = require('./utils/paths');

// ✅ Snapshots persistants
ensureSnapshotDirectory();

/* ============================================================
   ✅ SERVEURS AUTORISÉS POUR AUTOMATISATIONS (IG + DOR)
============================================================ */
const IG_GUILD_ID = '1392639720491581551';   // INTER GALACTIQUE
const DOR_GUILD_ID = '1410246320324870217';  // XIG DOR

/* ============================================================
   HEALTHCHECK (Railway Web Service)
============================================================ */
let healthServer = null;

function startHealthcheck() {
  const port = process.env.PORT;
  if (!port) {
    console.log('ℹ️ [HEALTH] PORT absent → pas de serveur HTTP.');
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
   ✅ partials ajoutés (réactions/messages pas en cache)
============================================================ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User
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
  console.log(`🟢 ${BOT_NAME} prêt`);

  // 🔎 Debug: serveurs visibles
  try {
    console.log(
      '🏟️ [GUILDS] visibles:',
      client.guilds.cache.map(g => `${g.name} (${g.id})`).join(' | ')
    );
  } catch {}

  console.log('🕒 Automatisations actives sur :');
  console.log(`- INTER GALACTIQUE (${IG_GUILD_ID})`);
  console.log(`- XIG DOR (${DOR_GUILD_ID})`);

  // Presence (léger)
  const activities = [
    'Dispos 12h / 17h',
    'Snapshots automatiques',
    'Rapport semaine (si activé)',
    'Sync pseudos (si activé)'
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

  // ✅ Scheduler — IG + DOR
  initScheduler(client, {
    targetGuildIds: new Set([IG_GUILD_ID, DOR_GUILD_ID])
  });

  console.log('✅ Scheduler initialisé (IG + DOR).');
});

/* ============================================================
   INTERACTIONS (SLASH COMMANDS)
============================================================ */
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guild?.id;
  if (!guildId) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error('❌ Erreur commande :', err);

    const msg = {
      content: '❌ Une erreur est survenue lors de l’exécution de la commande.',
      ephemeral: true
    };

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
process.on('unhandledRejection', (e) =>
  console.error('🚨 unhandledRejection:', e)
);

process.on('uncaughtException', (e) =>
  console.error('💥 uncaughtException:', e)
);

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM reçu — fermeture propre...');
  try { if (healthServer) healthServer.close(); } catch {}
  try { await client.destroy(); } catch {}
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
