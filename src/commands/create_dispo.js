// src/commands/create_dispo.js
// /create_dispo — STAFF ONLY — NON EPHEMERE (réponse EPHEMERE mais pas de session)
// Crée 1..7 messages Dispo (Lun..Dim) dans un salon + ajoute ✅/❌
// ✅ PAS de sauvegarde d'IDs
// ✅ Utilisation simple : tout se fait via les options du slash
// ✅ Support 0..N images (1 message / jour avec 0..N fichiers)
// ✅ Possibilité de ne mettre aucun texte (aucun contenu / description)
//
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
} = require("discord.js");

const { getGuildConfig } = require("../core/guildConfig");

const ICON = {
  no: "⛔",
  warn: "⚠️",
  ok: "✅",
};

const DAYS_FULL = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const DAYS_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const ids = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  return ids.some((id) => id && member.roles?.cache?.has?.(String(id)));
}

function resolveDefaultChannelId(cfg) {
  // cible = disposChannelId en priorité
  const v = cfg?.disposChannelId ? String(cfg.disposChannelId) : null;
  return v || null;
}

function clampText(s, max = 1900) {
  const t = String(s ?? "").replace(/\r/g, "").trim();
  if (!t) return "";
  return t.slice(0, max);
}

module.exports.data = new SlashCommandBuilder()
  .setName("create_dispo")
  .setDescription("STAFF: Créer 1..7 messages Dispo (Lun..Dim) dans un salon (sans sauvegarde).")
  // Salon cible (optionnel, sinon salon des dispos du /setup)
  .addChannelOption((opt) =>
    opt
      .setName("salon")
      .setDescription("Salon où publier les messages (sinon: salon Dispos configuré)")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)
  )
  // Sélection des jours (booléens). Si aucun n'est true => tous les jours.
  .addBooleanOption((opt) =>
    opt
      .setName("lun")
      .setDescription("Créer le message pour Lundi")
      .setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("mar")
      .setDescription("Créer le message pour Mardi")
      .setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("mer")
      .setDescription("Créer le message pour Mercredi")
      .setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("jeu")
      .setDescription("Créer le message pour Jeudi")
      .setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("ven")
      .setDescription("Créer le message pour Vendredi")
      .setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("sam")
      .setDescription("Créer le message pour Samedi")
      .setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("dim")
      .setDescription("Créer le message pour Dimanche")
      .setRequired(false)
  )
  // Texte optionnel
  .addStringOption((opt) =>
    opt
      .setName("texte")
      .setDescription("Texte commun à tous les messages (optionnel)")
      .setRequired(false)
  )
  // Si true et aucun texte fourni => aucun texte par défaut (vraiment message vide + images ou embed sans description)
  .addBooleanOption((opt) =>
    opt
      .setName("no_default_text")
      .setDescription("Ne PAS mettre le texte par défaut si aucun texte n'est fourni")
      .setRequired(false)
  )
  // Images (0..4). Si au moins 1 image => mode Image, attachées à chaque message.
  .addAttachmentOption((opt) =>
    opt
      .setName("image_1")
      .setDescription("Image 1 (optionnelle)")
      .setRequired(false)
  )
  .addAttachmentOption((opt) =>
    opt
      .setName("image_2")
      .setDescription("Image 2 (optionnelle)")
      .setRequired(false)
  )
  .addAttachmentOption((opt) =>
    opt
      .setName("image_3")
      .setDescription("Image 3 (optionnelle)")
      .setRequired(false)
  )
  .addAttachmentOption((opt) =>
    opt
      .setName("image_4")
      .setDescription("Image 4 (optionnelle)")
      .setRequired(false)
  )
  .setDefaultMemberPermissions(0n);

