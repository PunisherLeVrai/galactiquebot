// src/commands/admin/setup.js
// Setup interactif : salons + rôles + salon staff rapports
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

const { getGuildConfig, upsertGuildConfig } = require("../../core/configManager");
const { log, warn } = require("../../core/logger");

const FLAGS_EPHEMERAL = 64;

function fmtId(id) {
  return id ? `\`${id}\`` : "`—`";
}
function fmtChannel(id) {
  return id ? `<#${id}>` : "—";
}
function fmtRole(id) {
  return id ? `<@&${id}>` : "—";
}

function buildSummaryEmbed(guild, draft, saved) {
  return new EmbedBuilder()
    .setTitle("Configuration — Setup")
    .setDescription(
      [
        "Configure les salons + rôles via les menus.",
        "Puis clique **Enregistrer**.",
      ].join("\n")
    )
    .addFields(
      { name: "Serveur", value: `${guild.name}\nID: ${fmtId(guild.id)}`, inline: false },

      {
        name: "Salons (brouillon)",
        value: [
          `• Dispos: ${fmtChannel(draft.disposChannelId)}`,
          `• Staff (rapports): ${fmtChannel(draft.reportChannelId)}`,
          `• Commandes: ${fmtChannel(draft.commandsChannelId)}`,
          `• Planning: ${fmtChannel(draft.planningChannelId)}`,
          `• Annonces: ${fmtChannel(draft.annoncesChannelId)}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Rôles (brouillon)",
        value: [
          `• Staff: ${fmtRole(draft.staffRoleId)}`,
          `• Joueur: ${fmtRole(draft.playerRoleId)}`,
          `• Essai: ${fmtRole(draft.trialRoleId)}`,
        ].join("\n"),
        inline: true,
      },

      {
        name: "Actuel (enregistré)",
        value: [
          `• Dispos: ${fmtChannel(saved.disposChannelId)}`,
          `• Staff (rapports): ${fmtChannel(saved.reportChannelId)}`,
          `• Commandes: ${fmtChannel(saved.commandsChannelId)}`,
          `• Planning: ${fmtChannel(saved.planningChannelId)}`,
          `• Annonces: ${fmtChannel(saved.annoncesChannelId)}`,
          `• Staff: ${fmtRole(saved.staffRoleId)}`,
          `• Joueur: ${fmtRole(saved.playerRoleId)}`,
          `• Essai: ${fmtRole(saved.trialRoleId)}`,
          "",
          `• Automations: **${saved.automationsEnabled ? "ON" : "OFF"}**`,
          `• Rappel: ${Array.isArray(saved.automationReminderHours) ? saved.automationReminderHours.join(", ") : "12"}h`,
          `• Rapport: ${Array.isArray(saved.automationReportHours) ? saved.automationReportHours.join(", ") : "12, 17"}h`,
          `• Fermeture: ${Array.isArray(saved.automationCloseHours) ? saved.automationCloseHours.join(", ") : "17"}h`,
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({ text: "XIG BLAUGRANA FC Staff — Setup" });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurer le bot (salons + rôles).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: "Cette commande doit être utilisée dans un serveur.",
          flags: FLAGS_EPHEMERAL,
        });
      }

      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "Tu dois être **Administrateur** pour utiliser `/setup`.",
          flags: FLAGS_EPHEMERAL,
        });
      }

      const guild = interaction.guild;
      const guildId = guild.id;

      const saved = getGuildConfig(guildId) || {};

      // Defaults d'automations demandés
      const savedDefaults = {
        automationsEnabled: saved.automationsEnabled ?? false,
        automationReminderHours: Array.isArray(saved.automationReminderHours) ? saved.automationReminderHours : [12],
        automationReportHours: Array.isArray(saved.automationReportHours) ? saved.automationReportHours : [12, 17],
        automationCloseHours: Array.isArray(saved.automationCloseHours) ? saved.automationCloseHours : [17],
      };

      // Brouillon initial = saved
      const draft = {
        // salons
        disposChannelId: saved.disposChannelId || null,
        reportChannelId: saved.reportChannelId || null,
        commandsChannelId: saved.commandsChannelId || null,
        planningChannelId: saved.planningChannelId || null,
        annoncesChannelId: saved.annoncesChannelId || null,

        // rôles
        staffRoleId: saved.staffRoleId || null,
        playerRoleId: saved.playerRoleId || null,
        trialRoleId: saved.trialRoleId || null,

        // automations (on garde des defaults même si pas encore set)
        ...savedDefaults,
      };

      // Custom IDs (scopé user+guild)
      const scope = `${guildId}:${interaction.user.id}`;
      const CID = {
        // salons
        dispos: `setup:dispos:${scope}`,
        report: `setup:report:${scope}`,
        commands: `setup:commands:${scope}`,
        planning: `setup:planning:${scope}`,
        annonces: `setup:annonces:${scope}`,

        // rôles
        staff: `setup:staff:${scope}`,
        player: `setup:player:${scope}`,
        trial: `setup:trial:${scope}`,

        // actions
        save: `setup:save:${scope}`,
        reset: `setup:reset:${scope}`,
        cancel: `setup:cancel:${scope}`,
      };

      const embed = buildSummaryEmbed(guild, draft, { ...saved, ...savedDefaults });

      // Message 1 (max 5 rows): salons + boutons
      const rowDispos = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.dispos)
          .setPlaceholder("Salon Dispos (messages Lun→Dim)")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowReport = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.report)
          .setPlaceholder("Salon Staff (Rapports/Rappels)")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowCommands = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.commands)
          .setPlaceholder("Salon Commandes (optionnel)")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowPlanning = new ActionRowBuilder().addComponents(
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
        components: [rowDispos, rowReport, rowCommands, rowPlanning, rowButtons],
        flags: FLAGS_EPHEMERAL,
      });

      // Message 2 : annonces + rôles (4 rows)
      const rowAnnonces = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.annonces)
          .setPlaceholder("Salon Annonces (optionnel)")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.staff).setPlaceholder("Rôle Staff").setMinValues(0).setMaxValues(1)
      );

      const rowPlayer = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.player).setPlaceholder("Rôle Joueur").setMinValues(0).setMaxValues(1)
      );

      const rowTrial = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.trial).setPlaceholder("Rôle Essai (optionnel)").setMinValues(0).setMaxValues(1)
      );

      const msg2 = await interaction.followUp({
        content: "Autres réglages :",
        components: [rowAnnonces, rowStaff, rowPlayer, rowTrial],
        flags: FLAGS_EPHEMERAL,
      });

      const mainMsg = await interaction.fetchReply();

      const isOwnerScope = (customId) => typeof customId === "string" && customId.endsWith(scope);

      const refresh = async () => {
        const newEmbed = buildSummaryEmbed(guild, draft, { ...saved, ...savedDefaults });
        await interaction.editReply({
          embeds: [newEmbed],
          components: [rowDispos, rowReport, rowCommands, rowPlanning, rowButtons],
        });
      };

      // Collector message 1
      const col1 = mainMsg.createMessageComponentCollector({
        time: 10 * 60 * 1000,
      });

      col1.on("collect", async (i) => {
        try {
          if (i.user.id !== interaction.user.id || !isOwnerScope(i.customId)) {
            return i.reply({ content: "Ce setup ne t’appartient pas.", flags: FLAGS_EPHEMERAL });
          }

          if (i.isChannelSelectMenu()) {
            const selected = i.values?.[0] || null;

            if (i.customId === CID.dispos) draft.disposChannelId = selected;
            if (i.customId === CID.report) draft.reportChannelId = selected;
            if (i.customId === CID.commands) draft.commandsChannelId = selected;
            if (i.customId === CID.planning) draft.planningChannelId = selected;

            await i.deferUpdate();
            await refresh();
            return;
          }

          if (i.isButton()) {
            if (i.customId === CID.reset) {
              draft.disposChannelId = null;
              draft.reportChannelId = null;
              draft.commandsChannelId = null;
              draft.planningChannelId = null;
              draft.annoncesChannelId = null;

              draft.staffRoleId = null;
              draft.playerRoleId = null;
              draft.trialRoleId = null;

              // automations defaults
              draft.automationsEnabled = false;
              draft.automationReminderHours = [12];
              draft.automationReportHours = [12, 17];
              draft.automationCloseHours = [17];

              await i.deferUpdate();
              await refresh();
              return;
            }

            if (i.customId === CID.cancel) {
              col1.stop("cancel");
              try {
                await msg2.edit({ components: [] });
              } catch {}
              return i.update({ content: "Setup annulé.", embeds: [], components: [] });
            }

            if (i.customId === CID.save) {
              const patch = {
                botLabel: "XIG BLAUGRANA FC Staff",
                guildName: guild.name,

                // salons
                disposChannelId: draft.disposChannelId,
                reportChannelId: draft.reportChannelId,
                commandsChannelId: draft.commandsChannelId,
                planningChannelId: draft.planningChannelId,
                annoncesChannelId: draft.annoncesChannelId,

                // rôles
                staffRoleId: draft.staffRoleId,
                playerRoleId: draft.playerRoleId,
                trialRoleId: draft.trialRoleId,

                // automations (valeurs demandées)
                automationsEnabled: draft.automationsEnabled,
                automationReminderHours: draft.automationReminderHours,
                automationReportHours: draft.automationReportHours,
                automationCloseHours: draft.automationCloseHours,

                setupBy: interaction.user.id,
                setupAt: new Date().toISOString(),
              };

              const savedNow = upsertGuildConfig(guildId, patch);
              Object.assign(saved, savedNow);

              await i.update({
                content: "Configuration enregistrée.",
                embeds: [buildSummaryEmbed(guild, draft, { ...saved, ...savedDefaults })],
                components: [],
              });

              try {
                await msg2.edit({ content: "Configuration enregistrée.", components: [] });
              } catch {}

              col1.stop("saved");
              return;
            }
          }
        } catch (err) {
          warn("Erreur setup collector (msg1):", err);
          try {
            if (!i.deferred && !i.replied) {
              await i.reply({ content: "Erreur pendant le setup.", flags: FLAGS_EPHEMERAL });
            }
          } catch {}
        }
      });

      // Collector message 2 (annonces + rôles)
      const col2 = msg2.createMessageComponentCollector({
        componentType: ComponentType.ActionRow, // on filtre après
        time: 10 * 60 * 1000,
      });

      col2.on("collect", async (i) => {
        try {
          if (i.user.id !== interaction.user.id || !isOwnerScope(i.customId)) {
            return i.reply({ content: "Ce setup ne t’appartient pas.", flags: FLAGS_EPHEMERAL });
          }

          if (i.isChannelSelectMenu()) {
            const selected = i.values?.[0] || null;
            if (i.customId === CID.annonces) draft.annoncesChannelId = selected;

            await i.deferUpdate();
            await refresh();
            return;
          }

          if (i.isRoleSelectMenu()) {
            const selected = i.values?.[0] || null;
            if (i.customId === CID.staff) draft.staffRoleId = selected;
            if (i.customId === CID.player) draft.playerRoleId = selected;
            if (i.customId === CID.trial) draft.trialRoleId = selected;

            await i.deferUpdate();
            await refresh();
            return;
          }
        } catch (err) {
          warn("Erreur setup collector (msg2):", err);
          try {
            if (!i.deferred && !i.replied) {
              await i.reply({ content: "Erreur pendant le setup.", flags: FLAGS_EPHEMERAL });
            }
          } catch {}
        }
      });

      const cleanup = async () => {
        try {
          await msg2.edit({ components: [] });
        } catch {}
      };

      col1.on("end", async (_c, reason) => {
        col2.stop(reason);
        await cleanup();

        if (reason === "time") {
          try {
            await interaction.editReply({
              content: "Setup expiré (10 minutes). Relance `/setup` si besoin.",
              embeds: [],
              components: [],
            });
          } catch {}
        }
      });

      log(`[SETUP] ${interaction.user.tag} sur ${guild.name} (${guildId})`);
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
