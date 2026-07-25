// src/index.js
// PROSYNC — Bot Discord multi-serveur de gestion Club Pro
// CommonJS — discord.js v14

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
const { ensureGlobalSetupListener } = require("./commands/setup");

const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  console.error("[PROSYNC] TOKEN manquant.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction,
    Partials.User,
  ],
});

client.commands = new Collection();

// --------------------------------------------------
// Chargement automatique des commandes
// --------------------------------------------------
const cmdDir = path.join(__dirname, "commands");

if (!fs.existsSync(cmdDir)) {
  console.warn("[PROSYNC] Dossier src/commands introuvable.");
} else {
  const files = fs.readdirSync(cmdDir).filter((file) => file.endsWith(".js"));

  for (const file of files) {
    try {
      const command = require(path.join(cmdDir, file));

      if (!command?.data?.name || typeof command.execute !== "function") {
        console.warn(`[PROSYNC][CMD_SKIP] ${file}`);
        continue;
      }

      client.commands.set(command.data.name, command);
      console.log(`[PROSYNC][CMD] /${command.data.name}`);
    } catch (error) {
      console.error(`[PROSYNC][CMD_LOAD_ERROR] ${file}`, error);
    }
  }
}

// --------------------------------------------------
// Ready
// --------------------------------------------------
client.once(Events.ClientReady, () => {
  console.log(`[PROSYNC] Connecté : ${client.user.tag}`);

  try {
    ensureGlobalSetupListener(client);
    console.log("[PROSYNC][SETUP] Listener global prêt.");
  } catch (error) {
    console.error("[PROSYNC][SETUP] Installation du listener impossible.", error);
  }

  try {
    startAutomationRunner(client, {
      loopMs: 20_000,
      scanLimit: 300,
      throttleMsPseudo: 850,
      throttleMsCheck: 0,
      throttleMsRappel: 650,
      throttleMsAvertissement: 250,
      runOnStart: true,
    });

    console.log(
      "[PROSYNC][AUTO] Runner démarré : pseudo, check_dispo, rappel_dispo, avertissement."
    );
  } catch (error) {
    console.error("[PROSYNC][AUTO] Démarrage du runner impossible.", error);
  }
});

// --------------------------------------------------
// Slash commands
// Les composants de /setup sont gérés par son listener global.
// --------------------------------------------------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "⚠️ Commande inconnue.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
      return;
    }

    await command.execute(interaction, client);
  } catch (error) {
    console.error("[PROSYNC][INTERACTION_ERROR]", error);

    try {
      if (interaction.deferred) {
        await interaction
          .editReply({ content: "⚠️ Erreur interaction." })
          .catch(() => {});
      } else if (!interaction.replied) {
        await interaction
          .reply({
            content: "⚠️ Erreur interaction.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      } else {
        await interaction
          .followUp({
            content: "⚠️ Erreur interaction.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
    } catch {}
  }
});

client.login(TOKEN);
