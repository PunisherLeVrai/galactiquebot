// src/core/loader.js
// Chargeur commandes + events (récursif)
// CommonJS — discord.js v14

const fs = require("fs");
const path = require("path");
const { log, warn } = require("./logger");

function walkJsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

function safeRequire(modulePath) {
  try {
    // éviter cache en dev si besoin (optionnel)
    // delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
  } catch (e) {
    warn("Require failed:", modulePath, e?.message || e);
    return null;
  }
}

function loadCommands(client) {
  const commandsDir = path.join(__dirname, "..", "commands");
  const files = walkJsFiles(commandsDir);

  let ok = 0;
  let skipped = 0;

  for (const file of files) {
    const cmd = safeRequire(file);
    if (!cmd?.data?.name || typeof cmd.execute !== "function") {
      skipped++;
      continue;
    }
    client.commands.set(cmd.data.name, cmd);
    ok++;
  }

  log(`[LOADER] Commands loaded: ${ok} (skipped ${skipped})`);
}

function loadEvents(client) {
  const eventsDir = path.join(__dirname, "..", "events");
  const files = walkJsFiles(eventsDir);

  let ok = 0;
  let skipped = 0;

  for (const file of files) {
    const evt = safeRequire(file);
    if (!evt?.name || typeof evt.execute !== "function") {
      skipped++;
      continue;
    }

    // evt.execute(interaction, client) pattern
    const handler = (...args) => evt.execute(...args, client);

    if (evt.once) client.once(evt.name, handler);
    else client.on(evt.name, handler);

    ok++;
  }

  log(`[LOADER] Events loaded: ${ok} (skipped ${skipped})`);
}

async function loadAll(client) {
  loadCommands(client);
  loadEvents(client);
}

module.exports = {
  loadAll,
  loadCommands,
  loadEvents,
};
