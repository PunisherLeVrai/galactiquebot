const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getGuildConfig } = require("../../core/configManager");
const { normalizeConfig } = require("../../core/guildConfig");
const { createSession } = require("../../core/disposWeekStore");
const { buildDayEmbed, buildPayloadWithOptionalImage } = require("../../core/disposWeekRenderer");
const { buttonsRow } = require("../../core/disposWeekButtons");

const FLAGS_EPHEMERAL = 64;

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dispo")
    .setDescription("Crée les dispos de la semaine (7 jours).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o.setName("titre").setDescription("Titre (ex: Dispos semaine)").setRequired(true))
    .addStringOption((o) => o.setName("note").setDescription("Note (deadline, infos)").setRequired(false))
    .addStringOption((o) =>
      o
        .setName("images")
        .setDescription("Images: aucune / 1 image / 7 images")
        .setRequired(false)
        .addChoices(
          { name: "Aucune", value: "none" },
          { name: "1 image (même pour 7 jours)", value: "one" },
          { name: "7 images (une par jour)", value: "multi" }
        )
    )
    // Images upload depuis ton tel/PC
    .addAttachmentOption((o) => o.setName("image").setDescription("Image unique (si mode = 1 image)").setRequired(false))
    .addAttachmentOption((o) => o.setName("image1").setDescription("Lundi").setRequired(false))
    .addAttachmentOption((o) => o.setName("image2").setDescription("Mardi").setRequired(false))
    .addAttachmentOption((o) => o.setName("image3").setDescription("Mercredi").setRequired(false))
    .addAttachmentOption((o) => o.setName("image4").setDescription("Jeudi").setRequired(false))
    .addAttachmentOption((o) => o.setName("image5").setDescription("Vendredi").setRequired(false))
    .addAttachmentOption((o) => o.setName("image6").setDescription("Samedi").setRequired(false))
    .addAttachmentOption((o) => o.setName("image7").setDescription("Dimanche").setRequired(false)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "Commande serveur uniquement.", flags: FLAGS_EPHEMERAL });
    }

    const cfg = normalizeConfig(getGuildConfig(interaction.guildId) || {});
    const disposChannelId = cfg.channels?.dispos;

    if (!disposChannelId) {
      return interaction.reply({
        content: "Salon **Dispos** non configuré. Fais `/setup` et sélectionne le salon dispos.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const channel = await interaction.guild.channels.fetch(disposChannelId).catch(() => null);
    if (!channel) {
      return interaction.reply({ content: "Salon dispos introuvable.", flags: FLAGS_EPHEMERAL });
    }

    const title = interaction.options.getString("titre", true);
    const note = interaction.options.getString("note") || null;
    const imageMode = interaction.options.getString("images") || "none";

    // Récup des attachments (upload tel/PC)
    const one = interaction.options.getAttachment("image");
    const multi = [
      interaction.options.getAttachment("image1"),
      interaction.options.getAttachment("image2"),
      interaction.options.getAttachment("image3"),
      interaction.options.getAttachment("image4"),
      interaction.options.getAttachment("image5"),
      interaction.options.getAttachment("image6"),
      interaction.options.getAttachment("image7"),
    ];

    // Validation simple
    if (imageMode === "one" && !one) {
      return interaction.reply({ content: "Mode **1 image** choisi, mais aucune image fournie.", flags: FLAGS_EPHEMERAL });
    }
    if (imageMode === "multi") {
      // autorisé: tu peux fournir 1..7, celles manquantes = pas d’image
      const any = multi.some(Boolean);
      if (!any) {
        return interaction.reply({
          content: "Mode **7 images** choisi, mais aucune image n’a été fournie (image1..image7).",
          flags: FLAGS_EPHEMERAL,
        });
      }
    }

    // On crée la session avec un rootId (provisoire), puis on l’écrit après création des messages.
    const rootId = `${Date.now()}-${interaction.user.id}`;

    const session = {
      rootId,
      guildId: interaction.guildId,
      channelId: disposChannelId,
      title,
      note,
      createdBy: interaction.user.id,
      createdAt: new Date().toISOString(),
      days: DAYS.map((label, idx) => ({
        index: idx,
        label,
        messageId: null,
        imageUrl: null,
        responses: {},
      })),
    };

    // Création des 7 messages
    const messageIds = [];
    for (let i = 0; i < 7; i++) {
      // image URL (Discord) = attachment.url, donc aucun stockage local nécessaire
      let imageUrl = null;
      if (imageMode === "one") imageUrl = one.url;
      else if (imageMode === "multi" && multi[i]) imageUrl = multi[i].url;

      session.days[i].imageUrl = imageUrl;

      const embed = buildDayEmbed(session, i, cfg);

      const msg = await channel.send({
        ...buildPayloadWithOptionalImage(embed, imageUrl),
        components: [buttonsRow(rootId, i, false)],
      });

      session.days[i].messageId = msg.id;
      messageIds.push(msg.id);
    }

    // Sauvegarde
    createSession(interaction.guildId, session);

    await interaction.reply({
      content: `Dispos semaine créées dans <#${disposChannelId}> (7 messages : Lundi → Dimanche).`,
      flags: FLAGS_EPHEMERAL,
    });
  },
};
