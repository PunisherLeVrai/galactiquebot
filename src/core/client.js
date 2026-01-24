// src/core/client.js
const { Client, Collection, GatewayIntentBits, Partials } = require("discord.js");

function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // utile pour roles/mentions/rappels
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages, // pour confirmations en MP si tu veux
    ],
    partials: [Partials.Channel], // nécessaire pour DM
  });

  client.commands = new Collection();

  return client;
}

module.exports = { createClient };
