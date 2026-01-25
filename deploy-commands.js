// deploy-commands.js
// Déploie les slash commands (GLOBAL ou GUILD si GUILD_ID est défini)
// CommonJS — discord.js v14

require("dotenv").config();
const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || null; // optionnel

if (!TOKEN || !CLIENT_ID) {
  console.error("TOKEN ou CLIENT_ID manquant");
  process.exit(1);
}

const commands = [];
const cmdDir = path.join(__dirname, "src", "commands");

if (!fs.existsSync(cmdDir)) {
  console.error("Dossier src/commands introuvable");
  process.exit(1);
}

const cmdFiles = fs.readdirSync(cmdDir).filter((f) => f.endsWith(".js"));

for (const file of cmdFiles) {
  const modPath = path.join(cmdDir, file);

  let cmd;
  try {
    cmd = require(modPath);
  } catch (e) {
    console.warn(`[DEPLOY] require failed: ${file}`, e?.message || e);
    continue;
  }

  if (!cmd?.data?.name || typeof cmd.execute !== "function") {
    console.warn(`[DEPLOY] skipped (invalid command): ${file}`);
    continue;
  }

  commands.push(cmd.data.toJSON());
}

(async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  const scopeLabel = GUILD_ID ? `GUILD ${GUILD_ID}` : "GLOBAL";

  console.log(`[DEPLOY] Déploiement ${scopeLabel} des commandes...`);
  await rest.put(route, { body: commands });
  console.log(`[DEPLOY] Terminé. (${commands.length} commandes)`);
})().catch((e) => {
  console.error("[DEPLOY_ERROR]", e);
  process.exit(1);
});
