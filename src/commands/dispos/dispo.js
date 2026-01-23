const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { requireStaff, requireGuildConfig } = require("../../core/guildConfig");
const { createSession } = require("../../core/disposStore");
const { buildButtons, buildEmbed } = require("../../core/disposButtons");

const FLAGS_EPHEMERAL = 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dispo")
    .setDescription("Crée une session de disponibilités (boutons).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName("titre").setDescription("Titre de la session (ex: Match Lundi 21h)").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("note").setDescription("Texte optionnel (infos, deadline, etc.)").setRequired(false)
    ),

  async execute(interaction) {
    const cfg = await requireGuildConfig(interaction);
    if (!cfg) return;

    // Option : restreindre au rôle staff configuré
    const staffOk = await requireStaff(interaction);
    if (!staffOk) return;

    const title = interaction.options.getString("titre", true);
    const note = interaction.options.getString("note", false);

    const disposChannelId = cfg.channels?.dispos;
    if (!disposChannelId) {
      return interaction.reply({
        content: "Aucun salon **Dispos** configuré. Fais `/setup` et sélectionne le salon dispos.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const channel = await interaction.guild.channels.fetch(disposChannelId).catch(() => null);
    if (!channel) {
      return interaction.reply({
        content: "Salon dispos introuvable. Vérifie la config `/setup`.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    // Post the session message
    const tempSession = {
      messageId: "pending",
      channelId: disposChannelId,
      title,
      note: note || null,
      createdBy: interaction.user.id,
      createdAt: new Date().toISOString(),
      closed: false,
      responses: {},
    };

    const msg = await channel.send({
      embeds: [buildEmbed(tempSession, cfg)],
      components: [buildButtons(false)],
    });

    // Save with real message id
    const session = {
      ...tempSession,
      messageId: msg.id,
    };

    createSession(interaction.guildId, session);

    await interaction.reply({
      content: `Session dispos créée dans <#${disposChannelId}>.\nMessage: https://discord.com/channels/${interaction.guildId}/${disposChannelId}/${msg.id}`,
      flags: FLAGS_EPHEMERAL,
    });
  },
};
