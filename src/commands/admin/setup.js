// src/commands/admin/setup.js
// Setup interactif : salons + rôles + automatisations (ON/OFF + horaires)
// discord.js v14 — CommonJS

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
} = require("discord.js");

const { getGuildConfig, upsertGuildConfig } = require("../../core/guildConfig");
const { log, warn } = require("../../core/logger");

const EPHEMERAL = true;

// Horaires par défaut (tu pourras les modifier plus tard via une autre commande si tu veux)
const DEFAULT_AUTOMATIONS = {
  enabled: false,
  reminderHour: 12,         // rappel à 12h
  reportHours: [12, 17],    // rapports à 12h et 17h
  closeHour: 17,            // fermeture à 17h
};

function fmtId(id) {
  return id ? `\`${id}\`` : "`—`";
}
function fmtChannel(id) {
  return id ? `<#${id}>` : "—";
}
function fmtRole(id) {
  return id ? `<@&${id}>` : "—";
}
function fmtAuto(cfgSaved) {
  const a = cfgSaved?.automations || DEFAULT_AUTOMATIONS;
  const onOff = a.enabled ? "ON" : "OFF";
  const report = Array.isArray(a.reportHours) ? a.reportHours.join(", ") : "12, 17";
  return [
    `• Automations: **${onOff}**`,
    `• Rappel: **${a.reminderHour ?? 12}h**`,
    `• Rapport: **${report}h**`,
    `• Fermeture: **${a.closeHour ?? 17}h**`,
  ].join("\n");
}

