require("dotenv").config();

const { REST, Routes } = require("discord.js");

async function main() {
  const token = process.env.TOKEN;
  const clientId = process.env.CLIENT_ID;

  if (!token || !clientId) {
    console.error("TOKEN ou CLIENT_ID manquant.");
    process.exit(1);
  }

  const rest = new REST({ version: "10" }).setToken(token);

  console.log("Suppression de toutes les commandes globales...");
  await rest.put(Routes.applicationCommands(clientId), { body: [] });
  console.log("OK: toutes les commandes globales ont été supprimées.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
