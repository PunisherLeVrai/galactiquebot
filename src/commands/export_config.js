// src/commands/export_config.js
// Export complet servers.json en PJ — admin only — ephemeral
// CommonJS — discord.js v14

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { exportAllConfig } = require("../core/guildConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("export_config")
    .setDescription("Export de la config (servers.json).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: "⛔", ephemeral: true });
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "⛔", ephemeral: true });
      }

      const data = exportAllConfig();
      const json = JSON.stringify(data, null, 2);
      const buffer = Buffer.from(json, "utf8");

      const now = new Date();
      const yyyy = String(now.getFullYear());
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const mi = String(now.getMinutes()).padStart(2, "0");

      await interaction.reply({
        content: `✅ \`${yyyy}-${mm}-${dd}_${hh}-${mi}\``,
        files: [{ attachment: buffer, name: `servers_${yyyy}-${mm}-${dd}_${hh}-${mi}.json` }],
        ephemeral: true,
      });
    } catch (e) {
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "⚠️", ephemeral: true });
        } else {
          await interaction.followUp({ content: "⚠️", ephemeral: true });
        }
      } catch {}
    }
  },
};
