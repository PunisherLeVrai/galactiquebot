const { Client, GatewayIntentBits, Partials, Collection } = require("discord.js");

function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds
    ],
    partials: [Partials.Channel]
  });

  client.commands = new Collection();

  return client;
}

module.exports = { createClient };