function buildSummaryEmbed(guild, cfgDraft, cfgSaved) {
  return new EmbedBuilder()
    .setTitle("Configuration — Setup")
    .setDescription(
      [
        "Sélectionne les salons et rôles via les menus, puis clique **Enregistrer**.",
        "Bouton **Automations ON/OFF** disponible.",
      ].join("\n")
    )
    .addFields(
      { name: "Serveur", value: `${guild.name}\nID: ${fmtId(guild.id)}` },

      {
        name: "Salons (brouillon)",
        value: [
          `• Dispos: ${fmtChannel(cfgDraft.disposChannelId)}`,
          `• Staff (rapports/rappels): ${fmtChannel(cfgDraft.staffReportsChannelId)}`,
          `• Commandes (optionnel): ${fmtChannel(cfgDraft.commandsChannelId)}`,
          `• Planning (optionnel): ${fmtChannel(cfgDraft.planningChannelId)}`,
          `• Annonces (optionnel): ${fmtChannel(cfgDraft.annoncesChannelId)}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Rôles (brouillon)",
        value: [
          `• Staff: ${fmtRole(cfgDraft.staffRoleId)}`,
          `• Joueur: ${fmtRole(cfgDraft.playerRoleId)}`,
          `• Essai (optionnel): ${fmtRole(cfgDraft.trialRoleId)}`,
        ].join("\n"),
        inline: false,
      },

      {
        name: "Automatisations (enregistré)",
        value: fmtAuto(cfgSaved),
        inline: false,
      },

      {
        name: "Actuel (enregistré)",
        value: [
          `• dispos: ${fmtChannel(cfgSaved.disposChannelId)}`,
          `• staffReports: ${fmtChannel(cfgSaved.staffReportsChannelId)}`,
          `• commandes: ${fmtChannel(cfgSaved.commandsChannelId)}`,
          `• planning: ${fmtChannel(cfgSaved.planningChannelId)}`,
          `• annonces: ${fmtChannel(cfgSaved.annoncesChannelId)}`,
          `• staff: ${fmtRole(cfgSaved.staffRoleId)}`,
          `• joueur: ${fmtRole(cfgSaved.playerRoleId)}`,
          `• essai: ${fmtRole(cfgSaved.trialRoleId)}`,
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({ text: "XIG BLAUGRANA FC Staff — Setup" });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurer le bot (salons + rôles + automatisations).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: "Commande utilisable uniquement sur un serveur.",
          ephemeral: EPHEMERAL,
        });
      }

      const member = interaction.member;
      if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "Tu dois être **Administrateur** pour utiliser `/setup`.",
          ephemeral: EPHEMERAL,
        });
      }

      const guild = interaction.guild;
      const guildId = guild.id;

      // Config enregistrée (safe)
      const cfgSaved = getGuildConfig(guildId) || {};

      // Assure que automations existe (en mémoire, puis sauvegardé à l’enregistrement)
      if (!cfgSaved.automations) cfgSaved.automations = { ...DEFAULT_AUTOMATIONS };

      // Brouillon
      const cfgDraft = {
        disposChannelId: cfgSaved.disposChannelId || null,
        staffReportsChannelId: cfgSaved.staffReportsChannelId || null,
        commandsChannelId: cfgSaved.commandsChannelId || null,
        planningChannelId: cfgSaved.planningChannelId || null,
        annoncesChannelId: cfgSaved.annoncesChannelId || null,

        staffRoleId: cfgSaved.staffRoleId || null,
        playerRoleId: cfgSaved.playerRoleId || null,
        trialRoleId: cfgSaved.trialRoleId || null,
      };

      // IDs des composants verrouillés (serveur + user)
      const scope = `${guildId}:${interaction.user.id}`;
      const CID = {
        dispos: `setup:dispos:${scope}`,
        staffReports: `setup:staffReports:${scope}`,
        commands: `setup:commands:${scope}`,
        planning: `setup:planning:${scope}`,
        annonces: `setup:annonces:${scope}`,

        staff: `setup:staff:${scope}`,
        player: `setup:player:${scope}`,
        trial: `setup:trial:${scope}`,

        autoToggle: `setup:autoToggle:${scope}`,

        save: `setup:save:${scope}`,
        reset: `setup:reset:${scope}`,
        cancel: `setup:cancel:${scope}`,
      };

      const isOwnerScope = (customId) =>
        typeof customId === "string" && customId.endsWith(scope);

      const embed = buildSummaryEmbed(guild, cfgDraft, cfgSaved);

      // Message 1 (max 5 rows) : salons + boutons
      const rowDispos = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.dispos)
          .setPlaceholder("Salon Dispos (messages Lun→Dim)")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowStaffReports = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.staffReports)
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
        components: [rowDispos, rowStaffReports, rowCommands, rowPlanning, rowButtons],
        ephemeral: EPHEMERAL,
      });

      // Message 2 : annonces + rôles + automations ON/OFF
      const rowAnnonces = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.annonces)
          .setPlaceholder("Salon Annonces (optionnel)")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.staff)
          .setPlaceholder("Rôle Staff")
          .setMinValues(0)
          .setMaxValues(1)
      );

      const rowPlayer = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.player)
          .setPlaceholder("Rôle Joueur")
          .setMinValues(0)
          .setMaxValues(1)
      );

      const rowTrial = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.trial)
          .setPlaceholder("Rôle Essai (optionnel)")
          .setMinValues(0)
          .setMaxValues(1)
      );

      const rowAuto = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.autoToggle)
          .setLabel(cfgSaved.automations.enabled ? "Automations: ON (cliquer pour OFF)" : "Automations: OFF (cliquer pour ON)")
          .setStyle(cfgSaved.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      );

      const msg2 = await interaction.followUp({
        content: "Autres réglages :",
        components: [rowAnnonces, rowStaff, rowPlayer, rowTrial, rowAuto],
        ephemeral: EPHEMERAL,
      });

      const mainMsg = await interaction.fetchReply();

      const refreshMain = async () => {
        const updated = buildSummaryEmbed(guild, cfgDraft, cfgSaved);
        await interaction.editReply({
          embeds: [updated],
          components: [rowDispos, rowStaffReports, rowCommands, rowPlanning, rowButtons],
        });
      };

      const refreshMsg2 = async () => {
        const rowAutoUpdated = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(CID.autoToggle)
            .setLabel(cfgSaved.automations.enabled ? "Automations: ON (cliquer pour OFF)" : "Automations: OFF (cliquer pour ON)")
            .setStyle(cfgSaved.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
        );

        await msg2.edit({
          content: "Autres réglages :",
          components: [rowAnnonces, rowStaff, rowPlayer, rowTrial, rowAutoUpdated],
        });
      };

      const disableSecond = async (text) => {
        try {
          await msg2.edit({ content: text || "Terminé.", components: [] });
        } catch {}
      };

      // IMPORTANT : ne PAS mettre componentType ici (sinon ça casse les menus et ça fait "Échec de l'interaction")
      const collectorMain = mainMsg.createMessageComponentCollector({
        time: 10 * 60 * 1000,
      });

      const collector2 = msg2.createMessageComponentCollector({
        time: 10 * 60 * 1000,
      });

      collectorMain.on("collect", async (i) => {
        try {
          if (i.user.id !== interaction.user.id || !isOwnerScope(i.customId)) {
            return i.reply({ content: "Ce setup ne t’appartient pas.", ephemeral: true });
          }

          if (i.isChannelSelectMenu()) {
            const selected = i.values?.[0] || null;

            if (i.customId === CID.dispos) cfgDraft.disposChannelId = selected;
            if (i.customId === CID.staffReports) cfgDraft.staffReportsChannelId = selected;
            if (i.customId === CID.commands) cfgDraft.commandsChannelId = selected;
            if (i.customId === CID.planning) cfgDraft.planningChannelId = selected;

            await i.deferUpdate();
            await refreshMain();
            return;
          }

          if (i.isButton()) {
            if (i.customId === CID.reset) {
              cfgDraft.disposChannelId = null;
              cfgDraft.staffReportsChannelId = null;
              cfgDraft.commandsChannelId = null;
              cfgDraft.planningChannelId = null;
              cfgDraft.annoncesChannelId = null;

              cfgDraft.staffRoleId = null;
              cfgDraft.playerRoleId = null;
              cfgDraft.trialRoleId = null;

              // reset automations en mémoire (et ça sera sauvegardé si tu enregistres)
              cfgSaved.automations = { ...DEFAULT_AUTOMATIONS };

              await i.deferUpdate();
              await refreshMain();
              await refreshMsg2();
              return;
            }

            if (i.customId === CID.cancel) {
              collectorMain.stop("cancel");
              collector2.stop("cancel");
              await i.update({ content: "Setup annulé.", embeds: [], components: [] });
              await disableSecond("Setup annulé.");
              return;
            }

            if (i.customId === CID.save) {
              const patch = {
                botLabel: "XIG BLAUGRANA FC Staff",
                guildName: guild.name,

                disposChannelId: cfgDraft.disposChannelId,
                staffReportsChannelId: cfgDraft.staffReportsChannelId,
                commandsChannelId: cfgDraft.commandsChannelId,
                planningChannelId: cfgDraft.planningChannelId,
                annoncesChannelId: cfgDraft.annoncesChannelId,

                staffRoleId: cfgDraft.staffRoleId,
                playerRoleId: cfgDraft.playerRoleId,
                trialRoleId: cfgDraft.trialRoleId,

                automations: cfgSaved.automations || { ...DEFAULT_AUTOMATIONS },

                setupBy: interaction.user.id,
                setupAt: new Date().toISOString(),
              };

              const saved = upsertGuildConfig(guildId, patch);
              Object.assign(cfgSaved, saved);

              collectorMain.stop("saved");
              collector2.stop("saved");

              await i.update({
                content: "Configuration enregistrée.",
                embeds: [buildSummaryEmbed(guild, cfgDraft, cfgSaved)],
                components: [],
              });

              await disableSecond("Configuration enregistrée.");
              return;
            }
          }
        } catch (err) {
          warn("Erreur setup collectorMain:", err);
          try {
            if (!i.deferred && !i.replied) {
              await i.reply({ content: "Erreur pendant le setup.", ephemeral: true });
            }
          } catch {}
        }
      });

      collector2.on("collect", async (i) => {
        try {
          if (i.user.id !== interaction.user.id || !isOwnerScope(i.customId)) {
            return i.reply({ content: "Ce setup ne t’appartient pas.", ephemeral: true });
          }

          if (i.isChannelSelectMenu()) {
            const selected = i.values?.[0] || null;
            if (i.customId === CID.annonces) cfgDraft.annoncesChannelId = selected;

            await i.deferUpdate();
            await refreshMain();
            return;
          }

          if (i.isRoleSelectMenu()) {
            const selected = i.values?.[0] || null;

            if (i.customId === CID.staff) cfgDraft.staffRoleId = selected;
            if (i.customId === CID.player) cfgDraft.playerRoleId = selected;
            if (i.customId === CID.trial) cfgDraft.trialRoleId = selected;

            await i.deferUpdate();
            await refreshMain();
            return;
          }

          if (i.isButton() && i.customId === CID.autoToggle) {
            cfgSaved.automations = cfgSaved.automations || { ...DEFAULT_AUTOMATIONS };
            cfgSaved.automations.enabled = !cfgSaved.automations.enabled;

            await i.deferUpdate();
            await refreshMain();
            await refreshMsg2();
            return;
          }
        } catch (err) {
          warn("Erreur setup collector2:", err);
          try {
            if (!i.deferred && !i.replied) {
              await i.reply({ content: "Erreur pendant le setup.", ephemeral: true });
            }
          } catch {}
        }
      });

      const endCleanup = async (reason) => {
        try {
          await disableSecond(reason === "time" ? "Setup expiré (10 minutes)." : "Terminé.");
        } catch {}
      };

      collectorMain.on("end", async (_c, reason) => {
        try {
          collector2.stop(reason);
        } catch {}

        if (reason === "time") {
          try {
            await interaction.editReply({
              content: "Setup expiré (10 minutes). Relance `/setup` si besoin.",
              embeds: [],
              components: [],
            });
          } catch {}
        }
        await endCleanup(reason);
      });

      log(`[SETUP] lancé par ${interaction.user.tag} sur ${guild.name} (${guildId})`);
    } catch (err) {
      warn("[SETUP_ERROR]", err);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: "Erreur pendant le setup.", ephemeral: true });
        } else {
          await interaction.reply({ content: "Erreur pendant le setup.", ephemeral: true });
        }
      } catch {}
    }
  },
};
