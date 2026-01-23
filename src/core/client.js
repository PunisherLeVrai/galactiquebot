const { Client, GatewayIntentBits, Collection } = require("discord.js");

function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds
      // Intents minimum pour slash commands (RAM-friendly)
    ],
  });

  client.commands = new Collection();

  return client;
}

module.exports = { createClient }
