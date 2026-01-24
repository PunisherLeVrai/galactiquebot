// src/commands/admin/setup.js
// SETUP COMPLET (tout ce qu'on a défini) — Premium UI — Buttons emoji-only
// Champs stockés:
// - disposChannelId (📅)
// - staffReportsChannelId (📊)
// - commandsChannelId (⌨️) [opt]
// - planningChannelId (🗓️) [opt]
// - annoncesChannelId (📢) [opt]
// - staffRoleId (🛡️)
// - playerRoleId (👟)
// - trialRoleId (🧪) [opt]
// - automations: { enabled, reminderHour, reportHours, closeHour } (⚙️/🛑)
//
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

const { getGuildConfig, upsertGuildConfig } = require("../../core/guildConfig");
const { log, warn } = require("../../core/logger");

const EPHEMERAL = true;

// Horaires par défaut (ceux qu'on a définis)
const DEFAULT_AUTOMATIONS = {
  enabled: false,
  reminderHour: 12,      // rappel
  reportHours: [12, 17], // rapport
  closeHour: 17,         // fermeture
};

// Emojis UI
const ICON = {
  title: "⚙️",
  channels: "📂",
  roles: "🧩",
  auto: "🤖",

  // salons
  dispos: "📅",
  staffReports: "📊",
  commands: "⌨️",
  planning: "🗓️",
  annonces: "📢",

  // rôles
  staff: "🛡️",
  player: "👟",
  trial: "🧪",

  // actions (emoji-only)
  save: "💾",
  reset: "🔄",
  cancel: "❎",
  autoOn: "⚙️",
  autoOff: "🛑",

  // status
  ok: "✅",
  warn: "⚠️",
  no: "⛔",
  time: "⏳",
};

function fmtId(id) {
  return id ? `\`${id}\`` : "`—`";
}
function fmtCh(id) {
  return id ? `<#${id}>` : "—";
}
function fmtRole(id) {
  return id ? `<@&${id}>` : "—";
}

function normalizeAutomations(saved) {
  const a = saved?.automations || {};
  return {
    enabled: typeof a.enabled === "boolean" ? a.enabled : DEFAULT_AUTOMATIONS.enabled,
    reminderHour: Number.isFinite(a.reminderHour) ? a.reminderHour : DEFAULT_AUTOMATIONS.reminderHour,
    reportHours: Array.isArray(a.reportHours) ? a.reportHours : DEFAULT_AUTOMATIONS.reportHours,
    closeHour: Number.isFinite(a.closeHour) ? a.closeHour : DEFAULT_AUTOMATIONS.closeHour,
  };
}

