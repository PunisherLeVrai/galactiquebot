const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { requireStaff, requireGuildConfig } = require("../../core/guildConfig");
const { getLastSessionId, getSession, upsertSession } = require("../../core/disposStore");
const { buildButtons, buildEmbed } = require("../../core/disposButtons");

const FLAGS_EPHEMERAL = 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dispo_close")
    .setDescription("Ferme la dernière session dispos (désactive les boutons).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName("message_id").setDescription("ID du message de la session (optionnel)").setRequired(false)
    ),

  async execute(interaction) {
    const cfg = await requireGuildConfig(interaction);
    if (!cfg) return;

    const staffOk = await requireStaff(interaction);
    if (!staffOk) return;

    const guildId = interaction.guildId;
    const messageId = interaction.options.getString("message_id", false) || getLastSessionId(guildId);

    if (!messageId) {
      return interaction.reply({ content: "Aucune session trouvée.", flags: FLAGS_EPHEMERAL });
    }

    const session = getSession(guildId, messageId);
    if (!session) {
      return interaction.reply({ content: "Session introuvable.", flags: FLAGS_EPHEMERAL });
    }

    if (session.closed) {
      return interaction.reply({ content: "Session déjà fermée.", flags: FLAGS_EPHEMERAL });
    }

    const disposChannelId = session.channelId || cfg.channels?.dispos;
    if (!disposChannelId) {
      return interaction.reply({ content: "Salon dispos non configuré.", flags: FLAGS_EPHEMERAL });
    }

    const channel = await interaction.guild.channels.fetch(disposChannelId).catch(() => null);
    if (!channel) {
      return interaction.reply({ content: "Salon dispos introuvable.", flags: FLAGS_EPHEMERAL });
    }

    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (!msg) {
      // On ferme quand même en data
      upsertSession(guildId, messageId, { closed: true, closedAt: new Date().toISOString() });
      return interaction.reply({
        content: "Message de session introuvable, mais la session a été marquée fermée dans les données.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const updated = upsertSession(guildId, messageId, {
      closed: true,
      closedAt: new Date().toISOString(),
    });

    await msg.edit({
      embeds: [buildEmbed(updated, cfg)],
      components: [buildButtons(true)],
    });

    await interaction.reply({ content: "Session fermée ✅", flags: FLAGS_EPHEMERAL });
  },
};
