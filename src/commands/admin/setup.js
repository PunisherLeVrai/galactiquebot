const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  ComponentType,
} = require("discord.js");

const { upsertGuildConfig, getGuildConfig } = require("../../core/configManager");

// Draft en mémoire (10 min) — léger, RAM-friendly
const drafts = new Map(); // key = `${guildId}:${userId}`

function k(guildId, userId) {
  return `${guildId}:${userId}`;
}

function bool(v) {
  return v ? "✅" : "❌";
}

function mentionRole(id) {
  return id ? `<@&${id}>` : "—";
}

function mentionChannel(id) {
  return id ? `<#${id}>` : "—";
}

function buildEmbed(d) {
  const embed = new EmbedBuilder()
    .setTitle("Setup — XIG BLAUGRANA FC Staff")
    .setDescription(
      [
        "Configure ce serveur via les menus ci-dessous.",
        "Aucun ID à copier/coller : tu sélectionnes, le bot enregistre.",
        "",
        "À la fin : clique **Enregistrer**, puis utilise **/export_config** pour récupérer `servers.json`.",
      ].join("\n")
    )
    .addFields(
      {
        name: "Rôles",
        value: [
          `Staff: ${mentionRole(d.roles.staff)}`,
          `Joueurs: ${mentionRole(d.roles.player)}`,
          `Tests: ${mentionRole(d.roles.test)}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Salons",
        value: [
          `Logs: ${mentionChannel(d.channels.logs)}`,
          `Dispos: ${mentionChannel(d.channels.dispos)}`,
          `Planning: ${mentionChannel(d.channels.planning)}`,
          `Effectif: ${mentionChannel(d.channels.effectif)}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Modules",
        value: [
          `Dispos: ${bool(d.features.dispos)}`,
          `Pseudos: ${bool(d.features.pseudos)}`,
          `Effectif: ${bool(d.features.effectif)}`,
          `Planning: ${bool(d.features.planning)}`,
        ].join("\n"),
        inline: true,
      }
    );

  if (d.colors.primary) {
    const colorInt = Number(d.colors.primary);
    if (!Number.isNaN(colorInt)) embed.setColor(colorInt);
  }

  // Champs requis (minimum)
  const missing = [];
  if (!d.roles.staff) missing.push("Rôle Staff");
  if (!d.channels.logs) missing.push("Salon Logs");

  embed.addFields({
    name: "Requis",
    value: missing.length ? `Manque : ${missing.join(", ")}` : "OK (prêt à enregistrer)",
  });

  return embed;
}

function components(locked = false) {
  // Rôles (Staff/Joueurs/Tests) : 1 à 3 rôles
  const rolesRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("setup:roles")
      .setPlaceholder("Choisir rôles (Staff / Joueurs / Tests)")
      .setMinValues(1)
      .setMaxValues(3)
      .setDisabled(locked)
  );

  // Salons Logs (1)
  const logsRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("setup:logs")
      .setPlaceholder("Choisir le salon LOGS (requis)")
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setDisabled(locked)
  );

  // Salons Dispos/Planning/Effectif (0..3)
  const channelsRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("setup:channels")
      .setPlaceholder("Choisir salons (Dispos / Planning / Effectif) (optionnel)")
      .setMinValues(0)
      .setMaxValues(3)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setDisabled(locked)
  );

  // Modules (0..4)
  const featuresRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("setup:features")
      .setPlaceholder("Activer modules (optionnel)")
      .setMinValues(0)
      .setMaxValues(4)
      .addOptions(
        { label: "Dispos", value: "dispos" },
        { label: "Pseudos", value: "pseudos" },
        { label: "Effectif", value: "effectif" },
        { label: "Planning", value: "planning" }
      )
      .setDisabled(locked)
  );

  // Couleur (0..1)
  const colorRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("setup:color")
      .setPlaceholder("Couleur principale (optionnel)")
      .setMinValues(0)
      .setMaxValues(1)
      .addOptions(
        { label: "Rose Galactique", value: "0xff4db8" },
        { label: "Bleu Discord", value: "0x5865F2" },
        { label: "Jaune Blaugrana", value: "0xFCDC00" }
      )
      .setDisabled(locked)
  );

  // Boutons
  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("setup:save")
      .setLabel("Enregistrer")
      .setStyle(ButtonStyle.Success)
      .setDisabled(locked),
    new ButtonBuilder()
      .setCustomId("setup:cancel")
      .setLabel("Annuler")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(locked)
  );

  return [rolesRow, logsRow, channelsRow, featuresRow, colorRow, buttonsRow];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configuration du serveur via menus (rôles/salons/modules/couleur).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({ content: "Commande utilisable uniquement dans un serveur.", ephemeral: true });
    }

    const key = k(interaction.guildId, interaction.user.id);

    // Draft initial (prérempli si config existante)
    const existing = getGuildConfig(interaction.guildId) || {};
    const draft = {
      guildId: interaction.guildId,
      guildName: interaction.guild?.name || null,
      roles: {
        staff: existing.staffRoleId || existing.roles?.staff || null,
        player: existing.playerRoleId || existing.roles?.player || null,
        test: existing.testRoleId || existing.roles?.test || null,
      },
      channels: {
        logs: existing.logChannelId || existing.channels?.logs || null,
        dispos: existing.channels?.dispos || null,
        planning: existing.channels?.planning || null,
        effectif: existing.channels?.effectif || null,
      },
      features: {
        dispos: existing.features?.dispos ?? false,
        pseudos: existing.features?.pseudos ?? false,
        effectif: existing.features?.effectif ?? false,
        planning: existing.features?.planning ?? false,
      },
      colors: {
        primary: existing.colors?.primary ?? null,
      },
    };

    drafts.set(key, draft);

    const msg = await interaction.reply({
      embeds: [buildEmbed(draft)],
      components: components(false),
      ephemeral: true,
      fetchReply: true,
    });

    const collector = msg.createMessageComponentCollector({
      time: 10 * 60 * 1000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: "Seul l’admin qui a lancé /setup peut utiliser ces menus.", ephemeral: true });
      }

      const d = drafts.get(key);
      if (!d) {
        return i.reply({ content: "Setup expiré. Relance /setup.", ephemeral: true });
      }

      try {
        // --- ROLES ---
        if (i.customId === "setup:roles") {
          // Règle simple : 1er = staff, 2e = player, 3e = test
          const vals = i.values || [];
          d.roles.staff = vals[0] || null;
          d.roles.player = vals[1] || null;
          d.roles.test = vals[2] || null;

          return i.update({ embeds: [buildEmbed(d)], components: components(false) });
        }

        // --- LOGS CHANNEL ---
        if (i.customId === "setup:logs") {
          const vals = i.values || [];
          d.channels.logs = vals[0] || null;

          return i.update({ embeds: [buildEmbed(d)], components: components(false) });
        }

        // --- OTHER CHANNELS ---
        if (i.customId === "setup:channels") {
          // Règle simple : 1er = dispos, 2e = planning, 3e = effectif
          const vals = i.values || [];
          d.channels.dispos = vals[0] || null;
          d.channels.planning = vals[1] || null;
          d.channels.effectif = vals[2] || null;

          return i.update({ embeds: [buildEmbed(d)], components: components(false) });
        }

        // --- FEATURES ---
        if (i.customId === "setup:features") {
          const set = new Set(i.values || []);
          d.features.dispos = set.has("dispos");
          d.features.pseudos = set.has("pseudos");
          d.features.effectif = set.has("effectif");
          d.features.planning = set.has("planning");

          return i.update({ embeds: [buildEmbed(d)], components: components(false) });
        }

        // --- COLOR ---
        if (i.customId === "setup:color") {
          d.colors.primary = (i.values && i.values[0]) ? i.values[0] : null;
          return i.update({ embeds: [buildEmbed(d)], components: components(false) });
        }

        // --- CANCEL ---
        if (i.customId === "setup:cancel") {
          drafts.delete(key);
          collector.stop("cancel");
          return i.update({ content: "Setup annulé.", embeds: [], components: [] });
        }

        // --- SAVE ---
        if (i.customId === "setup:save") {
          // Champs requis minimum
          const missing = [];
          if (!d.roles.staff) missing.push("Rôle Staff");
          if (!d.channels.logs) missing.push("Salon Logs");

          if (missing.length) {
            return i.reply({ content: `Impossible d’enregistrer. Manque : ${missing.join(", ")}.`, ephemeral: true });
          }

          // On sauvegarde dans la config (format robuste)
          upsertGuildConfig(interaction.guildId, {
            guildName: interaction.guild?.name || null,

            // compat + lisible
            roles: { ...d.roles },
            channels: { ...d.channels },
            features: { ...d.features },
            colors: { ...d.colors },

            // alias simples (si tu préfères des champs plats)
            staffRoleId: d.roles.staff,
            playerRoleId: d.roles.player,
            testRoleId: d.roles.test,
            logChannelId: d.channels.logs,
          });

          drafts.delete(key);
          collector.stop("saved");

          return i.update({
            content: "Setup enregistré ✅\nUtilise maintenant **/export_config** pour récupérer `servers.json`.",
            embeds: [],
            components: [],
          });
        }

        return i.reply({ content: "Interaction inconnue.", ephemeral: true });
      } catch (e) {
        return i.reply({ content: "Erreur pendant le setup.", ephemeral: true });
      }
    });

    collector.on("end", async (_c, reason) => {
      if (reason === "saved" || reason === "cancel") return;
      // Timeout : on verrouille l’UI
      try {
        await interaction.editReply({
          content: "Setup expiré (10 min). Relance **/setup** si nécessaire.",
          embeds: [buildEmbed(drafts.get(key) || draft)],
          components: components(true),
        });
      } catch {}
    });
  },
};