function buildDashboardEmbed(guild, draft, saved) {
  const auto = normalizeAutomations(saved);

  const requiredOk =
    !!draft.disposChannelId &&
    !!draft.staffReportsChannelId &&
    !!draft.staffRoleId &&
    !!draft.playerRoleId;

  return new EmbedBuilder()
    .setTitle(`${ICON.title} Setup — ${guild.name}`)
    .setColor(0x5865f2)
    .setDescription(
      [
        `${ICON.channels} Salons • ${ICON.roles} Rôles • ${ICON.auto} Auto`,
        "",
        requiredOk ? `${ICON.ok}` : `${ICON.warn}`,
        "",
        "Requis : 📅 + 📊 + 🛡️ + 👟",
      ].join("\n")
    )
    .addFields(
      {
        name: `${ICON.channels} Salons`,
        value: [
          `${ICON.dispos} ${fmtCh(draft.disposChannelId)}  (dispos)`,
          `${ICON.staffReports} ${fmtCh(draft.staffReportsChannelId)}  (staff)`,
          `${ICON.commands} ${fmtCh(draft.commandsChannelId)}  (opt)`,
          `${ICON.planning} ${fmtCh(draft.planningChannelId)}  (opt)`,
          `${ICON.annonces} ${fmtCh(draft.annoncesChannelId)}  (opt)`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${ICON.roles} Rôles`,
        value: [
          `${ICON.staff} ${fmtRole(draft.staffRoleId)}`,
          `${ICON.player} ${fmtRole(draft.playerRoleId)}`,
          `${ICON.trial} ${fmtRole(draft.trialRoleId)} (opt)`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${ICON.auto} Automations`,
        value: [
          `État: **${auto.enabled ? "ON" : "OFF"}**`,
          `🔔 ${auto.reminderHour}h`,
          `📊 ${auto.reportHours.join("h, ")}h`,
          `🔒 ${auto.closeHour}h`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "ID",
        value: fmtId(guild.id),
        inline: false,
      }
    )
    .setFooter({ text: "XIG BLAUGRANA FC Staff" });
}

function isOwnerScope(interaction, componentInteraction, scope) {
  return (
    componentInteraction.user.id === interaction.user.id &&
    typeof componentInteraction.customId === "string" &&
    componentInteraction.customId.endsWith(scope)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurer le bot (salons + rôles + automations).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ content: ICON.no, ephemeral: EPHEMERAL });
      }

      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: ICON.no, ephemeral: EPHEMERAL });
      }

      const guild = interaction.guild;
      const guildId = guild.id;

      // Saved config (safe)
      const saved = getGuildConfig(guildId) || {};
      saved.automations = normalizeAutomations(saved);

      // Draft
      const draft = {
        // salons
        disposChannelId: saved.disposChannelId || null,
        staffReportsChannelId: saved.staffReportsChannelId || null,
        commandsChannelId: saved.commandsChannelId || null,
        planningChannelId: saved.planningChannelId || null,
        annoncesChannelId: saved.annoncesChannelId || null,

        // rôles
        staffRoleId: saved.staffRoleId || null,
        playerRoleId: saved.playerRoleId || null,
        trialRoleId: saved.trialRoleId || null,
      };

      // Scope
      const scope = `${guildId}:${interaction.user.id}`;
      const CID = {
        // salons
        dispos: `setup:dispos:${scope}`,
        staffReports: `setup:staffReports:${scope}`,
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
        autoToggle: `setup:auto:${scope}`,
      };

      // Components (Message 1): salons principaux + boutons (2 rows de boutons max)
      const rowDispos = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.dispos)
          .setPlaceholder(`${ICON.dispos} Dispos`)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowStaffReports = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.staffReports)
          .setPlaceholder(`${ICON.staffReports} Staff (rapports)`)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowCommands = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.commands)
          .setPlaceholder(`${ICON.commands} Commandes (opt)`)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowPlanning = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.planning)
          .setPlaceholder(`${ICON.planning} Planning (opt)`)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      // Buttons row (emoji-only) — mobile safe
      const rowActions1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.save).setLabel(ICON.save).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CID.reset).setLabel(ICON.reset).setStyle(ButtonStyle.Secondary)
      );

      // Message 1 send (5 rows max)
      await interaction.reply({
        embeds: [buildDashboardEmbed(guild, draft, saved)],
        components: [rowDispos, rowStaffReports, rowCommands, rowPlanning, rowActions1],
        ephemeral: EPHEMERAL,
      });

      // Components (Message 2): annonces + rôles + auto/cancel (2 boutons)
      const rowAnnonces = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.annonces)
          .setPlaceholder(`${ICON.annonces} Annonces (opt)`)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowRoleStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.staff)
          .setPlaceholder(`${ICON.staff} Staff`)
          .setMinValues(0)
          .setMaxValues(1)
      );

      const rowRolePlayer = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.player)
          .setPlaceholder(`${ICON.player} Joueur`)
          .setMinValues(0)
          .setMaxValues(1)
      );

      const rowRoleTrial = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.trial)
          .setPlaceholder(`${ICON.trial} Essai (opt)`)
          .setMinValues(0)
          .setMaxValues(1)
      );

      const rowActions2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.autoToggle)
          .setLabel(saved.automations.enabled ? ICON.autoOn : ICON.autoOff)
          .setStyle(saved.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.cancel).setLabel(ICON.cancel).setStyle(ButtonStyle.Danger)
      );

      const msg2 = await interaction.followUp({
        content: "🧩",
        components: [rowAnnonces, rowRoleStaff, rowRolePlayer, rowRoleTrial, rowActions2],
        ephemeral: EPHEMERAL,
      });

      const mainMsg = await interaction.fetchReply();

      const refresh = async () => {
        // refresh auto button state
        rowActions2.components[0].setLabel(saved.automations.enabled ? ICON.autoOn : ICON.autoOff);
        rowActions2.components[0].setStyle(saved.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);

        await interaction.editReply({
          embeds: [buildDashboardEmbed(guild, draft, saved)],
          components: [rowDispos, rowStaffReports, rowCommands, rowPlanning, rowActions1],
        });

        await msg2.edit({
          content: "🧩",
          components: [rowAnnonces, rowRoleStaff, rowRolePlayer, rowRoleTrial, rowActions2],
        }).catch(() => {});
      };

      const collectorMain = mainMsg.createMessageComponentCollector({ time: 10 * 60 * 1000 });
      const collector2 = msg2.createMessageComponentCollector({ time: 10 * 60 * 1000 });

      const stopAll = (reason) => {
        try { collectorMain.stop(reason); } catch {}
        try { collector2.stop(reason); } catch {}
      };

      // Message 1 collector
      collectorMain.on("collect", async (i) => {
        try {
          if (!isOwnerScope(interaction, i, scope)) {
            return i.reply({ content: ICON.no, ephemeral: true });
          }

          if (i.isChannelSelectMenu()) {
            const v = i.values?.[0] || null;

            if (i.customId === CID.dispos) draft.disposChannelId = v;
            if (i.customId === CID.staffReports) draft.staffReportsChannelId = v;
            if (i.customId === CID.commands) draft.commandsChannelId = v;
            if (i.customId === CID.planning) draft.planningChannelId = v;

            await i.deferUpdate();
            return refresh();
          }

          if (i.isButton()) {
            if (i.customId === CID.reset) {
              draft.disposChannelId = null;
              draft.staffReportsChannelId = null;
              draft.commandsChannelId = null;
              draft.planningChannelId = null;
              draft.annoncesChannelId = null;

              draft.staffRoleId = null;
              draft.playerRoleId = null;
              draft.trialRoleId = null;

              saved.automations = { ...DEFAULT_AUTOMATIONS };

              await i.deferUpdate();
              return refresh();
            }

            if (i.customId === CID.save) {
              // requis : 📅 + 📊 + 🛡️ + 👟
              const requiredOk =
                !!draft.disposChannelId &&
                !!draft.staffReportsChannelId &&
                !!draft.staffRoleId &&
                !!draft.playerRoleId;

              if (!requiredOk) {
                return i.reply({ content: ICON.warn, ephemeral: true });
              }

              const patch = {
                botLabel: "XIG BLAUGRANA FC Staff",
                guildName: guild.name,

                // salons
                disposChannelId: draft.disposChannelId,
                staffReportsChannelId: draft.staffReportsChannelId,
                commandsChannelId: draft.commandsChannelId,
                planningChannelId: draft.planningChannelId,
                annoncesChannelId: draft.annoncesChannelId,

                // rôles
                staffRoleId: draft.staffRoleId,
                playerRoleId: draft.playerRoleId,
                trialRoleId: draft.trialRoleId,

                // auto
                automations: normalizeAutomations(saved),

                setupBy: interaction.user.id,
                setupAt: new Date().toISOString(),
              };

              const savedNow = upsertGuildConfig(guildId, patch);
              Object.assign(saved, savedNow);
              saved.automations = normalizeAutomations(saved);

              stopAll("saved");

              await i.update({
                content: ICON.save,
                embeds: [buildDashboardEmbed(guild, draft, saved)],
                components: [],
              });

              await msg2.edit({ content: ICON.save, components: [] }).catch(() => {});
              return;
            }
          }
        } catch (e) {
          warn("setup collectorMain error:", e);
          try {
            if (!i.deferred && !i.replied) await i.reply({ content: ICON.warn, ephemeral: true });
          } catch {}
        }
      });

      // Message 2 collector
      collector2.on("collect", async (i) => {
        try {
          if (!isOwnerScope(interaction, i, scope)) {
            return i.reply({ content: ICON.no, ephemeral: true });
          }

          if (i.isChannelSelectMenu()) {
            const v = i.values?.[0] || null;
            if (i.customId === CID.annonces) draft.annoncesChannelId = v;

            await i.deferUpdate();
            return refresh();
          }

          if (i.isRoleSelectMenu()) {
            const v = i.values?.[0] || null;

            if (i.customId === CID.staff) draft.staffRoleId = v;
            if (i.customId === CID.player) draft.playerRoleId = v;
            if (i.customId === CID.trial) draft.trialRoleId = v;

            await i.deferUpdate();
            return refresh();
          }

          if (i.isButton()) {
            if (i.customId === CID.autoToggle) {
              saved.automations = normalizeAutomations(saved);
              saved.automations.enabled = !saved.automations.enabled;

              await i.deferUpdate();
              return refresh();
            }

            if (i.customId === CID.cancel) {
              stopAll("cancel");

              await i.update({ content: ICON.cancel, components: [] }).catch(() => {});
              try {
                await interaction.editReply({ content: ICON.cancel, embeds: [], components: [] });
              } catch {}
              return;
            }
          }
        } catch (e) {
          warn("setup collector2 error:", e);
          try {
            if (!i.deferred && !i.replied) await i.reply({ content: ICON.warn, ephemeral: true });
          } catch {}
        }
      });

      collectorMain.on("end", async (_c, reason) => {
        if (reason === "time") {
          try {
            await interaction.editReply({ content: ICON.time, embeds: [], components: [] });
          } catch {}
          try {
            await msg2.edit({ content: ICON.time, components: [] });
          } catch {}
        }
      });

      log(`[SETUP COMPLET] ${interaction.user.tag} sur ${guild.name} (${guildId})`);
    } catch (e) {
      warn("[SETUP_ERROR]", e);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: ICON.warn, ephemeral: true });
        } else {
          await interaction.followUp({ content: ICON.warn, ephemeral: true });
        }
      } catch {}
    }
  },
};
