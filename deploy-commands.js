require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optionnel

if (!TOKEN) throw new Error("TOKEN manquant");
if (!CLIENT_ID) throw new Error("CLIENT_ID manquant");

// Même liste que dans index.js (copier-coller)
const COMMANDS = [
  new SlashCommandBuilder().setName("ping").setDescription("pong"),
];

(async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  await rest.put(route, { body: COMMANDS.map((c) => c.toJSON()) });
  console.log(`[DEPLOY] OK (${GUILD_ID ? "GUILD" : "GLOBAL"})`);
})().catch((e) => {
  console.error("[DEPLOY_ERROR]", e);
  process.exit(1);
});
