// src/events/client/ready.js
// Démarrage central des automations (Dispos + Pseudos)
// ✅ Safe: try/catch + anti double-start
// CommonJS

const { log, warn } = require("../../core/logger");

const { startAutomations: startDisposAutomations } = require("../../core/disposAutomation");
const { startPseudoSync } = require("../../core/pseudoSync");
const { startPseudoReminders } = require("../../core/pseudoAutomation");

let started = false;

module.exports = {
  name: "ready",
  once: true,
  execute(client) {
    if (started) return;
    started = true;

    try {
      log(`Bot connecté : ${client.user.tag} (XIG BLAUGRANA FC Staff)`);

      // ✅ Dispos (rapport/rappel/fermeture selon ta config)
      try {
        startDisposAutomations(client);
      } catch (e) {
        warn("[DISPOS_AUTOMATIONS_START_ERROR]", e);
      }

      // ✅ Pseudos : sync 1 fois par heure (silencieux)
      try {
        startPseudoSync(client);
      } catch (e) {
        warn("[PSEUDO_SYNC_START_ERROR]", e);
      }

      // ✅ Pseudos : 3 rappels / 24h (sans mention) — activable via config
      try {
        startPseudoReminders(client);
      } catch (e) {
        warn("[PSEUDO_REMINDERS_START_ERROR]", e);
      }
    } catch (e) {
      warn("[READY_FATAL_ERROR]", e);
    }
  },
};
