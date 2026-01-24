// src/commands/admin/setup.js
// Setup UNIQUE (salons + rôles + automations) via sélecteurs (aucun ID demandé)
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
} = require("discord.js");

// IMPORTANT : adapte l'import si ton core s'appelle configManager.js.
// Ici je prends guildConfig.js (vu dans ton /src/core).
const { getGuildConfig, upsertGuildConfig } = require("../../core/guildConfig");
const { log, warn } = require("../../core/logger");

const FLAGS_EPHEMERAL = 64; // MessageFlags.Ephemeral

function fmtId(id) {
  return id ? `\`${id}\`` : "`—`";
}
function fmtChannel(id) {
  return id ? `<#${id}>` : "—";
}
function fmtRole(id) {
  return id ? `<@&${id}>` : "—";
}
function onOff(v) {
  return v ? "ON" : "OFF";
}

// Helpers safe pour éviter les undefined
function safeCfg(cfg) {
  return cfg && typeof cfg === "object" ? cfg : {};
}
function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}

function buildSummaryEmbed(guild, draft, saved) {
  const savedChannels = safeObj(saved.channels);
  const savedRoles = safeObj(saved.roles);
  const savedAuto = safeObj(saved.automations);

  const draftChannels = safeObj(draft.channels);
  const draftRoles = safeObj(draft.roles);
  const draftAuto = safeObj(draft.automations);

  return new EmbedBuilder()
    .setTitle("Configuration — Setup")
    .setDescription(
      [
        "Configure le bot via menus puis clique **Enregistrer**.",
        "Aucun ID n’est demandé manuellement.",
      ].join("\n")
    )
    .addFields(
      { name: "Serveur", value: `${guild.name}\nID: ${fmtId(guild.id)}`, inline: false },

      {
        name: "Salons (brouillon)",
        value: [
          `• Dispos (Lun→Dim): ${fmtChannel(draftChannels.dispos)}`,
          `• Staff (Rapports/Rappels): ${fmtChannel(draftChannels.staff)}`,
          `• Commandes (optionnel): ${fmtChannel(draftChannels.commandes)}`,
          `• Planning (optionnel): ${fmtChannel(draftChannels.planning)}`,
          `• Annonces (optionnel): ${fmtChannel(draftChannels.annonces)}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Rôles (brouillon)",
        value: [
          `• Staff: ${fmtRole(draftRoles.staff)}`,
          `• Joueur: ${fmtRole(draftRoles.joueur)}`,
          `• Essai (optionnel): ${fmtRole(draftRoles.essai)}`,
        ].join("\n"),
        inline: true,
      },

      {
        name: "Automations (brouillon)",
        value: [
          `• Automations: **${onOff(!!draftAuto.enabled)}**`,
          `• Rappel: ${draftAuto.rappelHour ?? 12}h`,
          `• Rapport: ${draftAuto.rapportHours ? draftAuto.rapportHours.join("h, ") + "h" : "12h, 17h"}`,
          `• Fermeture: ${draftAuto.closeHour ?? 17}h`,
        ].join("\n"),
        inline: false,
      },

      {
        name: "Actuel (enregistré)",
        value: [
          `• Dispos: ${fmtChannel(savedChannels.dispos)}`,
          `• Staff: ${fmtChannel(savedChannels.staff)}`,
          `• Commandes: ${fmtChannel(savedChannels.commandes)}`,
          `• Planning: ${fmtChannel(savedChannels.planning)}`,
          `• Annonces: ${fmtChannel(savedChannels.annonces)}`,
          `• Staff role: ${fmtRole(savedRoles.staff)}`,
          `• Joueur role: ${fmtRole(savedRoles.joueur)}`,
          `• Essai role: ${fmtRole(savedRoles.essai)}`,
          `• Automations: **${onOff(!!savedAuto.enabled)}**`,
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({ text: "XIG BLAUGRANA FC Staff — Setup" });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurer le bot sur ce serveur (salons + rôles + automations).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: "Cette commande doit être utilisée dans un serveur.",
          flags: FLAGS_EPHEMERAL,
        });
      }

      // admin only (sécurité)
      const member = interaction.member;
      if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "Tu dois être **Administrateur** pour utiliser `/setup`.",
          flags: FLAGS_EPHEMERAL,
        });
      }

      const guild = interaction.guild;
      const guildId = guild.id;

      const cfgSaved = safeCfg(getGuildConfig(guildId));

      // Brouillon initial = copie du saved
      const cfgDraft = {
        channels: {
          dispos: cfgSaved.channels?.dispos ?? null,
          staff: cfgSaved.channels?.staff ?? null,
          commandes: cfgSaved.channels?.commandes ?? null,
          planning: cfgSaved.channels?.planning ?? null,
          annonces: cfgSaved.channels?.annonces ?? null,
        },
        roles: {
          staff: cfgSaved.roles?.staff ?? null,
          joueur: cfgSaved.roles?.joueur ?? null,
          essai: cfgSaved.roles?.essai ?? null,
        },
        automations: {
          enabled: cfgSaved.automations?.enabled ?? false,
          rappelHour: cfgSaved.automations?.rappelHour ?? 12,
          rapportHours: cfgSaved.automations?.rapportHours ?? [12, 17],
          closeHour: cfgSaved.automations?.closeHour ?? 17,
        },
      };

      // Scope (verrou serveur + user)
      const scope = `${guildId}:${interaction.user.id}`;
      const CID = {
        // Salons
        dispos: `setup:dispos:${scope}`,
        staff: `setup:staff:${scope}`,
        commandes: `setup:commandes:${scope}`,
        planning: `setup:planning:${scope}`,
        annonces: `setup:annonces:${scope}`,

        // Rôles
        r_staff: `setup:role_staff:${scope}`,
        r_joueur: `setup:role_joueur:${scope}`,
        r_essai: `setup:role_essai:${scope}`,

        // Automations
        toggleAuto: `setup:auto_toggle:${scope}`,

        // Actions
        save: `setup:save:${scope}`,
        reset: `setup:reset:${scope}`,
        cancel: `setup:cancel:${scope}`,
      };

      const isOwnerScope = (customId) => typeof customId === "string" && customId.endsWith(scope);

      const embed = buildSummaryEmbed(guild, cfgDraft, cfgSaved);

      // MESSAGE 1 (Salons + actions) => 5 rows max
      const rowDispos = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.dispos)
          .setPlaceholder("Salon Dispos (messages Lun→Dim) — OBLIGATOIRE")
          .setMinValues(1)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowStaff = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.staff)
          .setPlaceholder("Salon Staff (Rapports/Rappels) — OBLIGATOIRE")
          .setMinValues(1)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowCmd = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.commandes)
          .setPlaceholder("Salon Commandes (optionnel)")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowPlan = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.planning)
          .setPlaceholder("Salon Planning (optionnel)")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.save).setLabel("Enregistrer").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CID.reset).setLabel("Réinitialiser").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.cancel).setLabel("Annuler").setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({
        embeds: [embed],
        components: [rowDispos, rowStaff, rowCmd, rowPlan, rowButtons],
        flags: FLAGS_EPHEMERAL,
      });

      // MESSAGE 2 (Rôles)
      const rowRoleStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.r_staff)
          .setPlaceholder("Rôle Staff — OBLIGATOIRE")
          .setMinValues(1)
          .setMaxValues(1)
      );

      const rowRoleJoueur = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.r_joueur)
          .setPlaceholder("Rôle Joueur — OBLIGATOIRE")
          .setMinValues(1)
          .setMaxValues(1)
      );

      const rowRoleEssai = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.r_essai)
          .setPlaceholder("Rôle Essai (optionnel)")
          .setMinValues(0)
          .setMaxValues(1)
      );

      const rolesMsg = await interaction.followUp({
        content: "Sélection des rôles :",
        components: [rowRoleStaff, rowRoleJoueur, rowRoleEssai],
        flags: FLAGS_EPHEMERAL,
      });

      // MESSAGE 3 (Options / annonces / automations)
      const rowAnnonces = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.annonces)
          .setPlaceholder("Salon Annonces (optionnel)")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowAuto = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.toggleAuto)
          .setLabel(`Automations: ${onOff(!!cfgDraft.automations.enabled)}`)
          .setStyle(cfgDraft.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      );

      const optionsMsg = await interaction.followUp({
        content: "Autres réglages :",
        components: [rowAnnonces, rowAuto],
        flags: FLAGS_EPHEMERAL,
      });

      const mainMsg = await interaction.fetchReply();

      const refreshAll = async () => {
        const updatedEmbed = buildSummaryEmbed(guild, cfgDraft, cfgSaved);

        // update label auto bouton
        rowAuto.components[0].setLabel(`Automations: ${onOff(!!cfgDraft.automations.enabled)}`);
        rowAuto.components[0].setStyle(cfgDraft.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);

        await interaction.editReply({
          embeds: [updatedEmbed],
          components: [rowDispos, rowStaff, rowCmd, rowPlan, rowButtons],
        });

        try {
          await optionsMsg.edit({ components: [rowAnnonces, rowAuto] });
        } catch {}
      };

      // Collectors
      const collectorMain = mainMsg.createMessageComponentCollector({ time: 10 * 60 * 1000 });
      const collectorRoles = rolesMsg.createMessageComponentCollector({ time: 10 * 60 * 1000 });
      const collectorOptions = optionsMsg.createMessageComponentCollector({ time: 10 * 60 * 1000 });

      const ownerGuard = async (i) => {
        if (i.user.id !== interaction.user.id || !isOwnerScope(i.customId)) {
          await i.reply({ content: "Ce setup ne t’appartient pas.", flags: FLAGS_EPHEMERAL });
          return false;
        }
        return true;
      };

      // MAIN (salons + save/reset/cancel)
      collectorMain.on("collect", async (i) => {
        try {
          if (!(await ownerGuard(i))) return;

          if (i.isChannelSelectMenu()) {
            const selected = i.values?.[0] || null;
            if (i.customId === CID.dispos) cfgDraft.channels.dispos = selected;
            if (i.customId === CID.staff) cfgDraft.channels.staff = selected;
            if (i.customId === CID.commandes) cfgDraft.channels.commandes = selected;
            if (i.customId === CID.planning) cfgDraft.channels.planning = selected;

            await i.deferUpdate();
            await refreshAll();
            return;
          }

          if (i.isButton()) {
            if (i.customId === CID.reset) {
              cfgDraft.channels = { dispos: null, staff: null, commandes: null, planning: null, annonces: null };
              cfgDraft.roles = { staff: null, joueur: null, essai: null };
              cfgDraft.automations = { enabled: false, rappelHour: 12, rapportHours: [12, 17], closeHour: 17 };

              await i.deferUpdate();
              await refreshAll();
              return;
            }

            if (i.customId === CID.cancel) {
              collectorMain.stop("cancel");
              collectorRoles.stop("cancel");
              collectorOptions.stop("cancel");

              await i.update({ content: "Setup annulé.", embeds: [], components: [] });
              try { await rolesMsg.edit({ content: "Setup annulé.", components: [] }); } catch {}
              try { await optionsMsg.edit({ content: "Setup annulé.", components: [] }); } catch {}
              return;
            }

            if (i.customId === CID.save) {
              // validations minimum
              if (!cfgDraft.channels.dispos || !cfgDraft.channels.staff || !cfgDraft.roles.staff || !cfgDraft.roles.joueur) {
                return i.reply({
                  content: "Il manque des champs obligatoires : **Salon Dispos**, **Salon Staff**, **Rôle Staff**, **Rôle Joueur**.",
                  flags: FLAGS_EPHEMERAL,
                });
              }

              const patch = {
                botLabel: "XIG BLAUGRANA FC Staff",
                guildName: guild.name,

                channels: { ...cfgDraft.channels },
                roles: { ...cfgDraft.roles },
                automations: { ...cfgDraft.automations },

                setupBy: interaction.user.id,
                setupAt: new Date().toISOString(),
              };

              const saved = upsertGuildConfig(guildId, patch);
              Object.assign(cfgSaved, saved);

              await i.update({
                content: "Configuration enregistrée.",
                embeds: [buildSummaryEmbed(guild, cfgDraft, cfgSaved)],
                components: [],
              });

              try { await rolesMsg.edit({ content: "Configuration enregistrée.", components: [] }); } catch {}
              try { await optionsMsg.edit({ content: "Configuration enregistrée.", components: [] }); } catch {}

              collectorMain.stop("saved");
              collectorRoles.stop("saved");
              collectorOptions.stop("saved");
              return;
            }
          }
        } catch (err) {
          warn("Erreur setup collectorMain:", err);
          try {
            if (!i.deferred && !i.replied) await i.reply({ content: "Erreur pendant le setup.", flags: FLAGS_EPHEMERAL });
          } catch {}
        }
      });

      // ROLES
      collectorRoles.on("collect", async (i) => {
        try {
          if (!(await ownerGuard(i))) return;
          if (!i.isRoleSelectMenu()) return;

          const selected = i.values?.[0] || null;
          if (i.customId === CID.r_staff) cfgDraft.roles.staff = selected;
          if (i.customId === CID.r_joueur) cfgDraft.roles.joueur = selected;
          if (i.customId === CID.r_essai) cfgDraft.roles.essai = selected;

          await i.deferUpdate();
          await refreshAll();
        } catch (err) {
          warn("Erreur setup collectorRoles:", err);
          try {
            if (!i.deferred && !i.replied) await i.reply({ content: "Erreur pendant le setup (rôles).", flags: FLAGS_EPHEMERAL });
          } catch {}
        }
      });

      // OPTIONS (annonces + automations toggle)
      collectorOptions.on("collect", async (i) => {
        try {
          if (!(await ownerGuard(i))) return;

          if (i.isChannelSelectMenu()) {
            const selected = i.values?.[0] || null;
            if (i.customId === CID.annonces) cfgDraft.channels.annonces = selected;

            await i.deferUpdate();
            await refreshAll();
            return;
          }

          if (i.isButton()) {
            if (i.customId === CID.toggleAuto) {
              cfgDraft.automations.enabled = !cfgDraft.automations.enabled;
              await i.deferUpdate();
              await refreshAll();
              return;
            }
          }
        } catch (err) {
          warn("Erreur setup collectorOptions:", err);
          try {
            if (!i.deferred && !i.replied) await i.reply({ content: "Erreur pendant le setup (options).", flags: FLAGS_EPHEMERAL });
          } catch {}
        }
      });

      // Expiration
      const endCleanup = async (reason) => {
        if (reason === "time") {
          try {
            await interaction.editReply({ content: "Setup expiré (10 minutes). Relance `/setup`.", embeds: [], components: [] });
          } catch {}
          try { await rolesMsg.edit({ content: "Setup expiré.", components: [] }); } catch {}
          try { await optionsMsg.edit({ content: "Setup expiré.", components: [] }); } catch {}
        }
      };

      collectorMain.on("end", (_c, reason) => endCleanup(reason));

      log(`[SETUP] lancé par ${interaction.user.tag} sur ${guild.name} (${guildId})`);
    } catch (err) {
      console.error("[SETUP_ERROR]", err);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: "Erreur pendant le setup.", flags: FLAGS_EPHEMERAL });
        } else {
          await interaction.reply({ content: "Erreur pendant le setup.", flags: FLAGS_EPHEMERAL });
        }
      } catch {}
    }
  },
};
