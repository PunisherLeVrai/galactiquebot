require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("TOKEN et CLIENT_ID sont requis.");
  process.exit(1);
}

function collectCommands() {
  const commands = [];
  const commandsPath = path.join(process.cwd(), "src", "commands");

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".js")) {
        const cmd = require(full);
        if (cmd?.data?.toJSON) commands.push(cmd.data.toJSON());
      }
    }
  };

  walk(commandsPath);
  return commands;
}

(async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const commands = collectCommands();

  console.log(`Déploiement des commandes globales (${commands.length})...`);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("Déploiement terminé.");
})();
