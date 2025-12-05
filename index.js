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
const { initScheduler } = require('./utils/scheduler'); // 🆕 scheduler

// --- IDs FIXES (deux serveurs) ---
const IG_GUILD_ID = '1392639720491581551';              // INTER GALACTIQUE
const IG_ARRIVALS_CHANNEL_ID = '1393775051433840680';   // #arrivées IG

const SUPPORT_GUILD_ID = '1444745566004449506';         // GalactiqueBot Support
const SUPPORT_CATEGORY_ID = '1445186546335482037';      // Catégorie compteur
const SUPPORT_ARRIVALS_CHANNEL_ID = '1445186724576628899'; // #arrivées support
const SUPPORT_HELP_ROLE_ID = '1445374262029451334';        // rôle @Aide
const SUPPORT_HELP_CHANNEL_ID = '1445186873063505960';     // salon #support

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

function buildSupportCounterName(count) {
  return `GalactiqueBot — ${count} membres`;
}

async function updateSupportMemberCounter() {
  try {
    const guild = client.guilds.cache.get(SUPPORT_GUILD_ID);
    if (!guild) return;

    await guild.members.fetch().catch(() => {});
    const count = guild.memberCount;

    const channel =
      guild.channels.cache.get(SUPPORT_CATEGORY_ID) ||
      await client.channels.fetch(SUPPORT_CATEGORY_ID).catch(() => null);

    if (!channel) return;

    const newName = buildSupportCounterName(count);
    if (channel.name === newName) return;

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

  // Rotation automatique du "Regarde ..."
  const activities = [
    'Surveillance du club',
    'Gestion des disponibilités',
    'Rapports automatisés',
    'Support : discord.gg/BrkeGC6JQE',
    'GalactiqueBot en service'
  ];

  let activityIndex = 0;

  function updatePresence() {
    const name = activities[activityIndex];

    client.user.setPresence({
      activities: [{
        name,
        type: ActivityType.Watching
      }],
      status: 'online'
    });

    activityIndex = (activityIndex + 1) % activities.length;
  }

  updatePresence();
  setInterval(updatePresence, 300000);

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

  // Compteur membres serveur support
  await updateSupportMemberCounter();

  // 🕒 Lancement du scheduler automatique (12h / 17h)
  initScheduler(client);
});

/* ============================================================
   MESSAGES DE BIENVENUE + MISE À JOUR COMPTEUR
============================================================ */

async function sendWelcomeInterGalactique(member) {
  try {
    const channel = await member.guild.channels
      .fetch(IG_ARRIVALS_CHANNEL_ID)
      .catch(() => null);
    if (!channel) return;

    const total = member.guild.memberCount;

    const embed = new EmbedBuilder()
      .setColor(getEmbedColorForGuild(member.guild.id))
      .setAuthor({ name: 'Ho ! Un nouveau joueur INTER GALACTIQUE !' })
      .setDescription(
        `👋 Bienvenue ${member} sur le serveur **INTER GALACTIQUE**.\n` +
        `Nous sommes désormais **${total}** membres. 🎉\n\n` +
        `> Tu peux dès maintenant :\n` +
        `> • Lire le règlement et les infos du club\n` +
        `> • Mettre tes disponibilités chaque jour\n` +
        `> • Discuter avec le staff dans ta loge dédiée\n\n` +
        `🚀 Prépare-toi à prouver que tu as le niveau.`
      )
      .setFooter({ text: 'INTER GALACTIQUE — GalactiqueBot' })
      .setTimestamp();

    await channel.send({ content: `${member}`, embeds: [embed] });
    console.log(`🙌 Message de bienvenue envoyé (INTER GALACTIQUE) pour ${member.id}`);
  } catch (err) {
    console.error('❌ Erreur welcome INTER GALACTIQUE :', err);
  }
}

async function sendWelcomeSupport(member) {
  try {
    const channel = await member.guild.channels
      .fetch(SUPPORT_ARRIVALS_CHANNEL_ID)
      .catch(() => null);
    if (!channel) return;

    const total = member.guild.memberCount;

    const embed = new EmbedBuilder()
      .setColor(getEmbedColorForGuild(member.guild.id))
      .setAuthor({ name: 'Ho ! Un nouveau membre !' })
      .setDescription(
        `🐙 Bienvenue sur **GalactiqueBot Support** ${member} !\n` +
        `Nous sommes désormais **${total}** membres. 🎉\n\n` +
        `» Tu peux demander de l'aide à notre équipe dans le salon ` +
        `<#${SUPPORT_HELP_CHANNEL_ID}> en créant un nouveau message pour ton problème.\n` +
        `Pense aussi à mentionner le rôle <@&${SUPPORT_HELP_ROLE_ID}> ` +
        `afin que ta demande soit traitée plus rapidement.\n\n` +
        `If you speak English, you can also ask your questions in ` +
        `<#${SUPPORT_HELP_CHANNEL_ID}> — the team will help you.`
      )
      .setFooter({ text: 'GalactiqueBot Support' })
      .setTimestamp();

    await channel.send({ content: `${member}`, embeds: [embed] });
    console.log(`🙌 Message de bienvenue envoyé (Support) pour ${member.id}`);
  } catch (err) {
    console.error('❌ Erreur welcome SUPPORT :', err);
  }
}

client.on('guildMemberAdd', async (member) => {
  if (member.guild.id === IG_GUILD_ID) {
    await sendWelcomeInterGalactique(member);
    return;
  }

  if (member.guild.id === SUPPORT_GUILD_ID) {
    await sendWelcomeSupport(member);
    await updateSupportMemberCounter();
  }
});

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
