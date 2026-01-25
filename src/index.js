// src/index.js
require("dotenv").config();
const { Client, GatewayIntentBits, Collection, Partials } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // ✅ requis pour RoleSelectMenu + permissions/roles
  ],
  partials: [Partials.Channel], // ✅ safe (DM/partiels, ne gêne pas)
});

client.commands = new Collection();

// Chargement automatique des commandes (fichiers .js dans src/commands)
const fs = require("fs");
const path = require("path");
const cmdPath = path.join(__dirname, "commands");

if (fs.existsSync(cmdPath)) {
  for (const file of fs.readdirSync(cmdPath)) {
    if (!file.endsWith(".js")) continue;

    const cmd = require(path.join(cmdPath, file));
    if (!cmd?.data?.name || typeof cmd.execute !== "function") continue;

    client.commands.set(cmd.data.name, cmd);
  }
}

client.once("ready", () => {
  console.log(`Bot connecté : ${client.user.tag} (XIG BLAUGRANA FC Staff)`);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;

    await cmd.execute(interaction, client);
  } catch (e) {
    console.error("Erreur commande :", e);
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

if (!process.env.TOKEN) {
  console.error("TOKEN manquant");
  process.exit(1);
}

client.login(process.env.TOKEN);
