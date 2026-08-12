// src/commands/pseudo.js
// /pseudo (STAFF ONLY)
// Synchronise les nicknames de tous les membres selon le format :
// POSTE / RÔLE / PSEUDO
//
// Le salon pseudo n'est plus scanné par cette commande.
// Les pseudos sont enregistrés en temps réel par le listener situé dans runner.js.

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getGuildConfig } = require("../core/guildConfig");
const { buildMemberLine } = require("../core/memberDisplay");

function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;

  const staffRoleIds = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  return staffRoleIds.some((id) => id && member.roles.cache.has(String(id)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pseudo")
    .setDescription("STAFF: synchronise les pseudos de tous les membres.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ content: "⛔", ephemeral: true });
      }

      const cfg = getGuildConfig(interaction.guildId) || {};

      if (!isStaff(interaction.member, cfg)) {
        return interaction.reply({ content: "⛔ Accès réservé au STAFF.", ephemeral: true });
      }

      await interaction.reply({
        content: "⏳ Synchronisation des pseudos en cours...",
        ephemeral: true,
      });

      await interaction.guild.members.fetch().catch(() => null);

      const members = interaction.guild.members.cache.filter(
        (member) => member && !member.user.bot
      );

      let ok = 0;
      let fail = 0;
      let skipped = 0;
      let notManageable = 0;

      for (const member of members.values()) {
        if (!member.manageable) {
          notManageable++;
          continue;
        }

        const nickname = buildMemberLine(member, cfg);

        if (!nickname || nickname.length < 2) {
          skipped++;
          continue;
        }

        if ((member.nickname || "") === nickname) {
          skipped++;
          continue;
        }

        try {
          await member.setNickname(nickname, "PROSYNC — synchronisation manuelle");
          ok++;
        } catch (error) {
          console.error(
            `[PROSYNC][PSEUDO] Impossible de modifier ${member.user?.tag || member.id}:`,
            error?.message || error
          );
          fail++;
        }

        // Évite d'enchaîner trop vite les changements de nicknames.
        await sleep(850);
      }

      return interaction.editReply({
        content:
          `✅ Synchronisation terminée.\n` +
          `Format : **POSTE / RÔLE / PSEUDO**\n` +
          `✅ Modifiés : **${ok}**\n` +
          `⏭️ Inchangés : **${skipped}**\n` +
          `⚠️ Échecs : **${fail}**\n` +
          `🚫 Non modifiables : **${notManageable}**`,
      });
    } catch (error) {
      console.error("[PROSYNC][PSEUDO_COMMAND]", error);

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: "⚠️ Une erreur est survenue." }).catch(() => {});
        } else {
          await interaction.reply({
            content: "⚠️ Une erreur est survenue.",
            ephemeral: true,
          }).catch(() => {});
        }
      } catch {}
    }
  },
};
