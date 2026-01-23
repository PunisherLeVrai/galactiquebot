// src/commands/admin/export_config.js
// Export de la config complète (sans commande "show")

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { exportAll, CONFIG_PATH } = require("../../core/configManager");

const FLAGS_EPHEMERAL = 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("export_config")
    .setDescription("Exporter le fichier de configuration (servers.json).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "Commande serveur uniquement.", flags: FLAGS_EPHEMERAL });
    }

    const data = exportAll();
    const content = JSON.stringify(data, null, 2);

    // Envoi en pièce jointe (plus propre que coller 2000 lignes)
    const buffer = Buffer.from(content, "utf8");

    await interaction.reply({
      content: `Export généré depuis: \`${CONFIG_PATH}\``,
      files: [{ attachment: buffer, name: "servers.json" }],
      flags: FLAGS_EPHEMERAL,
    });
  },
};
