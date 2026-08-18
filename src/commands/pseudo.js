// src/commands/pseudo.js
// /pseudo — STAFF ONLY
//
// 1) scanne obligatoirement le salon pseudo
// 2) prend le dernier pseudo valide de chaque membre
// 3) met à jour pseudos.json
// 4) si rien n'est trouvé dans le salon : username Discord
// 5) applique POSTE / RÔLE / PSEUDO

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

const {
  getGuildConfig,
} = require("../core/guildConfig");

const {
  runPseudoForGuild,
} = require("../automations/runner");

function isStaff(member, config) {
  if (!member) return false;

  if (
    member.permissions?.has?.(
      PermissionFlagsBits.Administrator
    )
  ) {
    return true;
  }

  const staffRoleIds = Array.isArray(config?.staffRoleIds)
    ? config.staffRoleIds
    : [];

  return staffRoleIds.some(
    (roleId) =>
      roleId &&
      member.roles?.cache?.has?.(String(roleId))
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pseudo")
    .setDescription(
      "STAFF: scanne le salon pseudo puis synchronise les nicknames."
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    ),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: "⛔",
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

      if (!config.pseudoScanChannelId) {
        return interaction.reply({
          content:
            "⚠️ Aucun salon pseudo configuré dans `/setup`.",
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.reply({
        content:
          "⏳ Scan du salon pseudo puis synchronisation...",
        flags: MessageFlags.Ephemeral,
      });

      const result =
        await runPseudoForGuild(
          interaction.guild,
          config,
          {
            scanLimit: 300,
            throttleMs: 850,
            requirePseudoChannel: true,
          }
        );

      if (!result.ok) {
        const reasons = {
          no_guild: "Serveur introuvable.",
          no_pseudo_channel:
            "Aucun salon pseudo configuré.",
          invalid_pseudo_channel:
            "Le salon pseudo est introuvable ou inaccessible.",
          scan_failed:
            "Le scan du salon pseudo a échoué.",
        };

        return interaction.editReply({
          content:
            `⚠️ Synchronisation impossible : ${
              reasons[result.reason] || result.reason
            }`,
        });
      }

      return interaction.editReply({
        content:
          `✅ Synchronisation terminée.\n` +
          `Format : **POSTE / RÔLE / PSEUDO**\n\n` +
          `🔎 Messages scannés : **${result.scannedMessages}**\n` +
          `🎮 Pseudos trouvés : **${result.pseudosFound}**\n` +
          `🧹 Anciens pseudos vidés : **${result.pseudosCleared}**\n` +
          `👤 Username Discord utilisé en secours : **${result.usernameFallback}**\n\n` +
          `✅ Nicknames modifiés : **${result.okCount}**\n` +
          `⏭️ Inchangés : **${result.skipped}**\n` +
          `⚠️ Échecs : **${result.fail}**\n` +
          `🚫 Non modifiables : **${result.notManageable}**`,
      });
    } catch (error) {
      console.error("[PROSYNC][PSEUDO_COMMAND]", error);

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: "⚠️ Une erreur est survenue.",
          });
        } else {
          await interaction.reply({
            content: "⚠️ Une erreur est survenue.",
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch {}
    }
  },
};
