// src/commands/dispos/dispo_close.js
// Ferme une semaine de disponibilités
// CommonJS — discord.js v14

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getSession, closeSession } = require("../../core/disposWeekStore");
const { buttonsRow } = require("../../core/disposWeekButtons");
const { getGuildConfig } = require("../../core/configManager");
const { normalizeConfig } = require("../../core/guildConfig");

const FLAGS_EPHEMERAL = 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dispo_close")
    .setDescription("Ferme la semaine de disponibilités en cours.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "Commande utilisable uniquement dans un serveur.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const cfgRaw = getGuildConfig(interaction.guildId);
    if (!cfgRaw) {
      return interaction.reply({
        content: "Serveur non configuré. Lance `/setup`.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const cfg = normalizeConfig(cfgRaw);

    const session = getSession(interaction.guildId);
    if (!session) {
      return interaction.reply({
        content: "Aucune semaine de dispos active.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const channel = await interaction.guild.channels
      .fetch(session.channelId)
      .catch(() => null);

    if (!channel) {
      return interaction.reply({
        content: "Salon des dispos introuvable.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    // Désactiver les boutons sur chaque jour
    for (const day of session.days) {
      try {
        const msg = await channel.messages.fetch(day.messageId);
        await msg.edit({
          components: [buttonsRow(session.rootId, day.index, true)],
        });
      } catch {
        // message supprimé ou inaccessible → on ignore
      }
    }

    closeSession(interaction.guildId);

    await interaction.reply({
      content: "✅ Les disponibilités ont été **fermées**.",
      flags: FLAGS_EPHEMERAL,
    });
  },
};
