// src/index.js
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
    GatewayIntentBits.GuildMembers, // requis pour roles/permissions + RoleSelectMenu
    GatewayIntentBits.GuildMessages, // requis pour scanner salon pseudo (plus tard)
    GatewayIntentBits.MessageContent, // requis pour lire le contenu des messages (scanner)
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection();

// Chargement auto des commandes (src/commands/*.js)
const cmdPath = path.join(__dirname, "commands");
if (fs.existsSync(cmdPath)) {
  const files = fs.readdirSync(cmdPath).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    try {
      const cmd = require(path.join(cmdPath, file));
      if (!cmd?.data?.name || typeof cmd.execute !== "function") continue;
      client.commands.set(cmd.data.name, cmd);
    } catch (e) {
      console.error(`[CMD_LOAD_ERROR] ${file}`, e);
    }
  }
}

client.once("ready", () => {
  console.log(`Bot connecté : ${client.user.tag} (XIG BLAUGRANA FC Staff)`);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) {
      // évite l'impression d'un "bug" si commande supprimée côté bot
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "⚠️", ephemeral: true });
        }
      } catch {}
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
