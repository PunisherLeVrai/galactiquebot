// deploy-nuke.js
// Supprime toutes les slash commands (GLOBAL ou GUILD si GUILD_ID est défini)
// CommonJS — discord.js v14

require("dotenv").config();
const { REST, Routes } = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || null; // facultatif

if (!TOKEN || !CLIENT_ID) {
  console.error("TOKEN ou CLIENT_ID manquant");
  process.exit(1);
}

(async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  const scopeLabel = GUILD_ID ? `GUILD ${GUILD_ID}` : "GLOBAL";

  console.log(`[NUKE] Suppression de TOUTES les commandes (${scopeLabel})...`);

  try {
    await rest.put(route, { body: [] });
    console.log(`[NUKE] OK — Toutes les commandes ${scopeLabel} ont été supprimées.`);
  } catch (e) {
    console.error("[NUKE_ERROR]", e);
    process.exit(1);
  }
})();
