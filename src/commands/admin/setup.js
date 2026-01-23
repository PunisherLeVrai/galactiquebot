// src/commands/admin/setup.js
// Setup interactif (sans demander d'IDs à la main) : sélecteurs salons + rôles
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
        name: "Actuel (enregistré)",
        value: [
          `• commandes: ${fmtChannel(cfgSaved.commandsChannelId)}`,
          `• dispos: ${fmtChannel(cfgSaved.disposChannelId)}`,
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
    .setDescription("Configurer le bot sur ce serveur (salons + rôles).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: "Cette commande doit être utilisée dans un serveur.",
          flags: FLAGS_EPHEMERAL,
        });
      }

      // sécurité (au cas où)
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "Tu dois être **Administrateur** pour utiliser `/setup`.",
          flags: FLAGS_EPHEMERAL,
        });
      }

      const guild = interaction.guild;
      const guildId = guild.id;

      // Toujours safe
      const cfgSaved = getGuildConfig(guildId) || {};

      const cfgDraft = {
        commandsChannelId: cfgSaved.commandsChannelId || null,
        disposChannelId: cfgSaved.disposChannelId || null,
        planningChannelId: cfgSaved.planningChannelId || null,
        annoncesChannelId: cfgSaved.annoncesChannelId || null,

        staffRoleId: cfgSaved.staffRoleId || null,
        playerRoleId: cfgSaved.playerRoleId || null,
        trialRoleId: cfgSaved.trialRoleId || null,
      };

      // Scope (serveur + user)
      const scope = `${guildId}:${interaction.user.id}`;
      const CID = {
        commands: `setup:commands:${scope}`,
        dispos: `setup:dispos:${scope}`,
        planning: `setup:planning:${scope}`,
        annonces: `setup:annonces:${scope}`,

        staff: `setup:staff:${scope}`,
        player: `setup:player:${scope}`,
        trial: `setup:trial:${scope}`,

        save: `setup:save:${scope}`,
        cancel: `setup:cancel:${scope}`,
        reset: `setup:reset:${scope}`,
      };

      const embed = buildSummaryEmbed(guild, cfgDraft, cfgSaved);

      // Menus salons
      const rowCommands = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.commands)
          .setPlaceholder("Salon commandes (où tu veux utiliser les commandes)")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowDispos = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.dispos)
          .setPlaceholder("Salon dispos (présences/absences)")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowPlanning = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.planning)
          .setPlaceholder("Salon planning (calendrier/programmation)")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowAnnonces = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.annonces)
          .setPlaceholder("Salon annonces (news/communiqués)")
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      // Menus rôles
      const rowRoles1 = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.staff)
          .setPlaceholder("Rôle Staff")
          .setMinValues(0)
          .setMaxValues(1)
      );
      const rowRoles2 = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.player)
          .setPlaceholder("Rôle Joueur")
          .setMinValues(0)
          .setMaxValues(1)
      );
      const rowRoles3 = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.trial)
          .setPlaceholder("Rôle Essai")
          .setMinValues(0)
          .setMaxValues(1)
      );

      // Boutons
      const rowButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.save).setLabel("Enregistrer").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CID.reset).setLabel("Réinitialiser").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.cancel).setLabel("Annuler").setStyle(ButtonStyle.Danger)
      );

      // Message 1 (salons + boutons) : 5 rows max => OK
      await interaction.reply({
        embeds: [embed],
        components: [rowCommands, rowDispos, rowPlanning, rowAnnonces, rowButtons],
        flags: FLAGS_EPHEMERAL,
      });

      // Message 2 (rôles)
      const rolesMsg = await interaction.followUp({
        content: "Sélection des rôles :",
        components: [rowRoles1, rowRoles2, rowRoles3],
        flags: FLAGS_EPHEMERAL,
      });

      const mainMsg = await interaction.fetchReply();

      const isOwnerScope = (customId) => typeof customId === "string" && customId.endsWith(scope);

      const refreshMain = async () => {
        const updated = buildSummaryEmbed(guild, cfgDraft, cfgSaved);
        await interaction.editReply({
          embeds: [updated],
          components: [rowCommands, rowDispos, rowPlanning, rowAnnonces, rowButtons],
        });
      };

      // Collector principal (menus salons + boutons)
      const collectorMain = mainMsg.createMessageComponentCollector({
        time: 10 * 60 * 1000,
        filter: (i) => i.user.id === interaction.user.id && isOwnerScope(i.customId),
      });

      collectorMain.on("collect", async (i) => {
        try {
          // Menus salons
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

          // Boutons
          if (i.isButton()) {
            if (i.customId === CID.reset) {
              cfgDraft.commandsChannelId = null;
              cfgDraft.disposChannelId = null;
              cfgDraft.planningChannelId = null;
              cfgDraft.annoncesChannelId = null;

              cfgDraft.staffRoleId = null;
              cfgDraft.playerRoleId = null;
              cfgDraft.trialRoleId = null;

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

                setupBy: interaction.user.id,
                setupAt: new Date().toISOString(),
              };

              const saved = upsertGuildConfig(guildId, patch);
              Object.assign(cfgSaved, saved);

              collectorMain.stop("saved");

              try {
                await rolesMsg.edit({ content: "Configuration enregistrée.", components: [] });
              } catch {}

              return i.update({
                content: "Configuration enregistrée.",
                embeds: [buildSummaryEmbed(guild, cfgDraft, cfgSaved)],
                components: [],
              });
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

      // Collector rôles (sur le 2e message)
      const collectorRoles = rolesMsg.createMessageComponentCollector({
        time: 10 * 60 * 1000,
        filter: (i) => i.user.id === interaction.user.id && isOwnerScope(i.customId),
      });

      collectorRoles.on("collect", async (i) => {
        try {
          if (!i.isRoleSelectMenu()) return;

          const selected = i.values?.[0] || null;

          if (i.customId === CID.staff) cfgDraft.staffRoleId = selected;
          if (i.customId === CID.player) cfgDraft.playerRoleId = selected;
          if (i.customId === CID.trial) cfgDraft.trialRoleId = selected;

          await i.deferUpdate();
          await refreshMain();
        } catch (err) {
          warn("Erreur collector setup (roles):", err);
          try {
            if (!i.deferred && !i.replied) {
              await i.reply({ content: "Erreur pendant le setup (rôles).", flags: FLAGS_EPHEMERAL });
            }
          } catch {}
        }
      });

      const disableRolesMsg = async (text) => {
        try {
          await rolesMsg.edit({ content: text, components: [] });
        } catch {}
      };

      collectorMain.on("end", async (_collected, reason) => {
        // stop roles collector aussi
        try {
          collectorRoles.stop(reason);
        } catch {}

        if (reason === "time") {
          await disableRolesMsg("Setup expiré (10 minutes). Relance `/setup` si besoin.");
          try {
            await interaction.editReply({
              content: "Setup expiré (10 minutes). Relance `/setup` si besoin.",
              embeds: [],
              components: [],
            });
          } catch {}
        }
      });

      collectorRoles.on("end", async (_collected, reason) => {
        if (reason === "time") {
          await disableRolesMsg("Setup expiré (10 minutes). Relance `/setup` si besoin.");
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
