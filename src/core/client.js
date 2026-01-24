// src/core/client.js
// Client discord.js v14 — Intents complets pour Dispos + Pseudos
// CommonJS

const { Client, Collection, GatewayIntentBits, Partials } = require("discord.js");

function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,

      // Obligatoire pour /setup, roles, rappels, fermeture, posts, etc.
      GatewayIntentBits.GuildMembers,

      // Obligatoire pour boutons / interactions messages
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,

      // Pour scanner les pseudos dans le salon PSN/XBOX/EA
      GatewayIntentBits.MessageContent,

      // Pour confirmations MP
      GatewayIntentBits.DirectMessages,
    ],

    partials: [
      Partials.Channel,   // DM + salons partiels
      Partials.Message,   // messages supprimés / partiels
      Partials.Reaction,  // réactions partiels
      Partials.User,      // utilisateurs en DM
    ],
  });

  // Stock des commandes
  client.commands = new Collection();

  return client;
}

module.exports = { createClient };
