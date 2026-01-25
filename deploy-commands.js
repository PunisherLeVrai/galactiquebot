// deploy-commands.js
require("dotenv").config();
const { REST, Routes } = require("discord.js");
const fs = require("fs");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("TOKEN ou CLIENT_ID manquant");
  process.exit(1);
}

const commands = [];
const cmdFiles = fs.readdirSync("./src/commands").filter(f => f.endsWith(".js"));

for (const file of cmdFiles) {
  const cmd = require(`./src/commands/${file}`);
  commands.push(cmd.data.toJSON());
}

(async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  console.log("Déploiement global des commandes...");
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("Déploiement terminé.");
})();
