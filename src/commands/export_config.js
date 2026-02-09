// src/commands/export_config.js
// Export complet servers.json — STAFF ONLY — ephemeral
// CommonJS — discord.js v14

const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require("discord.js");
const { exportAllConfig, getGuildConfig, CONFIG_PATH } = require("../core/guildConfig");

// Même helper que /setup et /pseudo
function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;

  const ids = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  if (!ids.length) return false; // si aucun rôle staff configuré, admin only
  return ids.some((id) => id && member.roles?.cache?.has?.(String(id)));
}

const pad2 = (n) => String(n).padStart(2, "0");
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("export_config")
    .setDescription("Export de la configuration du serveur (servers.json).")
    .setDefaultMemberPermissions(0n),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: "⛔", ephemeral: true });

      const cfg = getGuildConfig(interaction.guildId) || {};
      if (!isStaff(interaction.member, cfg)) {
        return interaction.reply({ content: "⛔ Accès réservé au STAFF.", ephemeral: true });
      }

      const data = exportAllConfig() || { version: 1, guilds: {} };
      const json = JSON.stringify(data, null, 2);

      const filename = `servers_${stamp()}.json`;
      const attachment = new AttachmentBuilder(Buffer.from(json, "utf8"), { name: filename });

      const guildCount = Object.keys(data?.guilds || {}).length;
      const g = data?.guilds?.[String(interaction.guildId)] || {};
      const auto = g?.automations || {};

      const hasDispoIds = Array.isArray(g.dispoMessageIds) && g.dispoMessageIds.length === 7;
      const hasCheckDispoCh = !!g.checkDispoChannelId;

      const cd = auto?.checkDispo || {};
      const rp = auto?.rappel || {};

      return interaction.reply({
        content:
          `✅ Export effectué.\n` +
          `Fichier : \`${filename}\`\n` +
          `Chemin interne : \`${CONFIG_PATH}\`\n` +
          `Guilds exportées: **${guildCount}**\n` +
          `checkDispoChannelId (ce serveur): **${hasCheckDispoCh ? "oui" : "non"}**\n` +
          `dispoMessageIds (ce serveur): **${hasDispoIds ? "oui (7)" : "non"}**\n` +
          `automations.global: **${auto?.enabled ? "ON" : "OFF"}**\n` +
          `auto.checkDispo: **${cd?.enabled ? "ON" : "OFF"}** — times: **${Array.isArray(cd?.times) ? cd.times.length : 0}**\n` +
          `auto.rappel: **${rp?.enabled ? "ON" : "OFF"}** — times: **${Array.isArray(rp?.times) ? rp.times.length : 0}**`,
        files: [attachment],
        ephemeral: true,
      });
    } catch {
      try {
        if (interaction.deferred) return interaction.editReply({ content: "⚠️" }).catch(() => {});
        if (!interaction.replied) return interaction.reply({ content: "⚠️", ephemeral: true }).catch(() => {});
        return interaction.followUp({ content: "⚠️", ephemeral: true }).catch(() => {});
      } catch {}
    }
  },
};
