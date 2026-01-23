const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  ComponentType
} = require("discord.js");

const { setGuildConfig, saveAll, getGuildConfig } = require("../../core/configManager");

// Etat temporaire en mémoire (RAM friendly)
const drafts = new Map();
// clé: `${guildId}:${userId}` -> { ...draft, updatedAt }

function keyOf(guildId, userId) {
  return `${guildId}:${userId}`;
}

function now() {
  return Date.now();
}

function getOrCreateDraft(guild, userId) {
  const k = keyOf(guild.id, userId);
  const existing = drafts.get(k);

  if (existing) {
    existing.updatedAt = now();
    return existing;
  }

  const draft = {
    guildId: guild.id,
    name: guild.name,
    colors: { primary: null },
    roles: { staff: null, player: null, test: null },
    channels: { dispos: null, planning: null, effectif: null },
    features: { dispos: false, pseudos: false, effectif: false, planning: false },
    updatedAt: now()
  };

  drafts.set(k, draft);
  return draft;
}

function computeMissing(d) {
  const missing = [];
  if (!d.channels.dispos) missing.push("Salon **Dispos**");
  if (!d.roles.staff) missing.push("Rôle **Staff**");
  if (!d.roles.player) missing.push("Rôle **Joueurs**");
  return missing;
}

function prettyId(v) {
  return v ? `<#${v}>` : "—";
}

function prettyRole(v) {
  return v ? `<@&${v}>` : "—";
}

function bool(v) {
  return v ? "✅" : "❌";
}

function buildEmbed(draft) {
  const missing = computeMissing(draft);
  const embed = new EmbedBuilder()
    .setTitle("Setup — XIG BLAUGRANA FC Staff")
    .setDescription(
      [
        "Configure ce serveur en sélectionnant les éléments ci-dessous.",
        "La configuration est enregistrée dans `servers.json` (local Railway).",
        "Ensuite, utilise **/export_config** pour récupérer le fichier et l’uploader sur GitHub."
      ].join("\n")
    )
    .addFields(
      {
        name: "Salons",
        value: [
          `Dispos: ${prettyId(draft.channels.dispos)}`,
          `Planning: ${draft.channels.planning ? `<#${draft.channels.planning}>` : "—"}`,
          `Effectif: ${draft.channels.effectif ? `<#${draft.channels.effectif}>` : "—"}`
        ].join("\n"),
        inline: true
      },
      {
        name: "Rôles",
        value: [
          `Staff: ${prettyRole(draft.roles.staff)}`,
          `Joueurs: ${prettyRole(draft.roles.player)}`,
          `Tests: ${prettyRole(draft.roles.test)}`
        ].join("\n"),
        inline: true
      },
      {
        name: "Modules",
        value: [
          `Dispos: ${bool(draft.features.dispos)}`,
          `Pseudos: ${bool(draft.features.pseudos)}`,
          `Effectif: ${bool(draft.features.effectif)}`,
          `Planning: ${bool(draft.features.planning)}`
        ].join("\n"),
        inline: true
      }
    );

  if (draft.colors.primary) {
    const colorInt = Number(draft.colors.primary);
    if (!Number.isNaN(colorInt)) embed.setColor(colorInt);
  }

  if (missing.length) {
    embed.addFields({
      name: "Champs requis manquants",
      value: missing.map((m) => `- ${m}`).join("\n")
    });
  } else {
    embed.addFields({
      name: "Statut",
      value: "Prêt à enregistrer."
    });
  }

  return embed;
}

