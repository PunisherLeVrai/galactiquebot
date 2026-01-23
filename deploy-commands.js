require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");

function collectCommands() {
  const commands = [];
  const base = path.join(__dirname, "src", "commands");

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) {
        const cmd = require(full);
        if (cmd?.data?.toJSON) commands.push(cmd.data.toJSON());
      }
    }
  };

  walk(base);
  return commands;
}

async function main() {
  const token = process.env.TOKEN;
  const clientId = process.env.CLIENT_ID;

  const rest = new REST({ version: "10" }).setToken(token);
  const commands = collectCommands();

  console.log("Déploiement des commandes globales…");

  await rest.put(Routes.applicationCommands(clientId), {
    body: commands
  });

  console.log("Déploiement terminé.");
}

main().catch(console.error);
