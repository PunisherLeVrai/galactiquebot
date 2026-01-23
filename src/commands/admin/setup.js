// src/commands/admin/setup.js
// Setup interactif : salons + rôles + rôles concernés par les dispos
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
function fmtRoles(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return "—";
  return ids.map((id) => `<@&${id}>`).join("\n");
}

function buildSummaryEmbed(guild, cfgDraft, cfgSaved) {
  return new EmbedBuilder()
    .setTitle("Configuration — Setup")
    .setDescription(
      [
        "Sélectionne les salons et rôles via les menus, puis clique **Enregistrer**.",
        "Aucun ID n’est demandé manuellement.",
      ].join("\n")
    )
    .addFields(
      { name: "Serveur", value: `${guild.name}\nID: ${fmtId(guild.id)}`, inline: false },
      {
        name: "Salons (brouillon)",
        value: [
          `• Salon commandes: ${fmtChannel(cfgDraft.commandsChannelId)}`,
          `• Salon dispos: ${fmtChannel(cfgDraft.disposChannelId)}`,
          `• Salon planning: ${fmtChannel(cfgDraft.planningChannelId)}`,
          `• Salon annonces: ${fmtChannel(cfgDraft.annoncesChannelId)}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Rôles (brouillon)",
        value: [
          `• Rôle Staff: ${fmtRole(cfgDraft.staffRoleId)}`,
          `• Rôle Joueur: ${fmtRole(cfgDraft.playerRoleId)}`,
          `• Rôle Essai: ${fmtRole(cfgDraft.trialRoleId)}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Dispos — rôles concernés (brouillon)",
        value: fmtRoles(cfgDraft.disposScopeRoleIds),
        inline: true,
      },
      {
        name: "Actuel (enregistré)",
        value: [
          `• commandes: ${fmtChannel(cfgSaved.commandsChannelId)}`,
          `• dispos: ${fmtChannel(cfgSaved.disposChannelId)}`,
          `• planning: ${fmtChannel(cfgSaved.planningChannelId)}`,
          `• annonces: ${fmtChannel(cfgSaved.annoncesChannelId)}`,
          `• staff: ${fmtRole(cfgSaved.staffRoleId)}`,
          `• joueur: ${fmtRole(cfgSaved.playerRoleId)}`,
          `• essai: ${fmtRole(cfgSaved.trialRoleId)}`,
          `• roles dispos: ${Array.isArray(cfgSaved.disposScopeRoleIds) ? cfgSaved.disposScopeRoleIds.map((id) => `<@&${id}>`).join(", ") : "—"}`,
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({ text: "XIG BLAUGRANA FC Staff — Setup" });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurer le bot sur ce serveur (salons + rôles).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ content: "Commande serveur uniquement.", flags: FLAGS_EPHEMERAL });
      }

      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "Tu dois être **Administrateur** pour utiliser `/setup`.",
          flags: FLAGS_EPHEMERAL,
        });
      }

      const guild = interaction.guild;
      const guildId = guild.id;

      const cfgSaved = getGuildConfig(guildId) || {};

      const cfgDraft = {
        commandsChannelId: cfgSaved.commandsChannelId || null,
        disposChannelId: cfgSaved.disposChannelId || null,
        planningChannelId: cfgSaved.planningChannelId || null,
        annoncesChannelId: cfgSaved.annoncesChannelId || null,

        staffRoleId: cfgSaved.staffRoleId || null,
        playerRoleId: cfgSaved.playerRoleId || null,
        trialRoleId: cfgSaved.trialRoleId || null,

        // ✅ nouveau
        disposScopeRoleIds: Array.isArray(cfgSaved.disposScopeRoleIds) ? cfgSaved.disposScopeRoleIds : [],
      };

      const scope = `${guildId}:${interaction.user.id}`;
      const CID = {
        commands: `setup:commands:${scope}`,
        dispos: `setup:dispos:${scope}`,
        planning: `setup:planning:${scope}`,
        annonces: `setup:annonces:${scope}`,

        staff: `setup:staff:${scope}`,
        player: `setup:player:${scope}`,
        trial: `setup:trial:${scope}`,

        // ✅ nouveau
        scopeRoles: `setup:scopeRoles:${scope}`,

        save: `setup:save:${scope}`,
        cancel: `setup:cancel:${scope}`,
        reset: `setup:reset:${scope}`,
      };

      const rowCommands = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.commands)
          .setPlaceholder("Salon commandes")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowDispos = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.dispos)
          .setPlaceholder("Salon dispos")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowPlanning = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.planning)
          .setPlaceholder("Salon planning")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowAnnonces = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.annonces)
          .setPlaceholder("Salon annonces")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.save).setLabel("Enregistrer").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CID.reset).setLabel("Réinitialiser").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.cancel).setLabel("Annuler").setStyle(ButtonStyle.Danger)
      );

      // 1/2 : salons + boutons
      await interaction.reply({
        embeds: [buildSummaryEmbed(guild, cfgDraft, cfgSaved)],
        components: [rowCommands, rowDispos, rowPlanning, rowAnnonces, rowButtons],
        flags: FLAGS_EPHEMERAL,
      });

      // 2/2 : rôles
      const rowStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.staff).setPlaceholder("Rôle Staff").setMinValues(0).setMaxValues(1)
      );
      const rowPlayer = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.player).setPlaceholder("Rôle Joueur").setMinValues(0).setMaxValues(1)
      );
      const rowTrial = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.trial).setPlaceholder("Rôle Essai").setMinValues(0).setMaxValues(1)
      );

      // ✅ nouveau : rôles concernés par les dispos (multi)
      const rowScopeRoles = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.scopeRoles)
          .setPlaceholder("Dispos — rôles concernés (1 à 25)")
          .setMinValues(0)
          .setMaxValues(25)
      );

      const rolesMsg = await interaction.followUp({
        content: "Sélection des rôles :",
        components: [rowStaff, rowPlayer, rowTrial, rowScopeRoles],
        flags: FLAGS_EPHEMERAL,
      });

      const mainMsg = await interaction.fetchReply();
      const isOwnerScope = (customId) => typeof customId === "string" && customId.endsWith(scope);

      const refreshMain = async () => {
        await interaction.editReply({
          embeds: [buildSummaryEmbed(guild, cfgDraft, cfgSaved)],
          components: [rowCommands, rowDispos, rowPlanning, rowAnnonces, rowButtons],
        });
      };

      const collectorMain = mainMsg.createMessageComponentCollector({
        time: 10 * 60 * 1000,
      });

      collectorMain.on("collect", async (i) => {
        try {
          if (i.user.id !== interaction.user.id || !isOwnerScope(i.customId)) {
            return i.reply({ content: "Ce setup ne t’appartient pas.", flags: FLAGS_EPHEMERAL });
          }

          if (i.isChannelSelectMenu()) {
            const selected = i.values?.[0] || null;

            if (i.customId === CID.commands) cfgDraft.commandsChannelId = selected;
            if (i.customId === CID.dispos) cfgDraft.disposChannelId = selected;
            if (i.customId === CID.planning) cfgDraft.planningChannelId = selected;
            if (i.customId === CID.annonces) cfgDraft.annoncesChannelId = selected;

            await i.deferUpdate();
            await refreshMain();
            return;
          }

          if (i.isButton()) {
            if (i.customId === CID.reset) {
              cfgDraft.commandsChannelId = null;
              cfgDraft.disposChannelId = null;
              cfgDraft.planningChannelId = null;
              cfgDraft.annoncesChannelId = null;

              cfgDraft.staffRoleId = null;
              cfgDraft.playerRoleId = null;
              cfgDraft.trialRoleId = null;

              cfgDraft.disposScopeRoleIds = [];

              await i.deferUpdate();
              await refreshMain();
              return;
            }

            if (i.customId === CID.cancel) {
              collectorMain.stop("cancel");
              try {
                await rolesMsg.edit({ content: "Setup annulé.", components: [] });
              } catch {}
              return i.update({ content: "Setup annulé.", embeds: [], components: [] });
            }

            if (i.customId === CID.save) {
              const patch = {
                botLabel: "XIG BLAUGRANA FC Staff",
                guildName: guild.name,

                commandsChannelId: cfgDraft.commandsChannelId,
                disposChannelId: cfgDraft.disposChannelId,
                planningChannelId: cfgDraft.planningChannelId,
                annoncesChannelId: cfgDraft.annoncesChannelId,

                staffRoleId: cfgDraft.staffRoleId,
                playerRoleId: cfgDraft.playerRoleId,
                trialRoleId: cfgDraft.trialRoleId,

                // ✅ nouveau
                disposScopeRoleIds: cfgDraft.disposScopeRoleIds,

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

              try {
                await rolesMsg.edit({ content: "Configuration enregistrée.", components: [] });
              } catch {}

              collectorMain.stop("saved");
              return;
            }
          }
        } catch (err) {
          warn("Erreur collector setup (main):", err);
          try {
            if (!i.deferred && !i.replied) {
              await i.reply({ content: "Erreur pendant le setup.", flags: FLAGS_EPHEMERAL });
            }
          } catch {}
        }
      });

      const collectorRoles = rolesMsg.createMessageComponentCollector({
        time: 10 * 60 * 1000,
      });

      collectorRoles.on("collect", async (i) => {
        try {
          if (i.user.id !== interaction.user.id || !isOwnerScope(i.customId)) {
            return i.reply({ content: "Ce setup ne t’appartient pas.", flags: FLAGS_EPHEMERAL });
          }

          if (i.isRoleSelectMenu()) {
            // 1 rôle
            const one = i.values?.[0] || null;

            if (i.customId === CID.staff) cfgDraft.staffRoleId = one;
            if (i.customId === CID.player) cfgDraft.playerRoleId = one;
            if (i.customId === CID.trial) cfgDraft.trialRoleId = one;

            // ✅ multi rôles dispos
            if (i.customId === CID.scopeRoles) {
              cfgDraft.disposScopeRoleIds = Array.isArray(i.values) ? i.values : [];
            }

            await i.deferUpdate();
            await refreshMain();
          }
        } catch (err) {
          warn("Erreur collector setup (roles):", err);
          try {
            if (!i.deferred && !i.replied) {
              await i.reply({ content: "Erreur pendant le setup (rôles).", flags: FLAGS_EPHEMERAL });
            }
          } catch {}
        }
      });

      collectorMain.on("end", async (_c, reason) => {
        try {
          collectorRoles.stop(reason);
          await rolesMsg.edit({ components: [] });
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
      });

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
