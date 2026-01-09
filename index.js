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

const { getGlobalConfig, getGuildConfig } = require('./utils/config'); // ✅ getGuildConfig ajouté
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

  // ✅ Important: attendre que le cache guilds soit bien prêt
  await new Promise(r => setTimeout(r, 1500));

  // ✅ Scheduler — IG + DOR
  initScheduler(client, {
    targetGuildIds: new Set([IG_GUILD_ID, DOR_GUILD_ID])
  });

  console.log('✅ Scheduler initialisé (IG + DOR).');
});

/* ============================================================
   INTERACTIONS (BOUTONS + SLASH COMMANDS)
============================================================ */
function disableAllComponents(components) {
  // components = interaction.message.components (ActionRows)
  // On reconstruit en désactivant les boutons
  try {
    return components.map(row => {
      const newRow = { ...row };
      newRow.components = row.components.map(c => {
        // discord.js renvoie des objets "Component" avec méthodes
        if (typeof c.setDisabled === 'function') return c.setDisabled(true);
        // fallback si jamais
        return { ...c, disabled: true };
      });
      return newRow;
    });
  } catch {
    return [];
  }
}

client.on('interactionCreate', async (interaction) => {
  /* =========================
     ✅ 1) BOUTONS (validation LOGE)
     customId: "loge_accept:<guildId>:<userId>"
  ========================= */
  if (interaction.isButton()) {
    const id = interaction.customId || '';
    if (!id.startsWith('loge_accept:')) return;

    const [, guildId, userId] = id.split(':');

    // sécurité
    if (!interaction.guild || interaction.guild.id !== guildId) {
      return interaction.reply({ content: '❌ Contexte invalide.', ephemeral: true }).catch(() => {});
    }

    // seul le joueur concerné
    if (interaction.user.id !== userId) {
      return interaction.reply({ content: '❌ Ce bouton ne te concerne pas.', ephemeral: true }).catch(() => {});
    }

    // désactive le bouton + ajoute une ligne validation
    const disabled = disableAllComponents(interaction.message.components);

    try {
      await interaction.update({
        content: `${interaction.message.content}\n\n✅ <@${userId}> a **lu et accepté le règlement officiel**.`,
        components: disabled
      });
    } catch (e) {
      console.error('❌ [LOGE] update message:', e);
      // fallback au reply
      return interaction.reply({ content: '✅ Validation enregistrée.', ephemeral: true }).catch(() => {});
    }

    // log staff (optionnel via servers.json)
    try {
      const cfg = getGuildConfig(interaction.guild.id) || {};
      const logChannelId = cfg.logChannelId;

      if (logChannelId && logChannelId !== '0') {
        const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
        if (logChannel?.isTextBased()) {
          await logChannel.send(`📜 Validation règlement : <@${userId}>`).catch(() => {});
        }
      }
    } catch (e) {
      console.error('⚠️ [LOGE] logChannel:', e);
    }

    return; // ✅ on stop ici
  }

  /* =========================
     ✅ 2) SLASH COMMANDS
  ========================= */
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
