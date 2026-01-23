// src/commands/dispos/dispo.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const { getGuildConfig, isStaff } = require("../../core/guildConfig");
const { createSession, updateSessionDayMessage } = require("../../core/disposWeekStore");
const { buildDayEmbed } = require("../../core/disposWeekRenderer");
const { buildRows } = require("../../core/disposWeekButtons");

const FLAGS_EPHEMERAL = 64;

const DAYS = [
  { key: "lun", label: "Lundi" },
  { key: "mar", label: "Mardi" },
  { key: "mer", label: "Mercredi" },
  { key: "jeu", label: "Jeudi" },
  { key: "ven", label: "Vendredi" },
  { key: "sam", label: "Samedi" },
  { key: "dim", label: "Dimanche" },
];

function parseDays(input) {
  if (!input || input === "all") return DAYS;
  const parts = input.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const selected = DAYS.filter((d) => parts.includes(d.key));
  return selected.length ? selected : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dispo")
    .setDescription("Créer les messages de disponibilités (1 à 7 jours).")
    .addStringOption((opt) =>
      opt
        .setName("jours")
        .setDescription("Ex: lun,mar,mer ou all")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("Affichage")
        .addChoices(
          { name: "Embed", value: "embed" },
          { name: "Image", value: "image" },
          { name: "Embed + Image", value: "both" }
        )
        .setRequired(true)
    )
    // 7 attachments max (1 par option)
    .addAttachmentOption((o) => o.setName("img1").setDescription("Image 1").setRequired(false))
    .addAttachmentOption((o) => o.setName("img2").setDescription("Image 2").setRequired(false))
    .addAttachmentOption((o) => o.setName("img3").setDescription("Image 3").setRequired(false))
    .addAttachmentOption((o) => o.setName("img4").setDescription("Image 4").setRequired(false))
    .addAttachmentOption((o) => o.setName("img5").setDescription("Image 5").setRequired(false))
    .addAttachmentOption((o) => o.setName("img6").setDescription("Image 6").setRequired(false))
    .addAttachmentOption((o) => o.setName("img7").setDescription("Image 7").setRequired(false))
    // staff-only conseillé (sinon n'importe qui crée 7 messages)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const cfg = getGuildConfig(interaction.guildId);
    if (!cfg) {
      return interaction.reply({
        content: "Ce serveur n’est pas configuré. Lance `/setup` d’abord.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    // Restriction : staff (ou ManageGuild)
    if (!isStaff(interaction.member, cfg) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "Commande réservée au staff.", flags: FLAGS_EPHEMERAL });
    }

    const disposChannelId = cfg.disposChannelId;
    if (!disposChannelId) {
      return interaction.reply({
        content: "Salon dispos non configuré. Fais `/setup` et définis le salon dispos.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const channel = await interaction.client.channels.fetch(disposChannelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return interaction.reply({
        content: "Le salon dispos configuré est invalide (doit être un salon texte).",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const joursInput = interaction.options.getString("jours", true);
    const mode = interaction.options.getString("mode", true);

    const daysSelected = parseDays(joursInput);
    if (!daysSelected) {
      return interaction.reply({
        content: "Format jours invalide. Exemple: `lun,mar,mer` ou `all`.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    // Récup images uploadées
    const imgs = [];
    for (let i = 1; i <= 7; i++) {
      const att = interaction.options.getAttachment(`img${i}`);
      if (att?.url) imgs.push(att.url);
    }

    // Mapping images -> jour (si 1 image => répétée)
    const days = daysSelected.map((d, idx) => ({
      key: d.key,
      label: d.label,
      mode,
      imageUrl: imgs.length ? (imgs[idx] || imgs[0]) : null,
    }));

    // création session
    const session = createSession(interaction.guildId, interaction.user.id, disposChannelId, days, {
      title: "Disponibilités",
    });

    await interaction.reply({
      content: `Création des dispos : ${days.length} jour(s) dans ${channel}.`,
      flags: FLAGS_EPHEMERAL,
    });

    // Envoi messages
    for (const day of session.days) {
      const embed = buildDayEmbed({
        guildName: interaction.guild.name,
        session,
        day,
        brandTitle: "Disponibilités",
      });

      const rows = buildRows({
        sessionId: session.sessionId,
        dayKey: day.key,
        closed: session.closed,
        automationsEnabled: cfg.automationsEnabled,
      });

      const msg = await channel.send({
        embeds: [embed],
        components: rows,
      });

      updateSessionDayMessage(interaction.guildId, session.sessionId, day.key, {
        messageId: msg.id,
        // si tu veux récupérer l’URL réelle d’une image postée en attachment plus tard, on peut l’ajouter ici
      });
    }
  },
};
