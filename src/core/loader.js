const fs = require("fs");
const path = require("path");
const { log, warn } = require("./logger");

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, cb);
    else if (entry.isFile() && entry.name.endsWith(".js")) cb(full);
  }
}

function loadCommands(client) {
  const commandsPath = path.join(__dirname, "..", "commands"); // => src/commands
  if (!fs.existsSync(commandsPath)) {
    warn("Dossier commands introuvable :", commandsPath);
    return;
  }

  walk(commandsPath, (file) => {
    const cmd = require(file);
    if (!cmd?.data?.name || typeof cmd.execute !== "function") {
      warn("Commande ignorée :", file);
      return;
    }
    client.commands.set(cmd.data.name, cmd);
    log("Commande chargée :", cmd.data.name);
  });
}

function loadEvents(client) {
  const eventsPath = path.join(__dirname, "..", "events"); // => src/events
  if (!fs.existsSync(eventsPath)) {
    warn("Dossier events introuvable :", eventsPath);
    return;
  }

  walk(eventsPath, (file) => {
    const evt = require(file);
    if (!evt?.name || typeof evt.execute !== "function") {
      warn("Event ignoré :", file);
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
