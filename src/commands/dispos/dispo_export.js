// src/commands/dispos/dispo_export.js
// Export JSON de la semaine de disponibilités
// CommonJS — discord.js v14

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getSession } = require("../../core/disposWeekStore");
const { getGuildConfig } = require("../../core/configManager");
const { normalizeConfig } = require("../../core/guildConfig");

const FLAGS_EPHEMERAL = 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dispo_export")
    .setDescription("Exporter les disponibilités de la semaine (JSON).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "Commande utilisable uniquement dans un serveur.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const cfgRaw = getGuildConfig(interaction.guildId);
    if (!cfgRaw) {
      return interaction.reply({
        content: "Serveur non configuré. Lance `/setup`.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const cfg = normalizeConfig(cfgRaw);

    const session = getSession(interaction.guildId);
    if (!session) {
      return interaction.reply({
        content: "Aucune semaine de disponibilités active.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const json = JSON.stringify(
      {
        guildId: interaction.guildId,
        exportedAt: new Date().toISOString(),
        session,
      },
      null,
      2
    );

    await interaction.reply({
      content: "📤 Export des disponibilités :",
      files: [
        {
          attachment: Buffer.from(json, "utf8"),
          name: `dispos_${interaction.guildId}.json`,
        },
      ],
      flags: FLAGS_EPHEMERAL,
    });
  },
};
