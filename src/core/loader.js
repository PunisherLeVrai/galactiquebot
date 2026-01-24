// src/core/loader.js
const fs = require("fs");
const path = require("path");
const { log, warn } = require("./logger");

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else if (entry.isFile() && entry.name.endsWith(".js")) onFile(full);
  }
}

function loadCommands(client) {
  const commandsPath = path.join(__dirname, "..", "commands");
  if (!fs.existsSync(commandsPath)) return;

  walk(commandsPath, (full) => {
    const cmd = require(full);

    if (!cmd?.data?.name || typeof cmd.execute !== "function") {
      warn("Commande ignorée :", full);
      return;
    }

    client.commands.set(cmd.data.name, cmd);
    log("Commande chargée :", cmd.data.name);
  });
}

function loadEvents(client) {
  const eventsPath = path.join(__dirname, "..", "events");
  if (!fs.existsSync(eventsPath)) return;

  walk(eventsPath, (full) => {
    const evt = require(full);

    if (!evt?.name || typeof evt.execute !== "function") {
      warn("Event ignoré :", full);
      return;
    }

    if (evt.once) client.once(evt.name, (...args) => evt.execute(...args, client));
    else client.on(evt.name, (...args) => evt.execute(...args, client));

    log("Event chargé :", evt.name);
  });
}

async function loadAll(client) {
  loadCommands(client);
  loadEvents(client);
}

module.exports = { loadAll };
