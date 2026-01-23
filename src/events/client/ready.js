const { Events } = require("discord.js");
const { log } = require("../../core/logger");

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    log(`Bot connecté : ${client.user.tag} (XIG BLAUGRANA FC Staff)`);
  },
};
