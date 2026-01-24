// src/core/loader.js
// Loader commandes + events — CommonJS
// ✅ Walk récursif
// ✅ Clear require cache (utile en dev / redéploiements)
// ✅ Tolère exports { default: ... } si jamais
// ✅ Logs propres

const fs = require("fs");
const path = require("path");
const { log, warn } = require("./logger");

function walk(dir, onFile) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else if (entry.isFile() && entry.name.endsWith(".js")) onFile(full);
  }
}

function safeRequire(full) {
  try {
    // en dev, évite des collisions / vieux modules
    delete require.cache[require.resolve(full)];
  } catch {}
  try {
    const mod = require(full);
    return mod?.default || mod;
  } catch (e) {
    warn("Require échoué :", full, e?.message || e);
    return null;
  }
}

function loadCommands(client) {
  const commandsPath = path.join(__dirname, "..", "commands");
  if (!fs.existsSync(commandsPath)) return;

  walk(commandsPath, (full) => {
    const cmd = safeRequire(full);
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
    const evt = safeRequire(full);
    if (!evt?.name || typeof evt.execute !== "function") {
      warn("Event ignoré :", full);
      return;
    }

    // Signature standard: execute(...args, client)
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
