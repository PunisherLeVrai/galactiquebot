// src/commands/admin/export_config.js
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { exportAllConfig, CONFIG_PATH } = require("../../core/guildConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("export_config")
    .setDescription("Export de la config (servers.json).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const data = exportAllConfig();

    // On renvoie en fichier JSON (pratique sur téléphone/PC)
    const buffer = Buffer.from(JSON.stringify(data, null, 2), "utf8");

    await interaction.reply({
      content: `Export OK.\nChemin local serveur: \`${CONFIG_PATH}\``,
      files: [{ attachment: buffer, name: "servers.json" }],
      ephemeral: true,
    });
  },
};
