const { log } = require("../../core/logger");

module.exports = {
  name: "ready",
  once: true,
  execute(client) {
    log(`Bot connecté : ${client.user.tag} (XIG BLAUGRANA FC Staff)`);
  },
};
