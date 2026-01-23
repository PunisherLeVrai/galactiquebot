require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");

function walkJsFiles(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsFiles(full, cb);
    else if (entry.isFile() && entry.name.endsWith(".js")) cb(full);
  }
}

function collectCommands() {
  const base = path.join(__dirname, "src", "commands");
  if (!fs.existsSync(base)) throw new Error(`Dossier introuvable: ${base}`);

  const commands = [];
  walkJsFiles(base, (file) => {
    const cmd = require(file);
    if (cmd?.data?.toJSON) commands.push(cmd.data.toJSON());
  });

  return commands;
}

async function main() {
  const token = process.env.TOKEN;
  const clientId = process.env.CLIENT_ID;

  if (!token || !clientId) {
    console.error("TOKEN ou CLIENT_ID manquant.");
    process.exit(1);
  }

  const rest = new REST({ version: "10" }).setToken(token);
  const body = collectCommands();

  console.log(`Déploiement des commandes globales (${body.length})...`);
  await rest.put(Routes.applicationCommands(clientId), { body });
  console.log("Déploiement terminé.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
