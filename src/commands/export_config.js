// src/commands/export_config.js
// Export complet servers.json en PJ — admin only — ephemeral
// CommonJS — discord.js v14

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { exportAllConfig, CONFIG_PATH } = require("../core/guildConfig");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function stamp(d = new Date()) {
  const yyyy = String(d.getFullYear());
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("export_config")
    .setDescription("Export de la config (servers.json).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ content: "⛔", ephemeral: true });
      }

      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "⛔", ephemeral: true });
      }

      const data = exportAllConfig(); // déjà normalisé côté guildConfig.js
      const json = JSON.stringify(data, null, 2);
      const buffer = Buffer.from(json, "utf8");

      const ts = stamp(new Date());
      const filename = `servers_${ts}.json`;

      return interaction.reply({
        content: `✅ \`${ts}\`\n📄 \`${filename}\`\n🗂️ \`${CONFIG_PATH}\``,
        files: [{ attachment: buffer, name: filename }],
        ephemeral: true,
      });
    } catch (e) {
      try {
        if (interaction.deferred) {
          await interaction.editReply({ content: "⚠️" }).catch(() => {});
        } else if (!interaction.replied) {
          await interaction.reply({ content: "⚠️", ephemeral: true }).catch(() => {});
        } else {
          await interaction.followUp({ content: "⚠️", ephemeral: true }).catch(() => {});
        }
      } catch {}
    }
  },
};
