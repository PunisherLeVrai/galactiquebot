// src/commands/pseudo.js
// /pseudo: affiche / set / apply nickname — CommonJS discord.js v14

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getGuildConfig } = require("../core/guildConfig");
const { setUserPseudos } = require("../core/pseudoStore");
const { buildMemberLine } = require("../core/memberDisplay");

function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;

  const staffRoleIds = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  return staffRoleIds.some((id) => id && member.roles.cache.has(id));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pseudo")
    .setDescription("Pseudos + format (PSN/XBOX/EA | Rôle | Postes)")
    .addSubcommand((s) =>
      s.setName("show").setDescription("Afficher ta ligne formatée.")
    )
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Enregistrer un pseudo")
        .addStringOption((o) =>
          o
            .setName("platform")
            .setDescription("psn/xbox/ea")
            .setRequired(true)
            .addChoices(
              { name: "psn", value: "psn" },
              { name: "xbox", value: "xbox" },
              { name: "ea", value: "ea" }
            )
        )
        .addStringOption((o) =>
          o.setName("value").setDescription("Ton ID").setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s.setName("apply").setDescription("Appliquer le nickname formaté.")
    ),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: "⛔", ephemeral: true });

      const cfg = getGuildConfig(interaction.guildId) || {};
      const member = interaction.member;

      // show = autorisé à tous
      const sub = interaction.options.getSubcommand();

      if (sub === "set") {
        // set = staff only (ou admin). Si tu veux que tout le monde puisse, enlève ce check.
        if (!isStaff(member, cfg)) return interaction.reply({ content: "⛔", ephemeral: true });

        const platform = interaction.options.getString("platform", true);
        const value = interaction.options.getString("value", true);

        const patch = {};
        patch[platform] = value;
        setUserPseudos(interaction.guildId, interaction.user.id, patch);

        return interaction.reply({ content: "✅", ephemeral: true });
      }

      if (sub === "apply") {
        // apply nickname = staff only (ou admin) pour éviter abus
        if (!isStaff(member, cfg)) return interaction.reply({ content: "⛔", ephemeral: true });

        const line = buildMemberLine(member, cfg);
        try {
          await member.setNickname(line, "PSEUDO_APPLY");
          return interaction.reply({ content: "✅", ephemeral: true });
        } catch {
          return interaction.reply({ content: "⚠️", ephemeral: true });
        }
      }

      // show
      const line = buildMemberLine(member, cfg);
      return interaction.reply({ content: line, ephemeral: true });
    } catch {
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
