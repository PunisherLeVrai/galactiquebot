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
const express = require('express'); // ⬅️ pour le keep-alive Railway

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

// --- Helper : couleur d’embed par serveur (embedColor ou défaut) ---
const DEFAULT_COLOR = 0xff4db8;
function getEmbedColorForGuild(guildId) {
  if (!guildId) return DEFAULT_COLOR;
  const cfg = getGuildConfig(guildId) || {};
  const hex = cfg.embedColor;
  if (!hex) return DEFAULT_COLOR;

  // hex peut être "ff4db8" ou "#ff4db8" ou "0xff4db8"
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

// --- Chargement des commandes ---
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if (!command?.data?.name) {
    console.warn(`⚠️ Commande ignorée (pas de data.name) : ${file}`);
    continue;
  }
  client.commands.set(command.data.name, command);
}

// --- Quand le bot est prêt ---
client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  // Statut du bot (visible partout)
  client.user.setPresence({
    activities: [{
      name: `${BOT_NAME} — surveillance des disponibilités`,
      type: ActivityType.Watching
    }],
    status: 'online'
  });

  console.log(`🟢 ${BOT_NAME} prêt et en ligne !`);

  // Embed "base" de démarrage (couleur sera adaptée par guilde)
  const baseStartEmbed = new EmbedBuilder()
    .setTitle(`🚀 ${BOT_NAME.toUpperCase()} EN LIGNE`)
    .setFooter({ text: `${BOT_NAME} ⚡ Système automatisé` })
    .setTimestamp();

  // Message de démarrage dans le salon de logs de CHAQUE serveur configuré
  for (const guild of client.guilds.cache.values()) {
    const gConfig = getGuildConfig(guild.id) || {};
    const logChannelId = gConfig.logChannelId;
    if (!logChannelId) continue;

    const clubLabel = gConfig.clubName || guild.name;

    try {
      const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
      if (!logChannel) continue;

      const embed = EmbedBuilder.from(baseStartEmbed)
        .setColor(getEmbedColorForGuild(guild.id))
        .setDescription(
          `Le bot est opérationnel et connecté.\n\n` +
          `🌌 **Serveur :** ${guild.name}\n` +
          `🏟️ **Club :** ${clubLabel}`
        );

      await logChannel.send({ embeds: [embed] });
      console.log(`📨 Message de démarrage envoyé pour ${guild.name} (${guild.id}).`);
    } catch (err) {
      console.error(`⚠️ Erreur lors de l’envoi du message de démarrage pour ${guild.id} :`, err);
    }
  }
});

// --- Message de shutdown (arrêt propre) ---
async function sendShutdownLog() {
  // On crée l’embed à la volée pour chaque guilde (couleur par config)
  for (const guild of client.guilds.cache.values()) {
    const gConfig = getGuildConfig(guild.id) || {};
    const logChannelId = gConfig.logChannelId;
    if (!logChannelId) continue;

    try {
      const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
      if (!logChannel) continue;

      const embed = new EmbedBuilder()
        .setColor(getEmbedColorForGuild(guild.id))
        .setTitle(`🛑 ${BOT_NAME.toUpperCase()} HORS LIGNE`)
        .setDescription(
          `Le bot a été arrêté ou redémarre.\n\n` +
          `🕓 **Heure :** <t:${Math.floor(Date.now() / 1000)}:F>`
        )
        .setFooter({ text: `${BOT_NAME} ⚡ Système automatisé` })
        .setTimestamp();

      await logChannel.send({ embeds: [embed] });
      console.log(`📴 Message de shutdown envoyé pour ${guild.name} (${guild.id}).`);
    } catch (err) {
      console.error(`⚠️ Erreur lors de l’envoi du shutdown pour ${guild.id} :`, err);
    }
  }
}

// Gestion de l'arrêt propre
client.on('shardDisconnect', sendShutdownLog);
client.on('shardDestroy', sendShutdownLog);
process.on('SIGINT', async () => { await sendShutdownLog(); process.exit(0); });
process.on('SIGTERM', async () => { await sendShutdownLog(); process.exit(0); });

// --- Gestion des interactions slash ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error('❌ Erreur lors de l’exécution d’une commande :', error);

    const replyPayload = {
      content: '❌ Une erreur est survenue lors de l’exécution de la commande.',
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(replyPayload).catch(() => {});
    } else {
      await interaction.reply(replyPayload).catch(() => {});
    }
  }
});

// --- Logs d'erreurs globales ---
process.on('unhandledRejection', error =>
  console.error('🚨 Erreur non gérée :', error)
);
process.on('uncaughtException', error =>
  console.error('💥 Exception non interceptée :', error)
);

// --- Connexion du bot ---
const token = process.env.TOKEN;
if (!token) {
  console.error('❌ Erreur : TOKEN manquant dans le .env');
  process.exit(1);
}

client.login(token);

/* ======================================================
   KEEP-ALIVE RAILWAY (petit serveur web Express)
   ====================================================== */

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`${BOT_NAME} actif ✅`);
});

app.listen(PORT, () => {
  console.log(`🌍 Serveur web keep-alive lancé sur le port ${PORT}`);
});
