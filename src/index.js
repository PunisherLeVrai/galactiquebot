// src/index.js
// XIG BLAUGRANA FC Staff — minimal multi-serveur (discord.js v14)
// - charge les commandes depuis src/commands/*.js
// - route interactionCreate (slash commands)
// - démarre le runner d'automatisation (pseudo + check_dispo + reminder_dispo)

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Collection,
  Partials,
  Events,
  MessageFlags,
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const { startAutomationRunner } = require("./automations/runner");

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("TOKEN manquant");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,

    // ✅ fetch messages (scan pseudo + fetch message dispo)
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // ⚠️ privileged intent (à activer sur le Dev Portal)

    // ✅ lire réactions ✅/❌ sur les messages de dispo
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

client.commands = new Collection();

// ---------- Chargement auto des commandes (src/commands/*.js) ----------
const cmdDir = path.join(__dirname, "commands");

if (!fs.existsSync(cmdDir)) {
  console.warn("[WARN] Dossier src/commands introuvable (aucune commande chargée).");
} else {
  const files = fs.readdirSync(cmdDir).filter((f) => f.endsWith(".js"));

  for (const file of files) {
    try {
      const mod = require(path.join(cmdDir, file));

      if (!mod?.data?.name || typeof mod.execute !== "function") {
        console.warn(`[CMD_SKIP] ${file} (data/execute invalide)`);
        continue;
      }

      client.commands.set(mod.data.name, mod);
      console.log(`[CMD] Loaded: /${mod.data.name}`);
    } catch (e) {
      console.error(`[CMD_LOAD_ERROR] ${file}`, e);
    }
  }
}

// ---------- Ready (discord.js v14) ----------
client.once(Events.ClientReady, () => {
  console.log(`Bot connecté : ${client.user.tag} (XIG BLAUGRANA FC Staff)`);

  // ---------- Automation runner ----------
  // Déclenche:
  // - pseudo à HH:minute (cfg.automations.pseudo.minute)
  // - check_dispo aux times ["HH:MM", ...] (cfg.automations.checkDispo.times)
  // - reminder_dispo aux times ["HH:MM", ...] (cfg.automations.reminderDispo.times)
  try {
    startAutomationRunner(client, {
      loopMs: 20_000,        // tick toutes les 20s
      scanLimit: 300,        // scan pseudo channel
      throttleMsPseudo: 850, // anti rate-limit nicknames
      throttleMsCheck: 0,    // pas de throttle pour le report
      throttleMsReminder: 650, // throttle DM rappel (si besoin)
      runOnStart: true,
    });

    console.log("[AUTO] Runner démarré (pseudo + check_dispo + reminder_dispo).");
  } catch (e) {
    console.error("[AUTO] Impossible de démarrer le runner.", e);
  }
});

// ---------- Interactions (slash commands) ----------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const cmd = client.commands.get(interaction.commandName);

    if (!cmd) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: "⚠️ Commande inconnue.", flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
      return;
    }

    await cmd.execute(interaction, client);
  } catch (e) {
    console.error("[INTERACTION_ERROR]", e);

    try {
      if (interaction.deferred) {
        await interaction.editReply({ content: "⚠️ Erreur interaction." }).catch(() => {});
      } else if (!interaction.replied) {
        await interaction
          .reply({ content: "⚠️ Erreur interaction.", flags: MessageFlags.Ephemeral })
          .catch(() => {});
      } else {
        await interaction
          .followUp({ content: "⚠️ Erreur interaction.", flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    } catch {}
  }
});

client.login(TOKEN);
