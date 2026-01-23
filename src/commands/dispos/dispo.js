// src/commands/dispos/dispo.js
// /dispo => crée la semaine (7 messages) + boutons présent/absent + images optionnelles

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getGuildConfigSafe } = require("../../core/guildConfig");
const { renderDisposWeek } = require("../../core/disposWeekRenderer");

const FLAGS_EPHEMERAL = 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dispo")
    .setDescription("Créer les disponibilités de la semaine (7 jours).")
    // tu peux enlever cette permission si tu veux laisser tout le monde créer les 7 messages
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt
        .setName("semaine")
        .setDescription("Label semaine (ex: 22/01 → 28/01)")
        .setRequired(true)
    )
    // Images depuis téléphone/PC : tu uploades direct dans la commande
    .addAttachmentOption((opt) => opt.setName("image1").setDescription("Image 1 (optionnelle)").setRequired(false))
    .addAttachmentOption((opt) => opt.setName("image2").setDescription("Image 2 (optionnelle)").setRequired(false))
    .addAttachmentOption((opt) => opt.setName("image3").setDescription("Image 3 (optionnelle)").setRequired(false))
    .addAttachmentOption((opt) => opt.setName("image4").setDescription("Image 4 (optionnelle)").setRequired(false)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "Commande utilisable uniquement dans un serveur.", flags: FLAGS_EPHEMERAL });
    }

    const guildCfg = getGuildConfigSafe(interaction.guildId);
    if (!guildCfg || !guildCfg.disposChannelId) {
      return interaction.reply({
        content: "Ce serveur n’est pas configuré. Lance `/setup` (admin) puis réessaie.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const channel = interaction.guild.channels.cache.get(guildCfg.disposChannelId);
    if (!channel) {
      return interaction.reply({
        content: "Salon dispos introuvable. Refais `/setup` et sélectionne un salon valide.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    // Récupère les attachments
    const weekLabel = interaction.options.getString("semaine", true);
    const atts = ["image1", "image2", "image3", "image4"]
      .map((k) => interaction.options.getAttachment(k))
      .filter(Boolean)
      .map((a) => ({ url: a.url, name: a.name }));

    await interaction.reply({
      content: `Création des dispos semaine: **${weekLabel}**…`,
      flags: FLAGS_EPHEMERAL,
    });

    try {
      const res = await renderDisposWeek({
        client: interaction.client,
        guild: interaction.guild,
        channel,
        guildCfg,
        weekLabel,
        attachments: atts,
      });

      await interaction.followUp({
        content: `OK. Dispos créées dans ${channel} (weekId: \`${res.weekId}\`).`,
        flags: FLAGS_EPHEMERAL,
      });
    } catch (err) {
      await interaction.followUp({
        content: `Erreur pendant la création des dispos. Vérifie les permissions du bot dans ${channel}.`,
        flags: FLAGS_EPHEMERAL,
      });
      throw err;
    }
  },
};
