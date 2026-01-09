// index.js — VERSION FINALE STABLE
// ✔ Anti "Une erreur est survenue"
// ✔ Compatible planning (menus / boutons / modals)
// ✔ Compatible LOGE
// ✔ Compatible Railway (healthcheck)
// ✔ ZÉRO double ACK

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

const { getGlobalConfig, getGuildConfig } = require('./utils/config');
const { initScheduler } = require('./utils/scheduler');
const { ensureSnapshotDirectory } = require('./utils/paths');

/* ===================== SNAPSHOTS ===================== */
ensureSnapshotDirectory();

/* ===================== GUILDS ===================== */
const IG_GUILD_ID = '1392639720491581551';
const DOR_GUILD_ID = '1410246320324870217';

/* ===================== HEALTHCHECK ===================== */
let healthServer = null;

function startHealthcheck() {
  const port = process.env.PORT;
  if (!port || healthServer) return;

  healthServer = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });

  healthServer.listen(Number(port), '0.0.0.0', () => {
    console.log(`🌐 [HEALTH] OK sur :${port}`);
  });
}
startHealthcheck();

/* ===================== CLIENT ===================== */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User
  ]
});

/* ===================== COMMANDES ===================== */
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsPath, file));
  if (cmd?.data?.name && typeof cmd.execute === 'function') {
    client.commands.set(cmd.data.name, cmd);
  }
}

/* ===================== READY ===================== */
client.once('ready', async () => {
  const { botName = 'GalactiqueBot' } = getGlobalConfig() || {};

  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  console.log(`🟢 ${botName} prêt`);

  client.user.setPresence({
    activities: [{ name: 'Gestion planning', type: ActivityType.Watching }],
    status: 'online'
  });

  await new Promise(r => setTimeout(r, 1500));

  initScheduler(client, {
    targetGuildIds: new Set([IG_GUILD_ID, DOR_GUILD_ID])
  });

  console.log('✅ Scheduler initialisé (IG + DOR)');
});

/* ===================== INTERACTIONS ===================== */
client.on('interactionCreate', async (interaction) => {
  try {
    /* ===== MODALS (planning) ===== */
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('planning:modal_')) {
        const cmd = client.commands.get('planning');
        if (cmd?.handleModalSubmit) {
          await cmd.handleModalSubmit(interaction);
        }
      }
      return;
    }

    /* ===== BUTTONS / SELECT MENUS ===== */
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      const id = interaction.customId || '';

      /* ---- LOGE ---- */
      if (interaction.isButton() && id.startsWith('loge_accept:')) {
        const [, guildId, userId] = id.split(':');

        if (interaction.guild?.id !== guildId || interaction.user.id !== userId) {
          return interaction.reply({ content: '❌ Accès refusé.', ephemeral: true });
        }

        const disabled = interaction.message.components.map(row => {
          const r = row.toJSON();
          r.components = r.components.map(c => ({ ...c, disabled: true }));
          return r;
        });

        await interaction.update({
          content: `${interaction.message.content}\n\n✅ <@${userId}> a accepté le règlement.`,
          components: disabled
        });

        try {
          const cfg = getGuildConfig(guildId) || {};
          if (cfg.logChannelId) {
            const ch = await interaction.guild.channels.fetch(cfg.logChannelId).catch(() => null);
            if (ch?.isTextBased()) {
              ch.send(`📜 Règlement accepté : <@${userId}>`).catch(() => {});
            }
          }
        } catch {}

        return;
      }

      /* ---- PLANNING ---- */
      if (id.startsWith('planning:')) {
        const cmd = client.commands.get('planning');
        if (cmd?.handleComponentInteraction) {
          await cmd.handleComponentInteraction(interaction);
        }
        return;
      }

      return;
    }

    /* ===== SLASH COMMANDS ===== */
    if (!interaction.isChatInputCommand()) return;

    const cmd = client.commands.get(interaction.commandName);
    if (cmd) await cmd.execute(interaction);

  } catch (err) {
    console.error('❌ interactionCreate:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Une erreur est survenue.', ephemeral: true }).catch(() => {});
    }
  }
});

/* ===================== CLEAN EXIT ===================== */
process.on('SIGTERM', async () => {
  try { healthServer?.close(); } catch {}
  try { await client.destroy(); } catch {}
});

/* ===================== LOGIN ===================== */
if (!process.env.TOKEN) {
  console.error('❌ TOKEN manquant');
  process.exit(1);
}

client.login(process.env.TOKEN);
