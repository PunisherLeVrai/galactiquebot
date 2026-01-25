// src/index.js
// XIG BLAUGRANA FC Staff — minimal multi-serveur
// - charge les commandes depuis src/commands/*.js
// - route interactionCreate (slash commands)
// - intents prêts pour le scan du salon pseudo (messageCreate) plus tard

require("dotenv").config();
const { Client, GatewayIntentBits, Collection, Partials } = require("discord.js");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("TOKEN manquant");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // requis pour rôles/permissions + RoleSelectMenu
    GatewayIntentBits.GuildMessages, // requis pour scanner un salon (plus tard)
    GatewayIntentBits.MessageContent, // requis pour lire le contenu (scanner) ⚠️ intent privilégié
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
});

// ---------- Interactions (slash commands) ----------
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) {
      // évite "Unknown interaction" si la commande a été retirée côté bot
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
