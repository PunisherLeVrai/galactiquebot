require("dotenv").config();

const { REST, Routes } = require("discord.js");

async function main() {
  const token = process.env.TOKEN;
  const clientId = process.env.CLIENT_ID;

  const rest = new REST({ version: "10" }).setToken(token);

  console.log("Suppression de TOUTES les commandes globales…");

  await rest.put(Routes.applicationCommands(clientId), { body: [] });

  console.log("Toutes les commandes globales ont été supprimées.");
}

main().catch(console.error);
