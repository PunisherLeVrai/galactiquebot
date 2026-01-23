const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require("discord.js");
const { exportAll } = require("../../core/configManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("export_config")
    .setDescription("Exporte toute la configuration (servers.json).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const data = exportAll();
    const buffer = Buffer.from(JSON.stringify(data, null, 2), "utf8");
    const file = new AttachmentBuilder(buffer, { name: "servers.json" });

    await interaction.reply({
      content: "Voici l’export complet de la configuration :",
      files: [file],
      ephemeral: true,
    });
  },
};
