// src/index.js
// XIG BLAUGRANA FC Staff — minimal multi-serveur
// - charge les commandes depuis src/commands/*.js
// - route interactionCreate (slash commands)
// - démarre le runner d'automatisation (pseudo hourly)

require("dotenv").config();
const { Client, GatewayIntentBits, Collection, Partials } = require("discord.js");
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
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // ⚠️ intent privilégié (scanner salon pseudo)
  ],
  partials: [Partials.Channel],
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
    } catch (e) {
      console.error(`[CMD_LOAD_ERROR] ${file}`, e);
    }
  }
}

// ---------- Ready ----------
client.once("ready", () => {
  console.log(`Bot connecté : ${client.user.tag} (XIG BLAUGRANA FC Staff)`);

  // ---------- Automation runner (pseudo) ----------
  // Toutes les heures (par défaut).
  // Le runner respecte cfg.automations.enabled === true
  try {
    startAutomationRunner(client, {
      everyMs: 60 * 60 * 1000, // 1h
      throttleMs: 850,
      scanLimit: 300,
      runOnStart: true,
    });
    console.log("[AUTO] Runner démarré (pseudo hourly).");
  } catch (e) {
    console.error("[AUTO] Impossible de démarrer le runner.", e);
  }
});

// ---------- Interactions (slash commands) ----------
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "⚠️", ephemeral: true }).catch(() => {});
      }
      return;
    }

    await cmd.execute(interaction, client);
  } catch (e) {
    console.error("[INTERACTION_ERROR]", e);
    try {
      if (interaction.deferred) {
        await interaction.editReply({ content: "⚠️" }).catch(() => {});
      } else if (!interaction.replied) {
        await interaction.reply({ content: "⚠️", ephemeral: true }).catch(() => {});
      } else {
        await interaction.followUp({ content: "⚠️", ephemeral: true }).catch(() => {});
      }
    } catch {}
  }
});

client.login(TOKEN);
