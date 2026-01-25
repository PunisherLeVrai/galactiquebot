require("dotenv").config();
const { Client, GatewayIntentBits, Collection } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

client.commands = new Collection();

// Chargement automatique des commandes
const fs = require("fs");
const path = require("path");
const cmdPath = path.join(__dirname, "commands");

if (fs.existsSync(cmdPath)) {
  for (const file of fs.readdirSync(cmdPath)) {
    if (!file.endsWith(".js")) continue;
    const cmd = require(path.join(cmdPath, file));
    client.commands.set(cmd.data.name, cmd);
  }
}

client.once("ready", () => {
  console.log(`Bot connecté : ${client.user.tag} (XIG BLAUGRANA FC Staff)`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
  } catch (e) {
    console.error("Erreur commande :", e);
    if (!interaction.replied) {
      await interaction.reply({ content: "Erreur.", ephemeral: true });
    }
  }
});

client.login(process.env.TOKEN);
