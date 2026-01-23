const { getGuildConfig } = require("./configManager");

function requireGuildConfig(interaction) {
  if (!interaction.inGuild()) {
    throw new Error("Commande hors serveur");
  }

  const guildId = interaction.guild.id;
  const cfg = getGuildConfig(guildId);

  if (!cfg) {
    const err = new Error("SERVER_NOT_CONFIGURED");
    err.code = "SERVER_NOT_CONFIGURED";
    throw err;
  }

  return cfg;
}

function ensureChannel(interaction, channelKey) {
  const cfg = requireGuildConfig(interaction);
  const expected = cfg[channelKey];

  if (!expected) return cfg;

  if (interaction.channelId !== expected) {
    const err = new Error("WRONG_CHANNEL");
    err.code = "WRONG_CHANNEL";
    err.expectedChannelId = expected;
    throw err;
  }

  return cfg;
}

module.exports = {
  requireGuildConfig,
  ensureChannel,
};
