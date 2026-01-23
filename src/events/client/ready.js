// src/events/client/ready.js
// Event ready + démarrage automations
// CommonJS — discord.js v14

const { log, warn } = require("../../core/logger");
const { startAutomations } = require("../../core/disposAutomation");

module.exports = {
  name: "ready",
  once: true,
  execute(client) {
    try {
      log(`Bot connecté : ${client.user.tag} (XIG BLAUGRANA FC Staff)`);

      // Lance la boucle des automations (toutes les 60s)
      startAutomations(client);

      log("Automations: loop active");
    } catch (err) {
      warn("Erreur dans ready:", err);
    }
  },
};
