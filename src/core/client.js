// src/core/client.js
// Création du client Discord (discord.js v14)
// CommonJS — optimisé RAM (intents minimum nécessaires)

const { Client, Collection, GatewayIntentBits, Partials } = require("discord.js");

function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,          // nécessaire pour interactions (slash/buttons)
      GatewayIntentBits.GuildMembers,    // nécessaire pour calculer non répondants (rôle Joueur)
    ],
    partials: [
      Partials.Channel,                  // sécurité: accès à certains channels partiels
    ],
  });

  // Collection commandes
  client.commands = new Collection();

  return client;
}

module.exports = { createClient };
