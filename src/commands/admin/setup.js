const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { upsertGuildConfig } = require("../../core/configManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Initialise la configuration du serveur (multi-serveur).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName("team_name")
        .setDescription("Nom de l'équipe/structure pour ce serveur")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({ content: "Commande utilisable uniquement dans un serveur.", ephemeral: true });
    }

    const teamName = interaction.options.getString("team_name", true);

    const saved = upsertGuildConfig(interaction.guildId, {
      teamName,
      guildName: interaction.guild?.name || null,
    });

    await interaction.reply({
      content: `Setup enregistré ✅\nServeur: **${interaction.guild?.name}**\nTeam: **${saved.teamName}**`,
      ephemeral: true,
    });
  },
};
