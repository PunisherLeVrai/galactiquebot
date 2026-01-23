const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(process.cwd(), "config", "servers.json");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("export_config")
    .setDescription("Exporte la config du serveur courant")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({ content: "Commande utilisable uniquement sur un serveur.", ephemeral: true });
    }

    if (!fs.existsSync(CONFIG_FILE)) {
      return interaction.reply({ content: "Aucune config trouvée.", ephemeral: true });
    }

    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    let all;
    try {
      all = JSON.parse(raw);
    } catch {
      return interaction.reply({ content: "Config illisible (JSON invalide).", ephemeral: true });
    }

    const cfg = all[guildId];
    if (!cfg) {
      return interaction.reply({ content: "Aucune config pour ce serveur.", ephemeral: true });
    }

    const content = "```json\n" + JSON.stringify(cfg, null, 2) + "\n```";
    await interaction.reply({ content, ephemeral: true });
  },
};
