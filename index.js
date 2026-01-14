// index.js — VERSION OPTIMISÉE & SIMPLE (SANS SNAPSHOTS)
// ✔ Anti "Une erreur est survenue" (handler central + safeReply)
// ✔ Zéro double ACK (guards replied/deferred + return systématique)
// ✔ Compatible planning (menus / boutons / modals)
// ✔ Compatible LOGE (bouton accept + log optionnel)
// ✔ Compatible Railway (healthcheck)
// ✔ Chargement commandes robuste + logs
// ✖ Snapshots supprimés (ensureSnapshotDirectory retiré)

// ===================== BOOTSTRAP =====================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');

const {
  Client,
  Collection,
  GatewayIntentBits,
  ActivityType,
  Partials,
  PermissionsBitField,
  ChannelType
} = require('discord.js');

const { getGlobalConfig, getGuildConfig } = require('./utils/config');
const { initScheduler } = require('./utils/scheduler');

// ===================== GUILDS CIBLES (scheduler) =====================
// Tu peux garder ces IDs, ou les déplacer en .env si tu préfères.
const IG_GUILD_ID = '1392639720491581551';
const DOR_GUILD_ID = '1410246320324870217';

// ===================== HEALTHCHECK (Railway) =====================
let healthServer = null;

function startHealthcheck() {
  const port = Number(process.env.PORT);
  if (!port || healthServer) return;

  healthServer = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });

  healthServer.listen(port, '0.0.0.0', () => {
    console.log(`[HEALTH] OK sur :${port}`);
  });
}

// ===================== CLIENT =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User]
});

client.commands = new Collection();

// ===================== HELPERS =====================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Répond sans risque de double ACK
 * - si deferred/replied => followUp (ou editReply si tu veux)
 * - sinon reply
 */
async function safeEphemeral(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.followUp({ content, ephemeral: true }).catch(() => null);
    }
    return await interaction.reply({ content, ephemeral: true }).catch(() => null);
  } catch {
    return null;
  }
}

function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  if (!fs.existsSync(commandsPath)) {
    console.warn(`[CMDS] Dossier introuvable: ${commandsPath}`);
    return;
  }

  const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const full = path.join(commandsPath, file);
    try {
      const cmd = require(full);

      if (!cmd?.data?.name || typeof cmd.execute !== 'function') {
        console.warn(`[CMDS] Ignoré (format invalide): ${file}`);
        continue;
      }

      client.commands.set(cmd.data.name, cmd);
      console.log(`[CMDS] Chargé: ${cmd.data.name}`);
    } catch (err) {
      console.error(`[CMDS] Erreur chargement ${file}:`, err);
    }
  }
}

async function handlePlanningModal(interaction) {
  const cmd = client.commands.get('planning');
  if (!cmd?.handleModalSubmit) return false;
  await cmd.handleModalSubmit(interaction);
  return true;
}

async function handlePlanningComponents(interaction) {
  const cmd = client.commands.get('planning');
  if (!cmd?.handleComponentInteraction) return false;
  await cmd.handleComponentInteraction(interaction);
  return true;
}

async function handleLogeAccept(interaction) {
  const id = interaction.customId || '';
  if (!interaction.isButton() || !id.startsWith('loge_accept:')) return false;

  const parts = id.split(':');
  if (parts.length < 3) {
    await safeEphemeral(interaction, '❌ Bouton invalide.');
    return true;
  }

  const [, guildId, userId] = parts;

  if (interaction.guild?.id !== guildId || interaction.user.id !== userId) {
    await safeEphemeral(interaction, '❌ Accès refusé.');
    return true;
  }

  // Désactive les composants existants
  const disabled = (interaction.message.components || []).map(row => {
    const r = row.toJSON();
    r.components = (r.components || []).map(c => ({ ...c, disabled: true }));
    return r;
  });

  // update = ACK unique (pas de reply derrière)
  await interaction.update({
    content: `${interaction.message.content}\n\n✅ <@${userId}> a accepté le règlement.`,
    components: disabled
  }).catch(async () => {
    // fallback si update fail (message supprimé etc.)
    await safeEphemeral(interaction, '⚠️ Impossible de mettre à jour le message (peut-être supprimé).');
  });

  // Log optionnel en salon logs
  try {
    const cfg = getGuildConfig(guildId) || {};
    const logChannelId = cfg?.logChannelId;

    if (logChannelId && interaction.guild) {
      const ch = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
      if (ch?.isTextBased?.()) {
        await ch.send({ content: `📜 Règlement accepté : <@${userId}>`, allowedMentions: { users: [userId], parse: [] } })
          .catch(() => {});
      }
    }
  } catch {}

  return true;
}

// ===================== READY =====================
client.once('ready', async () => {
  const { botName = 'GalactiqueBot' } = getGlobalConfig() || {};

  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  console.log(`🟢 ${botName} prêt`);

  try {
    client.user.setPresence({
      activities: [{ name: 'Gestion planning', type: ActivityType.Watching }],
      status: 'online'
    });
  } catch {}

  // Petit délai (cache guilds/members) avant scheduler
  await sleep(1200);

  try {
    initScheduler(client, {
      targetGuildIds: new Set([IG_GUILD_ID, DOR_GUILD_ID])
    });
    console.log('✅ Scheduler initialisé (IG + DOR)');
  } catch (err) {
    console.error('❌ Scheduler init error:', err);
  }
});

// ===================== INTERACTIONS =====================
client.on('interactionCreate', async (interaction) => {
  try {
    // ===== MODALS =====
    if (interaction.isModalSubmit()) {
      if (String(interaction.customId || '').startsWith('planning:modal_')) {
        await handlePlanningModal(interaction);
      }
      return;
    }

    // ===== BUTTONS / MENUS =====
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      const customId = String(interaction.customId || '');

      // LOGE
      if (customId.startsWith('loge_accept:')) {
        await handleLogeAccept(interaction);
        return;
      }

      // PLANNING
      if (customId.startsWith('planning:')) {
        await handlePlanningComponents(interaction);
        return;
      }

      return;
    }

    // ===== SLASH COMMANDS =====
    if (!interaction.isChatInputCommand()) return;

    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) {
      await safeEphemeral(interaction, '❌ Commande inconnue (non chargée).');
      return;
    }

    await cmd.execute(interaction);
  } catch (err) {
    console.error('❌ interactionCreate:', err);
    await safeEphemeral(interaction, '❌ Une erreur est survenue.');
  }
});

// ===================== PROCESS SAFETY =====================
process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', err);
});

// ===================== CLEAN EXIT =====================
async function shutdown() {
  try { healthServer?.close(); } catch {}
  try { await client.destroy(); } catch {}
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ===================== BOOT =====================
if (!process.env.TOKEN) {
  console.error('❌ TOKEN manquant (env TOKEN)');
  process.exit(1);
}

loadCommands();
startHealthcheck();
client.login(process.env.TOKEN);
