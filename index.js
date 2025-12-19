// index.js
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
const { initScheduler } = require('./utils/scheduler'); // 🕒 scheduler
const { ensureSnapshotDirectory } = require('./utils/paths'); // 📁 snapshots persistants

// 🔧 S'assurer que le dossier des snapshots (et base data) existe
ensureSnapshotDirectory();

// --- IDs fixes : uniquement les serveurs ---
const IG_GUILD_ID = '1392639720491581551';              // INTER GALACTIQUE
const SUPPORT_GUILD_ID = '1444745566004449506';         // GalactiqueBot Support

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
   COMPTEURS DE MEMBRES
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

    if (!counterId) {
      console.warn(`⚠️ [COUNTER] memberCounterChannelId manquant pour ${guildId}`);
      return;
    }

    await guild.members.fetch().catch(() => {});
    const count = guild.memberCount;

    const channel =
      guild.channels.cache.get(counterId) ||
      await client.channels.fetch(counterId).catch(() => null);

    if (!channel) {
      console.warn(`⚠️ [COUNTER] Salon compteur introuvable (${guildId}) : ${counterId}`);
      return;
    }

    const clubName = cfg.clubName || guild.name;
    const newName = buildCounterName(clubName, count, guild.name);

    if (channel.name === newName) return;

    await channel.setName(newName, 'Mise à jour du compteur de membres');
    console.log(`🔢 [COUNTER] ${guild.name} → ${newName}`);
  } catch (err) {
    console.error('❌ [COUNTER] Erreur mise à jour compteur :', err);
  }
}

/* ============================================================
   CHARGEMENT DES COMMANDES
============================================================ */

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if (!command?.data?.name) {
      console.warn(`⚠️ Commande ignorée (pas de .data.name) : ${file}`);
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

  let i = 0;
  function updatePresence() {
    const name = activities[i];
    client.user.setPresence({
      activities: [{ name, type: ActivityType.Watching }],
      status: 'online'
    });
    i = (i + 1) % activities.length;
  }

  updatePresence();
  setInterval(updatePresence, 300000); // toutes les 5 minutes

  console.log(`🟢 ${BOT_NAME} prêt !`);

  const baseStartEmbed = new EmbedBuilder()
    .setTitle(`🚀 ${BOT_NAME.toUpperCase()} EN LIGNE`)
    .setFooter({ text: `${BOT_NAME} ⚡ Système automatisé` })
    .setTimestamp();

  // Envoi log démarrage sur chaque serveur configuré
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
      console.log(`📨 Log de démarrage envoyé sur ${guild.name}`);
    } catch (err) {
      console.error(`❌ Erreur envoi log démarrage ${guild.id}`, err);
    }
  }

  // Compteurs
  await updateMemberCounter(SUPPORT_GUILD_ID);
  await updateMemberCounter(IG_GUILD_ID);

  // 🕒 Lancement du scheduler automatique (corrigé anti-bug 22h)
  initScheduler(client);
});

/* ============================================================
   MESSAGES DE BIENVENUE
============================================================ */

async function sendWelcomeInterGalactique(member) {
  try {
    const cfg = getGuildConfig(member.guild.id) || {};
    const welcomeId = cfg.welcomeChannelId;

    if (!welcomeId) {
      console.warn('⚠️ [WELCOME IG] welcomeChannelId manquant dans servers.json');
      return;
    }

    const channel = await member.guild.channels.fetch(welcomeId).catch(() => null);
    if (!channel) return;

    const total = member.guild.memberCount;

    const description =
      `👋 Tu viens de rejoindre **${cfg.clubName || 'XIG INTER GALACTIQUE'}** ${member}.\n` +
      `Nous sommes désormais **${total}** membres. 🎉\n\n` +
      `### 📌 1) LIRE LE RÈGLEMENT\n` +
      `👉 <#1393771863821389976>\n` +
      `Aucune excuse ne sera acceptée.\n\n` +
      `### 🙋 2) FAIRE TA PRÉSENTATION\n` +
      `👉 <#1447255582485643547>\n\n` +
      `### 📅 3) TENIR TES DISPONIBILITÉS À JOUR\n` +
      `Réagis chaque jour ✅ / ❌ dans :\n` +
      `👉 <#1429059902852173936>\n` +
      `L’implication quotidienne est obligatoire.\n\n` +
      `🛡️ **Discipline • Engagement • Performance**`;

    const embed = new EmbedBuilder()
      .setColor(getEmbedColorForGuild(member.guild.id))
      .setAuthor({ name: `Nouvelle arrivée — ${cfg.clubName || 'XIG INTER GALACTIQUE'}` })
      .setDescription(description)
      .setFooter({ text: `${cfg.clubName || 'XIG INTER GALACTIQUE'} — GalactiqueBot` })
      .setTimestamp();

    await channel.send({ content: `${member}`, embeds: [embed] });
    console.log(`🙌 [WELCOME IG] envoyé pour ${member.id}`);
  } catch (err) {
    console.error('❌ Erreur welcome INTER GALACTIQUE :', err);
  }
}

