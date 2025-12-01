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

// --- Initialisation du client Discord ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// --- Nom du bot depuis la config globale ---
const globalConfig = getGlobalConfig();
const BOT_NAME = globalConfig.botName || 'GalactiqueBot';

// --- Helper : couleur d’embed par serveur ---
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
   COMPTEUR DE MEMBRES — GALACTIQUEBOT SUPPORT
   Catégorie renommée en : "GalactiqueBot — X membres"
============================================================ */

const SUPPORT_GUILD_ID = '1444745566004449506';      // Serveur "GalactiqueBot Support"
const SUPPORT_CATEGORY_ID = '1445186546335482037';   // Catégorie à renommer

function buildSupportCounterName(count) {
  return `GalactiqueBot — ${count} membres`;
}

async function updateSupportMemberCounter() {
  try {
    const guild = client.guilds.cache.get(SUPPORT_GUILD_ID);
    if (!guild) return;

    // On s'assure d'avoir les bons nombres
    await guild.members.fetch().catch(() => {});
    const count = guild.memberCount;

    const channel =
      guild.channels.cache.get(SUPPORT_CATEGORY_ID) ||
      await client.channels.fetch(SUPPORT_CATEGORY_ID).catch(() => null);

    if (!channel) return;

    const newName = buildSupportCounterName(count);
    if (channel.name === newName) return; // inutile de renommer

    await channel.setName(newName, 'Mise à jour du compteur de membres GalactiqueBot');
    console.log(`🔢 Compteur mis à jour sur ${guild.name} : ${newName}`);
  } catch (err) {
    console.error('❌ Erreur lors de la mise à jour du compteur de membres :', err);
  }
}

/* ============================================================
   CHARGEMENT DES COMMANDES
============================================================ */

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if (!command?.data?.name) {
      console.warn(`⚠️ Commande ignorée : ${file}`);
      continue;
    }

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

  client.user.setPresence({
    activities: [{
      name: `${BOT_NAME} — surveillance`,
      type: ActivityType.Watching
    }],
    status: 'online'
  });

  console.log(`🟢 ${BOT_NAME} prêt !`);

  const baseStartEmbed = new EmbedBuilder()
    .setTitle(`🚀 ${BOT_NAME.toUpperCase()} EN LIGNE`)
    .setFooter({ text: `${BOT_NAME} ⚡ Système automatisé` })
    .setTimestamp();

  for (const guild of client.guilds.cache.values()) {
    const gConfig = getGuildConfig(guild.id) || {};
    const logChannelId = gConfig.logChannelId;
    if (!logChannelId) continue;

    try {
      const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
      if (!logChannel) continue;

      const embed = EmbedBuilder.from(baseStartEmbed)
        .setColor(getEmbedColorForGuild(guild.id))
        .setDescription(`✅ Bot opérationnel sur **${guild.name}**`);

      await logChannel.send({ embeds: [embed] });
      console.log(`📨 Log envoyé sur ${guild.name}`);
    } catch (err) {
      console.error(`❌ Erreur log ${guild.id}`, err);
    }
  }

  // 🔢 Mise à jour initiale du compteur sur le serveur support
  await updateSupportMemberCounter();
});

/* ============================================================
   EVENTS MEMBRES — POUR MAJ DU COMPTEUR
============================================================ */

// Nouveau membre sur le serveur support
client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== SUPPORT_GUILD_ID) return;
  await updateSupportMemberCounter();
});

// Membre qui quitte le serveur support
client.on('guildMemberRemove', async (member) => {
  if (member.guild.id !== SUPPORT_GUILD_ID) return;
  await updateSupportMemberCounter();
});

/* ============================================================
   INTERACTIONS (COMMANDES SLASH)
============================================================ */

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error('❌ Erreur commande :', error);

    const msg = {
      content: '❌ Une erreur est survenue.',
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
   LOG ERREURS GLOBALES
============================================================ */

process.on('unhandledRejection', error =>
  console.error('🚨 Promesse rejetée :', error)
);
process.on('uncaughtException', error =>
  console.error('💥 Exception :', error)
);

/* ============================================================
   LOGIN
============================================================ */

const token = process.env.TOKEN;
if (!token) {
  console.error('❌ TOKEN manquant dans .env');
  process.exit(1);
}

client.login(token);
