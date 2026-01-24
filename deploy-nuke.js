// purge-global-commands.js
// Suppression TOTALE des commandes globales (pas guild)
// CommonJS — discord.js v14

require("dotenv").config();
const { REST, Routes } = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) {
  console.error("[PURGE_GLOBAL] TOKEN manquant dans .env");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("[PURGE_GLOBAL] CLIENT_ID manquant dans .env");
  process.exit(1);
}

(async () => {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    console.log(`[PURGE_GLOBAL] Suppression de TOUTES les commandes globales pour application ${CLIENT_ID}...`);

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: [] }
    );

    console.log("[PURGE_GLOBAL] OK — Toutes les commandes globales ont été supprimées.");
  } catch (err) {
    console.error("[PURGE_GLOBAL] ERREUR lors de la suppression :", err);
  }
})();
