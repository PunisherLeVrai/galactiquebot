const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require("discord.js");
const { getFilePath } = require("../../core/configManager");
const fs = require("fs");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("export_config")
    .setDescription("Exporte la configuration multi-serveurs (servers.json)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const filePath = getFilePath();

    if (!fs.existsSync(filePath)) {
      return interaction.reply({
        content: "Le fichier servers.json est introuvable.",
        ephemeral: true
      });
    }

    const attachment = new AttachmentBuilder(filePath, { name: "servers.json" });

    await interaction.reply({
      content: "Voici la configuration actuelle :",
      files: [attachment],
      ephemeral: true
    });
  }
};
