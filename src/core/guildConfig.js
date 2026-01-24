// src/commands/admin/export_config.js
// Export complet de la config (servers.json) en pièce jointe
// ✅ Admin only
// ✅ Ephemeral
// ✅ Compatible mobile/PC (fichier JSON à télécharger)
// ✅ Sécurisé : pas besoin d'afficher le chemin Railway
// CommonJS — discord.js v14

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { exportAllConfig } = require("../../core/guildConfig");

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

      // double sécurité (au cas où)
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "⛔", ephemeral: true });
      }

      const data = exportAllConfig();

      const json = JSON.stringify(data, null, 2);
      const buffer = Buffer.from(json, "utf8");

      // Nom de fichier + timestamp lisible
      const now = new Date();
      const yyyy = String(now.getFullYear());
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const mi = String(now.getMinutes()).padStart(2, "0");

      await interaction.reply({
        content: `✅ Export OK — \`${yyyy}-${mm}-${dd}_${hh}-${mi}\``,
        files: [{ attachment: buffer, name: `servers_${yyyy}-${mm}-${dd}_${hh}-${mi}.json` }],
        ephemeral: true,
      });
    } catch (err) {
      console.error("[EXPORT_CONFIG_ERROR]", err);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: "⚠️", ephemeral: true });
        } else {
          await interaction.reply({ content: "⚠️", ephemeral: true });
        }
      } catch {}
    }
  },
};
