require("dotenv").config();
const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function loadCommands() {
  const cmds = [];
  const dir = path.join(__dirname, "src", "commands");
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;
    const cmd = require(path.join(dir, file));
    cmds.push(cmd.data.toJSON());
  }
  return cmds;
}

(async () => {
  const commands = await loadCommands();
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  console.log("Déploiement des commandes…");
  await rest.put(route, { body: commands });
  console.log("OK.");
})();
