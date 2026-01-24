// deploy-commands.js
// Enregistre (ou supprime) les slash commands discord.js v14
// ✅ Charge récursivement src/commands
// ✅ Clear require cache (évite vieux exports en dev/redeploy)
// ✅ Support exports { default: ... }
// ✅ Option NUKE=true pour tout supprimer
// CommonJS

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optionnel (si défini => deploy serveur)
const NUKE = String(process.env.NUKE || "").toLowerCase() === "true";

if (!TOKEN) {
  console.error("[DEPLOY] Missing env TOKEN");
  process.exit(1);
}
if (!CLIENT_ID) {
  console.error("[DEPLOY] Missing env CLIENT_ID");
  process.exit(1);
}

function walkJsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

function safeRequire(file) {
  try {
    delete require.cache[require.resolve(file)];
  } catch {}
  try {
    const mod = require(file);
    return mod?.default || mod;
  } catch (e) {
    console.warn("[DEPLOY] require failed:", file, e?.message || e);
    return null;
  }
}

function loadCommandsJSON() {
  const commandsDir = path.join(__dirname, "src", "commands");
  const files = walkJsFiles(commandsDir);

  const commands = [];
  let ok = 0;
  let skipped = 0;

  for (const file of files) {
    const mod = safeRequire(file);
    if (!mod?.data?.name || typeof mod.execute !== "function") {
      skipped++;
      continue;
    }

    try {
      commands.push(mod.data.toJSON());
      ok++;
    } catch (e) {
      console.warn("[DEPLOY] toJSON failed:", file, e?.message || e);
      skipped++;
    }
  }

  console.log(`[DEPLOY] Commands found: ${ok} (skipped ${skipped})`);
  return commands;
}

async function main() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  // Route: guild ou global
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  const scopeLabel = GUILD_ID ? `GUILD ${GUILD_ID}` : "GLOBAL";

  if (NUKE) {
    console.log(`[DEPLOY] NUKE=true -> clearing commands (${scopeLabel})...`);
    await rest.put(route, { body: [] });
    console.log(`[DEPLOY] Commands cleared (${scopeLabel}).`);
    return;
  }

  const commands = loadCommandsJSON();

  console.log(`[DEPLOY] Deploying ${commands.length} commands (${scopeLabel})...`);
  await rest.put(route, { body: commands });
  console.log(`[DEPLOY] Deploy complete (${scopeLabel}).`);
}

main().catch((err) => {
  console.error("[DEPLOY_ERROR]", err);
  process.exit(1);
});