function buildComponents(draft, locked = false) {
  const channelRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("setup:channels")
      .setPlaceholder("Choisir salons (Dispos/Planning/Effectif)")
      .setMinValues(1)
      .setMaxValues(3)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setDisabled(locked)
  );

  const roleRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("setup:roles")
      .setPlaceholder("Choisir rôles (Staff/Joueurs/Tests)")
      .setMinValues(1)
      .setMaxValues(3)
      .setDisabled(locked)
  );

  const featureRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("setup:features")
      .setPlaceholder("Activer modules")
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

  const buttonRow = new ActionRowBuilder().addComponents(
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

  return [channelRow, roleRow, featureRow, colorRow, buttonRow];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure ce serveur (salons, rôles, modules, couleur).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "Commande utilisable uniquement dans un serveur.", ephemeral: true });
    }

    const draft = getOrCreateDraft(interaction.guild, interaction.user.id);

    // Pré-remplissage léger depuis config existante (si déjà setup)
    const existing = getGuildConfig(interaction.guild.id);
    if (existing) {
      draft.name = existing.name || draft.name;
      draft.colors.primary = existing.colors?.primary ?? draft.colors.primary;

      draft.roles.staff = existing.roles?.staff ?? draft.roles.staff;
      draft.roles.player = existing.roles?.player ?? draft.roles.player;
      draft.roles.test = existing.roles?.test ?? draft.roles.test;

      draft.channels.dispos = existing.channels?.dispos ?? draft.channels.dispos;
      draft.channels.planning = existing.channels?.planning ?? draft.channels.planning;
      draft.channels.effectif = existing.channels?.effectif ?? draft.channels.effectif;

      draft.features.dispos = existing.features?.dispos ?? draft.features.dispos;
      draft.features.pseudos = existing.features?.pseudos ?? draft.features.pseudos;
      draft.features.effectif = existing.features?.effectif ?? draft.features.effectif;
      draft.features.planning = existing.features?.planning ?? draft.features.planning;
    }

    const msg = await interaction.reply({
      embeds: [buildEmbed(draft)],
      components: buildComponents(draft),
      ephemeral: true,
      fetchReply: true
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.ActionRow, // on filtre plus bas
      time: 10 * 60 * 1000
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: "Seul l’initiateur du setup peut interagir.", ephemeral: true });
      }

      // Les menus/boutons arrivent ici via i.customId
      try {
        if (i.customId === "setup:channels") {
          // i.values = array de channelIds (1..3)
          // Règle simple : si 1 sélection => dispos; si 2 => dispos+planning; si 3 => dispos+planning+effectif
          const vals = i.values || [];
          draft.channels.dispos = vals[0] ?? null;
          draft.channels.planning = vals[1] ?? null;
          draft.channels.effectif = vals[2] ?? null;

          draft.updatedAt = now();
          await i.update({ embeds: [buildEmbed(draft)], components: buildComponents(draft) });
          return;
        }

        if (i.customId === "setup:roles") {
          const vals = i.values || [];
          draft.roles.staff = vals[0] ?? null;
          draft.roles.player = vals[1] ?? null;
          draft.roles.test = vals[2] ?? null;

          draft.updatedAt = now();
          await i.update({ embeds: [buildEmbed(draft)], components: buildComponents(draft) });
          return;
        }

        if (i.customId === "setup:features") {
          const vals = new Set(i.values || []);
          draft.features.dispos = vals.has("dispos");
          draft.features.pseudos = vals.has("pseudos");
          draft.features.effectif = vals.has("effectif");
          draft.features.planning = vals.has("planning");

          draft.updatedAt = now();
          await i.update({ embeds: [buildEmbed(draft)], components: buildComponents(draft) });
          return;
        }

        if (i.customId === "setup:color") {
          const v = (i.values && i.values[0]) ? i.values[0] : null;
          draft.colors.primary = v;

          draft.updatedAt = now();
          await i.update({ embeds: [buildEmbed(draft)], components: buildComponents(draft) });
          return;
        }

        if (i.customId === "setup:cancel") {
          drafts.delete(keyOf(interaction.guild.id, interaction.user.id));
          collector.stop("cancel");
          await i.update({
            content: "Setup annulé.",
            embeds: [],
            components: []
          });
          return;
        }

        if (i.customId === "setup:save") {
          const missing = computeMissing(draft);
          if (missing.length) {
            return i.reply({
              content: `Impossible d’enregistrer. Manquant : ${missing.join(", ")}.`,
              ephemeral: true
            });
          }

          // Patch final
          setGuildConfig(interaction.guild.id, {
            name: interaction.guild.name,
            colors: { primary: draft.colors.primary },
            roles: { ...draft.roles },
            channels: { ...draft.channels },
            features: { ...draft.features }
          });

          // Ecriture locale (Railway)
          saveAll();

          drafts.delete(keyOf(interaction.guild.id, interaction.user.id));
          collector.stop("saved");

          await i.update({
            content: "Setup enregistré. Utilise maintenant **/export_config** pour récupérer `servers.json` et l’uploader sur GitHub.",
            embeds: [],
            components: []
          });
          return;
        }

        // fallback
        await i.reply({ content: "Interaction non reconnue.", ephemeral: true });
      } catch (e) {
        await i.reply({ content: "Erreur pendant le setup.", ephemeral: true }).catch(() => {});
      }
    });

    collector.on("end", async (_c, reason) => {
      if (reason === "saved" || reason === "cancel") return;

      // Timeout: on verrouille les composants
      try {
        await interaction.editReply({
          content: "Setup expiré (10 min). Relance **/setup** si nécessaire.",
          embeds: [buildEmbed(draft)],
          components: buildComponents(draft, true)
        });
      } catch {
        // ignore
      }
    });
  }
};
