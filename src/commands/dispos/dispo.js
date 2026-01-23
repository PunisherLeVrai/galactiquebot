// src/commands/dispos/dispo.js
// /dispo -> crée 1 à 7 messages (jours au choix), mode embed/image/both, images upload
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const { getGuildConfig, isStaff } = require("../../core/guildConfig");
const { createSession, updateSessionDay, getSession } = require("../../core/disposWeekStore");
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
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === "all") return DAYS;

  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  const selected = DAYS.filter((d) => parts.includes(d.key));
  return selected.length ? selected : null;
}

function pickImageUrlForDay(imageUrls, dayIndex) {
  if (!imageUrls || imageUrls.length === 0) return null;
  // Si 1 image => répéter sur tous les jours
  if (imageUrls.length === 1) return imageUrls[0];
  // Sinon 1 image par jour dans l'ordre fourni, fallback sur la première
  return imageUrls[dayIndex] || imageUrls[0];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dispo")
    .setDescription("Créer des disponibilités (1 à 7 jours).")
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
    // 0..7 images upload depuis tel/PC
    .addAttachmentOption((o) => o.setName("img1").setDescription("Image 1").setRequired(false))
    .addAttachmentOption((o) => o.setName("img2").setDescription("Image 2").setRequired(false))
    .addAttachmentOption((o) => o.setName("img3").setDescription("Image 3").setRequired(false))
    .addAttachmentOption((o) => o.setName("img4").setDescription("Image 4").setRequired(false))
    .addAttachmentOption((o) => o.setName("img5").setDescription("Image 5").setRequired(false))
    .addAttachmentOption((o) => o.setName("img6").setDescription("Image 6").setRequired(false))
    .addAttachmentOption((o) => o.setName("img7").setDescription("Image 7").setRequired(false))
    // staff only (conseillé)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "Commande utilisable uniquement dans un serveur.", flags: FLAGS_EPHEMERAL });
    }

    const cfg = getGuildConfig(interaction.guildId);
    if (!cfg) {
      return interaction.reply({ content: "Serveur non configuré. Lance `/setup`.", flags: FLAGS_EPHEMERAL });
    }

    // Staff only (ou ManageGuild)
    const staffOk =
      isStaff(interaction.member, cfg) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

    if (!staffOk) {
      return interaction.reply({ content: "Commande réservée au staff.", flags: FLAGS_EPHEMERAL });
    }

    if (!cfg.disposChannelId) {
      return interaction.reply({
        content: "Salon Dispos non configuré. Fais `/setup` et sélectionne un salon Dispos.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const channel = await interaction.client.channels.fetch(cfg.disposChannelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return interaction.reply({
        content: "Salon Dispos invalide (doit être un salon texte). Vérifie `/setup`.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const daysInput = interaction.options.getString("jours", true);
    const mode = interaction.options.getString("mode", true);

    const selectedDays = parseDays(daysInput);
    if (!selectedDays) {
      return interaction.reply({
        content: "Paramètre `jours` invalide. Exemple: `lun,mar,mer` ou `all`.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    // Images uploadées
    const imageUrls = [];
    for (let i = 1; i <= 7; i++) {
      const att = interaction.options.getAttachment(`img${i}`);
      if (att?.url) imageUrls.push(att.url);
    }

    // Construire days pour la session
    const days = selectedDays.map((d, idx) => ({
      key: d.key,
      label: d.label,
      mode,
      imageUrl: pickImageUrlForDay(imageUrls, idx),
    }));

    // Créer session (store)
    const session = createSession(interaction.guildId, interaction.user.id, channel.id, days, {
      title: "Disponibilités",
    });

    await interaction.reply({
      content: `Création des dispos : **${days.length}** jour(s) dans ${channel} (session \`${session.sessionId}\`).`,
      flags: FLAGS_EPHEMERAL,
    });

    // Envoyer les messages
    for (const [idx, day] of session.days.entries()) {
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

      updateSessionDay(interaction.guildId, session.sessionId, day.key, { messageId: msg.id });

      // Optionnel : légère pause pour éviter rate limit si 7 messages d'un coup
      if (idx < session.days.length - 1) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    // Recharger la session (avec messageIds)
    const fresh = getSession(interaction.guildId, session.sessionId);
    await interaction.followUp({
      content: `✅ Dispos créées. Session: \`${fresh.sessionId}\` — Messages: **${fresh.days.filter(d => d.messageId).length}**.`,
      flags: FLAGS_EPHEMERAL,
    });
  },
};
