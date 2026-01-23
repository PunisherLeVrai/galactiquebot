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
  Events
} = require("discord.js");

const { upsertGuildConfig, getGuildConfig } = require("../../core/configManager");

const drafts = new Map(); // key = `${guildId}:${userId}`

function key(guildId, userId) {
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
        "Tu ne tapes aucun ID : tu sélectionnes, et le bot enregistre.",
        "",
        "Après **Enregistrer** : utilise **/export_config** pour récupérer `servers.json` et l’uploader sur GitHub."
      ].join("\n")
    )
    .addFields(
      {
        name: "Rôles",
        value: [
          `Staff: ${mentionRole(d.roles.staff)}`,
          `Joueurs: ${mentionRole(d.roles.player)}`,
          `Tests: ${mentionRole(d.roles.test)}`
        ].join("\n"),
        inline: true
      },
      {
        name: "Salons",
        value: [
          `Logs: ${mentionChannel(d.channels.logs)}`,
          `Dispos: ${mentionChannel(d.channels.dispos)}`,
          `Planning: ${mentionChannel(d.channels.planning)}`,
          `Effectif: ${mentionChannel(d.channels.effectif)}`
        ].join("\n"),
        inline: true
      },
      {
        name: "Modules",
        value: [
          `Dispos: ${bool(d.features.dispos)}`,
          `Pseudos: ${bool(d.features.pseudos)}`,
          `Effectif: ${bool(d.features.effectif)}`,
          `Planning: ${bool(d.features.planning)}`
        ].join("\n"),
        inline: true
      }
    );

  if (d.colors.primary) {
    const colorInt = Number(d.colors.primary);
    if (!Number.isNaN(colorInt)) embed.setColor(colorInt);
  }

  const missing = [];
  if (!d.roles.staff) missing.push("Rôle Staff");
  if (!d.channels.logs) missing.push("Salon Logs");

  embed.addFields({
    name: "Requis",
    value: missing.length ? `Manque : ${missing.join(", ")}` : "OK (prêt à enregistrer)"
  });

  return embed;
}

function buildComponents(locked = false) {
  const rolesRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("setup:roles")
      .setPlaceholder("Choisir rôles (Staff / Joueurs / Tests)")
      .setMinValues(1)
      .setMaxValues(3)
      .setDisabled(locked)
  );

  const logsRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("setup:logs")
      .setPlaceholder("Choisir le salon LOGS (requis)")
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setDisabled(locked)
  );

  const channelsRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("setup:channels")
      .setPlaceholder("Choisir salons (Dispos / Planning / Effectif) (optionnel)")
      .setMinValues(0)
      .setMaxValues(3)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setDisabled(locked)
  );

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

    const k = key(interaction.guildId, interaction.user.id);

    const existing = getGuildConfig(interaction.guildId) || {};

    const draft = {
      guildId: interaction.guildId,
      guildName: interaction.guild?.name || null,
      roles: {
        staff: existing.roles?.staff ?? existing.staffRoleId ?? null,
        player: existing.roles?.player ?? existing.playerRoleId ?? null,
        test: existing.roles?.test ?? existing.testRoleId ?? null
      },
      channels: {
        logs: existing.channels?.logs ?? existing.logChannelId ?? null,
        dispos: existing.channels?.dispos ?? null,
        planning: existing.channels?.planning ?? null,
        effectif: existing.channels?.effectif ?? null
      },
      features: {
        dispos: existing.features?.dispos ?? false,
        pseudos: existing.features?.pseudos ?? false,
        effectif: existing.features?.effectif ?? false,
        planning: existing.features?.planning ?? false
      },
      colors: {
        primary: existing.colors?.primary ?? null
      }
    };

    drafts.set(k, draft);

    const msg = await interaction.reply({
      embeds: [buildEmbed(draft)],
      components: buildComponents(false),
      ephemeral: true,
      fetchReply: true
    });

    const collector = msg.createMessageComponentCollector({
      time: 10 * 60 * 1000
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: "Seul l’admin qui a lancé /setup peut interagir.", ephemeral: true });
      }

      const d = drafts.get(k);
      if (!d) return i.reply({ content: "Setup expiré. Relance /setup.", ephemeral: true });

      try {
        if (i.isRoleSelectMenu() && i.customId === "setup:roles") {
          const vals = i.values || [];
          d.roles.staff = vals[0] || null;
          d.roles.player = vals[1] || null;
          d.roles.test = vals[2] || null;

          return i.update({ embeds: [buildEmbed(d)], components: buildComponents(false) });
        }

        if (i.isChannelSelectMenu() && i.customId === "setup:logs") {
          d.channels.logs = (i.values && i.values[0]) ? i.values[0] : null;
          return i.update({ embeds: [buildEmbed(d)], components: buildComponents(false) });
        }

        if (i.isChannelSelectMenu() && i.customId === "setup:channels") {
          const vals = i.values || [];
          d.channels.dispos = vals[0] || null;
          d.channels.planning = vals[1] || null;
          d.channels.effectif = vals[2] || null;

          return i.update({ embeds: [buildEmbed(d)], components: buildComponents(false) });
        }

        if (i.isStringSelectMenu() && i.customId === "setup:features") {
          const set = new Set(i.values || []);
          d.features.dispos = set.has("dispos");
          d.features.pseudos = set.has("pseudos");
          d.features.effectif = set.has("effectif");
          d.features.planning = set.has("planning");

          return i.update({ embeds: [buildEmbed(d)], components: buildComponents(false) });
        }

        if (i.isStringSelectMenu() && i.customId === "setup:color") {
          d.colors.primary = (i.values && i.values[0]) ? i.values[0] : null;
          return i.update({ embeds: [buildEmbed(d)], components: buildComponents(false) });
        }

        if (i.isButton() && i.customId === "setup:cancel") {
          drafts.delete(k);
          collector.stop("cancel");
          return i.update({ content: "Setup annulé.", embeds: [], components: [] });
        }

        if (i.isButton() && i.customId === "setup:save") {
          const missing = [];
          if (!d.roles.staff) missing.push("Rôle Staff");
          if (!d.channels.logs) missing.push("Salon Logs");

          if (missing.length) {
            return i.reply({ content: `Impossible d’enregistrer. Manque : ${missing.join(", ")}.`, ephemeral: true });
          }

          upsertGuildConfig(interaction.guildId, {
            guildName: interaction.guild?.name || null,

            roles: { ...d.roles },
            channels: { ...d.channels },
            features: { ...d.features },
            colors: { ...d.colors },

            // alias plats (pratique si tu veux des champs simples)
            staffRoleId: d.roles.staff,
            playerRoleId: d.roles.player,
            testRoleId: d.roles.test,
            logChannelId: d.channels.logs
          });

          drafts.delete(k);
          collector.stop("saved");

          return i.update({
            content: "Setup enregistré ✅\nUtilise maintenant **/export_config** pour récupérer `servers.json`.",
            embeds: [],
            components: []
          });
        }

        return i.reply({ content: "Interaction non gérée.", ephemeral: true });
      } catch {
        return i.reply({ content: "Erreur pendant le setup.", ephemeral: true });
      }
    });

    collector.on("end", async (_c, reason) => {
      if (reason === "saved" || reason === "cancel") return;

      try {
        await interaction.editReply({
          content: "Setup expiré (10 min). Relance **/setup** si nécessaire.",
          embeds: [buildEmbed(drafts.get(k) || draft)],
          components: buildComponents(true)
        });
      } catch {}
    });
  }
};