module.exports.execute = async function execute(interaction) {
  try {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: ICON.no, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const guild = interaction.guild;
    const guildId = guild.id;
    const cfg = getGuildConfig(guildId) || {};

    if (!isStaff(interaction.member, cfg)) {
      return interaction
        .reply({ content: `${ICON.no} Accès réservé au STAFF.`, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    // Salon cible
    let channel = interaction.options.getChannel("salon") || null;
    if (!channel) {
      const defId = resolveDefaultChannelId(cfg);
      if (defId) {
        channel = await guild.channels.fetch(defId).catch(() => null);
      }
    }

    if (!channel || !channel.isTextBased?.()) {
      return interaction
        .reply({
          content: "⚠️ Salon cible introuvable/invalide. Utilise l'option `salon` ou configure le salon Dispos dans `/setup`.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }

    // Jours sélectionnés (indices 0..6)
    const dayFlags = {
      0: interaction.options.getBoolean("lun") || false,
      1: interaction.options.getBoolean("mar") || false,
      2: interaction.options.getBoolean("mer") || false,
      3: interaction.options.getBoolean("jeu") || false,
      4: interaction.options.getBoolean("ven") || false,
      5: interaction.options.getBoolean("sam") || false,
      6: interaction.options.getBoolean("dim") || false,
    };

    let days = Object.entries(dayFlags)
      .filter(([, v]) => v)
      .map(([k]) => Number(k));

    // Si aucun jour coché => tous les jours
    if (days.length === 0) {
      days = [0, 1, 2, 3, 4, 5, 6];
    }

    // Texte & options
    const rawText = interaction.options.getString("texte") || "";
    const text = clampText(rawText, 1900);
    const noDefaultText = interaction.options.getBoolean("no_default_text") || false;

    // Images (0..4)
    const attachments = [];
    const a1 = interaction.options.getAttachment("image_1");
    const a2 = interaction.options.getAttachment("image_2");
    const a3 = interaction.options.getAttachment("image_3");
    const a4 = interaction.options.getAttachment("image_4");
    for (const a of [a1, a2, a3, a4]) {
      if (a && a.url) {
        attachments.push({
          url: a.url,
          name: a.name || "image.png",
        });
      }
    }

    const mode = attachments.length > 0 ? "image" : "embed";

    await interaction.reply({
      content: "⏳ Création des messages de dispo...",
      flags: MessageFlags.Ephemeral,
    });

    const created = [];

    for (const dayIndex of days) {
      const dayFull = DAYS_FULL[dayIndex];
      const dayShort = DAYS_SHORT[dayIndex];

      let content = "";
      let embeds = [];
      let files = [];

      if (mode === "embed") {
        // EMBED
        const embed = new EmbedBuilder()
          .setTitle(`Disponibilités — ${dayFull}`)
          .setColor(0x5865f2);

        if (text) {
          embed.setDescription(text);
        } else if (!noDefaultText) {
          embed.setDescription("Réagis : ✅ présent | ❌ absent");
        }
        // si noDefaultText=true et pas de texte => embed sans description

        embeds = [embed];
        content = ""; // rien en plus
      } else {
        // IMAGE(S)
        files = attachments.map((a, idx) => ({
          attachment: a.url,
          name: a.name || `dispo_${dayShort}_${idx + 1}.png`,
        }));

        if (text) {
          content = text;
        } else if (!noDefaultText) {
          content = `Disponibilités — ${dayFull}\nRéagis : ✅ présent | ❌ absent`;
        } else {
          content = ""; // pas de texte du tout
        }
      }

      const msg = await channel
        .send({
          content: content || undefined,
          embeds: embeds.length ? embeds : undefined,
          files: files.length ? files : undefined,
        })
        .catch(() => null);

      if (!msg?.id) continue;

      // Ajout réactions
      try {
        await msg.react("✅").catch(() => {});
      } catch {}
      try {
        await msg.react("❌").catch(() => {});
      } catch {}

      created.push({ dayIndex, id: msg.id });
    }

    const createdList = created.length
      ? created.map((x) => `${DAYS_SHORT[x.dayIndex]}: \`${x.id}\``).join("\n")
      : "—";

    return interaction
      .editReply({
        content:
          `${ICON.ok} Messages créés: **${created.length}**\n` +
          `Salon: <#${channel.id}>\n` +
          `Mode: **${mode === "image" ? "Image (attachments)" : "Embed"}**\n` +
          `Texte: **${text ? "personnalisé" : noDefaultText ? "aucun" : "par défaut"}**\n\n` +
          `IDs (info):\n${createdList}`,
      })
      .catch(() => {});
  } catch {
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: "⚠️ Erreur inconnue.", flags: MessageFlags.Ephemeral })
          .catch(() => {});
      } else {
        await interaction
          .editReply({ content: "⚠️ Erreur inconnue.", flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    } catch {}
  }
};
