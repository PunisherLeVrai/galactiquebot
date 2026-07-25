// src/commands/export_config.js
// Export complet de la configuration PROSYNC
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
  MessageFlags,
} = require("discord.js");

const {
  exportAllConfig,
  getGuildConfig,
  CONFIG_PATH,
} = require("../core/guildConfig");

function isStaff(member, config) {
  if (!member) return false;

  if (
    member.permissions?.has?.(
      PermissionFlagsBits.Administrator
    )
  ) {
    return true;
  }

  const roleIds = Array.isArray(config?.staffRoleIds)
    ? config.staffRoleIds
    : [];

  return roleIds.some((roleId) =>
    member.roles?.cache?.has?.(String(roleId))
  );
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function stamp(date = new Date()) {
  return (
    `${date.getFullYear()}-` +
    `${pad2(date.getMonth() + 1)}-` +
    `${pad2(date.getDate())}_` +
    `${pad2(date.getHours())}-` +
    `${pad2(date.getMinutes())}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("export_config")
    .setDescription(
      "Exporter la configuration PROSYNC complète."
    )
    .setDefaultMemberPermissions(0n),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: "⛔ Commande disponible uniquement sur un serveur.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const config =
        getGuildConfig(interaction.guildId) || {};

      if (!isStaff(interaction.member, config)) {
        return interaction.reply({
          content: "⛔ Accès réservé au STAFF.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const data = exportAllConfig();
      const json = JSON.stringify(data, null, 2);

      const filename = `prosync_servers_${stamp()}.json`;

      const attachment = new AttachmentBuilder(
        Buffer.from(json, "utf8"),
        { name: filename }
      );

      const guildCount = Object.keys(
        data.guilds || {}
      ).length;

      const guildConfig =
        data.guilds?.[String(interaction.guildId)] || {};

      const automations = guildConfig.automations || {};
      const check = automations.checkDispo || {};
      const rappel = automations.rappel || {};
      const avertissement =
        automations.avertissement || {};

      return interaction.reply({
        content:
          `✅ Export PROSYNC effectué.\n` +
          `Fichier : \`${filename}\`\n` +
          `Chemin interne : \`${CONFIG_PATH}\`\n` +
          `Serveurs exportés : **${guildCount}**\n\n` +
          `Global : **${automations.enabled ? "ON" : "OFF"}**\n` +
          `CheckDispo : **${check.enabled ? "ON" : "OFF"}** — ` +
          `horaires : **${Array.isArray(check.times) ? check.times.length : 0}**\n` +
          `Rappel : **${rappel.enabled ? "ON" : "OFF"}** — ` +
          `horaires : **${Array.isArray(rappel.times) ? rappel.times.length : 0}**\n` +
          `Avertissement : **${avertissement.enabled ? "ON" : "OFF"}** — ` +
          `rôle : ${
            avertissement.roleId
              ? `<@&${avertissement.roleId}>`
              : "aucun"
          }`,
        files: [attachment],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error("[PROSYNC][EXPORT_CONFIG]", error);

      try {
        if (interaction.deferred) {
          return interaction.editReply({
            content: "⚠️ Erreur pendant l’export.",
          });
        }

        if (!interaction.replied) {
          return interaction.reply({
            content: "⚠️ Erreur pendant l’export.",
            flags: MessageFlags.Ephemeral,
          });
        }

        return interaction.followUp({
          content: "⚠️ Erreur pendant l’export.",
          flags: MessageFlags.Ephemeral,
        });
      } catch {}
    }
  },
};
