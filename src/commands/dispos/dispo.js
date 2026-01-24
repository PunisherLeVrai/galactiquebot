// src/commands/dispos/dispo.js
// /dispo -> crée 1 à 7 messages (jours au choix), mode embed/image/both, images upload
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const { getGuildConfig } = require("../../core/guildConfig");
const { createSession, updateSessionDay, getSession } = require("../../core/disposWeekStore");
const { buildDayEmbed } = require("../../core/disposWeekRenderer");
const { buildRows } = require("../../core/disposWeekButtons");

const EPHEMERAL = true;

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
  if (imageUrls.length === 1) return imageUrls[0];
  return imageUrls[dayIndex] || imageUrls[0];
}

function isStaffAllowed(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (cfg?.staffRoleId && member.roles?.cache?.has(cfg.staffRoleId)) return true;
  return false;
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
    .addAttachmentOption((o) => o.setName("img1").setDescription("Image 1").setRequired(false))
    .addAttachmentOption((o) => o.setName("img2").setDescription("Image 2").setRequired(false))
    .addAttachmentOption((o) => o.setName("img3").setDescription("Image 3").setRequired(false))
    .addAttachmentOption((o) => o.setName("img4").setDescription("Image 4").setRequired(false))
    .addAttachmentOption((o) => o.setName("img5").setDescription("Image 5").setRequired(false))
    .addAttachmentOption((o) => o.setName("img6").setDescription("Image 6").setRequired(false))
    .addAttachmentOption((o) => o.setName("img7").setDescription("Image 7").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "Commande utilisable uniquement dans un serveur.", ephemeral: EPHEMERAL });
    }

    const cfg = getGuildConfig(interaction.guildId);
    if (!cfg) {
      return interaction.reply({ content: "Serveur non configuré. Lance `/setup`.", ephemeral: EPHEMERAL });
    }

    if (!isStaffAllowed(interaction.member, cfg)) {
      return interaction.reply({ content: "Commande réservée au staff.", ephemeral: EPHEMERAL });
    }

    if (!cfg.disposChannelId) {
      return interaction.reply({ content: "Salon Dispos non configuré. Fais `/setup`.", ephemeral: EPHEMERAL });
    }

    const channel = await interaction.client.channels.fetch(cfg.disposChannelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return interaction.reply({ content: "Salon Dispos invalide (doit être un salon texte).", ephemeral: EPHEMERAL });
    }

    const daysInput = interaction.options.getString("jours", true);
    const mode = interaction.options.getString("mode", true);

    const selectedDays = parseDays(daysInput);
    if (!selectedDays) {
      return interaction.reply({
        content: "Paramètre `jours` invalide. Exemple: `lun,mar,mer` ou `all`.",
        ephemeral: EPHEMERAL,
      });
    }

    const imageUrls = [];
    for (let i = 1; i <= 7; i++) {
      const att = interaction.options.getAttachment(`img${i}`);
      if (att?.url) imageUrls.push(att.url);
    }

    const days = selectedDays.map((d, idx) => ({
      key: d.key,
      label: d.label,
      mode,
      imageUrl: pickImageUrlForDay(imageUrls, idx),
    }));

    const session = createSession(interaction.guildId, interaction.user.id, channel.id, days, {
      title: "Disponibilités",
    });

    await interaction.reply({
      content: `Création des dispos : **${days.length}** jour(s) dans ${channel} (session \`${session.sessionId}\`).`,
      ephemeral: EPHEMERAL,
    });

    for (const [idx, day] of session.days.entries()) {
      const embed = buildDayEmbed({ guildName: interaction.guild.name, session, day });
      const rows = buildRows({
        sessionId: session.sessionId,
        dayKey: day.key,
        closed: session.closed,
        automationsEnabled: !!cfg?.automations?.enabled,
      });

      const msg = await channel.send({ embeds: [embed], components: rows });
      updateSessionDay(interaction.guildId, session.sessionId, day.key, { messageId: msg.id });

      if (idx < session.days.length - 1) await new Promise((r) => setTimeout(r, 250));
    }

    const fresh = getSession(interaction.guildId, session.sessionId);
    await interaction.followUp({
      content: `✅ Dispos créées. Messages: **${fresh.days.filter((d) => d.messageId).length}**.`,
      ephemeral: EPHEMERAL,
    });
  },
};
