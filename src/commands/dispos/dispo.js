// src/commands/dispos/dispo.js
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getGuildConfig } = require("../../core/configManager");
const { normalizeConfig } = require("../../core/guildConfig");
const { createSession } = require("../../core/disposWeekStore");
const { buildDayEmbed, buildPayload } = require("../../core/disposWeekRenderer");
const { buttonsRow } = require("../../core/disposWeekButtons");

const FLAGS_EPHEMERAL = 64;
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function uniq(arr) {
  return [...new Set(arr)];
}

/**
 * Construit la liste des "attendus" depuis un ou plusieurs rôles.
 * Note: pour être RAM-friendly, on utilise role.members (cache) ; si le serveur est petit,
 * on peut forcer un fetch complet une fois.
 */
async function buildExpectedUserIds(guild, roleIds) {
  const clean = Array.isArray(roleIds) ? roleIds.filter(Boolean) : [];
  if (clean.length === 0) return [];

  // Option : si serveur raisonnable, on fetch une fois pour remplir role.members correctement
  // (évite "sans réponse" faux si cache incomplet).
  // Ajuste le seuil si besoin.
  if (guild.memberCount && guild.memberCount <= 800) {
    try {
      await guild.members.fetch();
    } catch {
      // on continue sur cache
    }
  }

  const ids = [];
  for (const rid of clean) {
    const role = await guild.roles.fetch(rid).catch(() => null);
    if (!role) continue;
    for (const [memberId] of role.members) ids.push(memberId);
  }

  return uniq(ids);
}

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
    if (!channel) return interaction.reply({ content: "Salon dispos introuvable.", flags: FLAGS_EPHEMERAL });

    const title = interaction.options.getString("titre", true);
    const note = interaction.options.getString("note") || null;
    const imageMode = interaction.options.getString("images") || "none";

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

    if (imageMode === "one" && !one) {
      return interaction.reply({ content: "Mode **1 image** choisi, mais aucune image fournie.", flags: FLAGS_EPHEMERAL });
    }
    if (imageMode === "multi" && !multi.some(Boolean)) {
      return interaction.reply({
        content: "Mode **7 images** choisi, mais aucune image fournie (image1..image7).",
        flags: FLAGS_EPHEMERAL,
      });
    }

    // ✅ rôle(s) “attendus” pour calcul Sans réponse
    const scopeRoleIds = Array.isArray(cfg.disposScopeRoleIds) ? cfg.disposScopeRoleIds : [];
    const expectedUserIds = await buildExpectedUserIds(interaction.guild, scopeRoleIds);

    const rootId = `${Date.now()}-${interaction.user.id}`;

    const session = {
      rootId,
      guildId: interaction.guildId,
      channelId: disposChannelId,
      title,
      note,
      createdBy: interaction.user.id,
      createdAt: new Date().toISOString(),

      // ✅ utilisé par le renderer
      scopeRoleIds,
      expectedUserIds, // peut être [] si aucun rôle configuré

      days: DAYS.map((label, idx) => ({
        index: idx,
        label,
        messageId: null,
        imageUrl: null,
        responses: {},
      })),
    };

    // Création des 7 messages
    for (let i = 0; i < 7; i++) {
      let imageUrl = null;
      if (imageMode === "one") imageUrl = one.url;
      else if (imageMode === "multi" && multi[i]) imageUrl = multi[i].url;

      session.days[i].imageUrl = imageUrl;

      const embed = buildDayEmbed(session, i, cfg);
      const msg = await channel.send({
        ...buildPayload(embed, { imageUrl }),
        components: [buttonsRow(rootId, i, false)],
      });

      session.days[i].messageId = msg.id;
    }

    createSession(interaction.guildId, session);

    await interaction.reply({
      content:
        `Dispos semaine créées dans <#${disposChannelId}> (Lundi → Dimanche).\n` +
        (scopeRoleIds.length
          ? `Base “Sans réponse” : ${scopeRoleIds.map((id) => `<@&${id}>`).join(", ")}`
          : "Base “Sans réponse” : non définie (configure-la dans /setup)."),
      flags: FLAGS_EPHEMERAL,
    });
  },
};
