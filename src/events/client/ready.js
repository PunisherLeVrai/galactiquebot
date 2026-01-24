// src/events/client/ready.js
// Démarrage central des automations (Dispos + Pseudos)
// CommonJS

const { log } = require("../../core/logger");

const { startAutomations: startDisposAutomations } = require("../../core/disposAutomation");
const { startPseudoSync } = require("../../core/pseudoSync");
const { startPseudoReminders } = require("../../core/pseudoAutomation");

module.exports = {
  name: "ready",
  once: true,
  execute(client) {
    log(`Bot connecté : ${client.user.tag} (XIG BLAUGRANA FC Staff)`);

    // ✅ Dispos (rapport/rappel/fermeture selon ta config)
    startDisposAutomations(client);

    // ✅ Pseudos : sync 1 fois par heure (silencieux)
    startPseudoSync(client);

    // ✅ Pseudos : 3 rappels / 24h (sans mention) — activable via config
    startPseudoReminders(client);
  },
};
