// deploy-nuke.js
require("dotenv").config();
const { REST, Routes } = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("TOKEN ou CLIENT_ID manquant");
  process.exit(1);
}

(async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  console.log("Suppression de TOUTES les commandes globales...");
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
  console.log("Toutes les commandes globales ont été supprimées.");
})();
