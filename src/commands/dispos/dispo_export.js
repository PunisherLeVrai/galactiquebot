const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require("discord.js");
const { requireStaff, requireGuildConfig } = require("../../core/guildConfig");
const { exportGuild } = require("../../core/disposStore");

const FLAGS_EPHEMERAL = 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dispo_export")
    .setDescription("Exporte les données dispos de ce serveur (JSON).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const cfg = await requireGuildConfig(interaction);
    if (!cfg) return;

    const staffOk = await requireStaff(interaction);
    if (!staffOk) return;

    const data = exportGuild(interaction.guildId);
    const buffer = Buffer.from(JSON.stringify(data, null, 2), "utf8");
    const file = new AttachmentBuilder(buffer, { name: `dispos-${interaction.guildId}.json` });

    await interaction.reply({
      content: "Export DISPOS :",
      files: [file],
      flags: FLAGS_EPHEMERAL,
    });
  },
};
