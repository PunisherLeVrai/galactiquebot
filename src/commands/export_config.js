// src/commands/export_config.js
// Export complet servers.json — STAFF ONLY — ephemeral
// CommonJS — discord.js v14

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { exportAllConfig, getGuildConfig, CONFIG_PATH } = require("../core/guildConfig");

// Même helper que /setup et /pseudo
function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;

  const ids = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  return ids.some((id) => id && member.roles.cache.has(String(id)));
}

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
    .setDescription("Export de la configuration du serveur (servers.json).")
    // IMPORTANT: sinon seuls les admins voient la commande.
    // Le vrai contrôle est fait par isStaff() ci-dessous.
    .setDefaultMemberPermissions(0n),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: "⛔", ephemeral: true });

      const cfg = getGuildConfig(interaction.guildId) || {};

      // ✅ STAFF ONLY
      if (!isStaff(interaction.member, cfg)) {
        return interaction.reply({ content: "⛔ Accès réservé au STAFF.", ephemeral: true });
      }

      const data = exportAllConfig();
      const json = JSON.stringify(data, null, 2);
      const buffer = Buffer.from(json, "utf8");

      const ts = stamp(new Date());
      const filename = `servers_${ts}.json`;

      return interaction.reply({
        content: `✅ Export effectué.\nFichier : \`${filename}\`\nChemin interne : \`${CONFIG_PATH}\``,
        files: [{ attachment: buffer, name: filename }],
        ephemeral: true,
      });
    } catch {
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
