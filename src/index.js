require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) throw new Error("TOKEN manquant");
if (!CLIENT_ID) throw new Error("CLIENT_ID manquant");

// 1) Définis tes commandes ici (tu ajoutes au fur et à mesure)
const COMMANDS = [
  new SlashCommandBuilder().setName("ping").setDescription("pong"),
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`[READY] ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "ping") {
      await interaction.reply({ content: "🏓", ephemeral: true });
      return;
    }

    // commande inconnue (après redeploy, etc.)
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "⚠️", ephemeral: true });
    }
  } catch (e) {
    console.error("[INTERACTION_ERROR]", e);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "⚠️", ephemeral: true });
      }
    } catch {}
  }
});

// Optionnel : auto-deploy global au démarrage (désactive si tu veux)
async function deployGlobalCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: COMMANDS.map((c) => c.toJSON()),
  });
  console.log("[DEPLOY] Global commands updated");
}

(async () => {
  // Si tu préfères déployer à la main, commente la ligne suivante
  await deployGlobalCommands();

  await client.login(TOKEN);
})();