async function sendWelcomeSupport(member) {
  try {
    const cfg = getGuildConfig(member.guild.id) || {};
    const welcomeId = cfg.welcomeChannelId;
    const supportChannelId = cfg.supportChannelId;
    const helpRoleId = cfg.helpRoleId;

    if (!welcomeId) {
      console.warn('⚠️ [WELCOME SUPPORT] welcomeChannelId manquant dans servers.json');
      return;
    }

    const channel = await member.guild.channels.fetch(welcomeId).catch(() => null);
    if (!channel) return;

    const total = member.guild.memberCount;

    const supportMention = supportChannelId ? `<#${supportChannelId}>` : '`#support`';
    const helpRoleMention = helpRoleId ? `<@&${helpRoleId}>` : '`@Aide`';

    const embed = new EmbedBuilder()
      .setColor(getEmbedColorForGuild(member.guild.id))
      .setAuthor({ name: 'Ho ! Un nouveau membre !' })
      .setDescription(
        `🐙 Bienvenue sur **${cfg.clubName || 'GalactiqueBot Support'}** ${member} !\n` +
        `Nous sommes désormais **${total}** membres. 🎉\n\n` +
        `» Demande de l’aide dans ${supportMention}.\n` +
        `Pense à mentionner ${helpRoleMention} pour accélérer la prise en charge.\n\n` +
        `If you speak English, you can also ask in ${supportMention}.`
      )
      .setFooter({ text: cfg.clubName || 'GalactiqueBot Support' })
      .setTimestamp();

    await channel.send({ content: `${member}`, embeds: [embed] });
    console.log(`🙌 [WELCOME SUPPORT] envoyé pour ${member.id}`);
  } catch (err) {
    console.error('❌ Erreur welcome SUPPORT :', err);
  }
}

/* ============================================================
   ARRIVÉES / DÉPARTS
============================================================ */

client.on('guildMemberAdd', async member => {
  // 🔹 INTER GALACTIQUE
  if (member.guild.id === IG_GUILD_ID) {
    await sendWelcomeInterGalactique(member);

    // Ajout automatique du rôle "recrue" si configuré
    try {
      const cfg = getGuildConfig(member.guild.id) || {};
      const recrueId = cfg.roles?.recrue;

      if (recrueId) {
        const role = member.guild.roles.cache.get(recrueId);
        if (role) {
          await member.roles.add(role, 'Arrivée serveur — rôle recrue automatique');
          console.log(`🎫 Rôle "recrue" ajouté à ${member.user.tag}`);
        } else {
          console.warn(`⚠️ Rôle "recrue" introuvable pour ${member.guild.id}`);
        }
      }
    } catch (err) {
      console.error('❌ Erreur ajout rôle recrue :', err);
    }

    await updateMemberCounter(IG_GUILD_ID);
    return;
  }

  // 🔹 SUPPORT
  if (member.guild.id === SUPPORT_GUILD_ID) {
    await sendWelcomeSupport(member);
    await updateMemberCounter(SUPPORT_GUILD_ID);
  }
});

client.on('guildMemberRemove', async member => {
  if (member.guild.id === SUPPORT_GUILD_ID) {
    await updateMemberCounter(SUPPORT_GUILD_ID);
  }
  if (member.guild.id === IG_GUILD_ID) {
    await updateMemberCounter(IG_GUILD_ID);
  }
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

    const msg = { content: '❌ Une erreur est survenue.', ephemeral: true };

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

process.on('unhandledRejection', (error) =>
  console.error('🚨 Promesse rejetée :', error)
);
process.on('uncaughtException', (error) =>
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
