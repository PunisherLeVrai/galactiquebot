// src/core/client.js
// Client Discord.js v14 — Intégration complète Dispos + Pseudos + Automatisations
// Optimisé et corrigé (sans ajout inutile)

const { Client, Collection, GatewayIntentBits, Partials } = require("discord.js");

function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,

      // Requis pour : /setup, rôles staff/joueur/essai, pseudo sync,
      // rappels/rapports, fermeture, reopen, mentions non répondants
      GatewayIntentBits.GuildMembers,

      // Requis pour interactions boutons / menus (dispos, setup)
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,

      // Requis pour lire les messages dans le salon PSN/XBOX/EA
      // (scan pseudo)
      GatewayIntentBits.MessageContent,

      // Confirmation MP
      GatewayIntentBits.DirectMessages,
    ],

    partials: [
      Partials.Channel,    // nécessaire pour DM
      Partials.Message,    // messages partiels (utile si auto-scan)
      Partials.Reaction,   // réactions partielles
      Partials.User,       // nécessaire pour DM + interactions partielles
      Partials.GuildMember // nécessaire si auto-fetch (pseudo sync)
    ],
  });

  /** Collection des commandes slash chargées */
  client.commands = new Collection();

  /** Cooldowns génériques si tu en as besoin plus tard */
  client.cooldowns = new Collection();

  return client;
}

module.exports = { createClient };
