const fs = require("fs");
const path = require("path");
const { log, warn } = require("./logger");

function loadCommands(client) {
  const commandsPath = path.join(__dirname, "..", "commands");

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".js")) {
        const cmd = require(full);
        if (!cmd?.data?.name || typeof cmd.execute !== "function") {
          warn("Commande ignorée :", full);
          continue;
        }
        client.commands.set(cmd.data.name, cmd);
        log("Commande chargée :", cmd.data.name);
      }
    }
  };

  if (fs.existsSync(commandsPath)) walk(commandsPath);
}

function loadEvents(client) {
  const eventsPath = path.join(__dirname, "..", "events");

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".js")) {
        const evt = require(full);
        if (!evt?.name || typeof evt.execute !== "function") {
          warn("Event ignoré :", full);
          continue;
        }

        if (evt.once)
          client.once(evt.name, (...args) => evt.execute(...args, client));
        else
          client.on(evt.name, (...args) => evt.execute(...args, client));

        log("Event chargé :", evt.name);
      }
    }
  };

  if (fs.existsSync(eventsPath)) walk(eventsPath);
}

async function loadAll(client) {
  loadCommands(client);
  loadEvents(client);
}

module.exports = { loadAll };
