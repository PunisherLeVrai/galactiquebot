// src/commands/setup.js
// Setup minimal multi-serveur — emoji-only — 2 messages (limite 5 rows respectée)
// Requis: 📅 disposChannelId, 📊 staffReportsChannelId, 🛡️ staffRoleId, 👟 playerRoleId
// Option: 🎮 pseudo.scanChannelId, 🧪 trialRoleId
// Toggle: 🤖 automations.enabled
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

const { getGuildConfig, upsertGuildConfig } = require("../core/guildConfig");
const { warn, log } = require("../core/logger");

const EPHEMERAL = true;

const ICON = {
  no: "⛔",
  warn: "⚠️",
  ok: "✅",
  time: "⏳",

  title: "⚙️",
  channels: "📂",
  roles: "🧩",
  auto: "🤖",

  // salons
  dispos: "📅",
  staffReports: "📊",
  pseudoScan: "🎮",

  // rôles
  staff: "🛡️",
  player: "👟",
  trial: "🧪",

  // actions
  save: "💾",
  reset: "🔄",
  cancel: "❎",
  autoOn: "🤖",
  autoOff: "🛑",
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

function normalizeEnabled(cfg) {
  const enabled = cfg?.automations?.enabled;
  return typeof enabled === "boolean" ? enabled : false;
}

function buildEmbed(guild, draft, enabled) {
  const requiredOk =
    !!draft.disposChannelId &&
    !!draft.staffReportsChannelId &&
    !!draft.staffRoleId &&
    !!draft.playerRoleId;

  return new EmbedBuilder()
    .setTitle(`${ICON.title} ${guild.name}`)
    .setColor(0x5865f2)
    .setDescription(
      [
        `${ICON.channels} ${ICON.roles} ${ICON.auto}`,
        "",
        requiredOk ? ICON.ok : ICON.warn,
        "",
        "Requis : 📅 + 📊 + 🛡️ + 👟",
      ].join("\n")
    )
    .addFields(
      {
        name: `${ICON.channels}`,
        value: [
          `${ICON.dispos} ${fmtCh(draft.disposChannelId)}`,
          `${ICON.staffReports} ${fmtCh(draft.staffReportsChannelId)}`,
          `${ICON.pseudoScan} ${fmtCh(draft.pseudoScanChannelId)} (opt)`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${ICON.roles}`,
        value: [
          `${ICON.staff} ${fmtRole(draft.staffRoleId)}`,
          `${ICON.player} ${fmtRole(draft.playerRoleId)}`,
          `${ICON.trial} ${fmtRole(draft.trialRoleId)} (opt)`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${ICON.auto}`,
        value: `**${enabled ? "ON" : "OFF"}**`,
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

function isOwner(i, scope) {
  return typeof i.customId === "string" && i.customId.endsWith(scope) && i.user?.id === scope.split(":")[1];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("⚙️")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: ICON.no, ephemeral: EPHEMERAL });
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: ICON.no, ephemeral: EPHEMERAL });
      }

      const guild = interaction.guild;
      const guildId = guild.id;

      const saved = getGuildConfig(guildId) || {};
      let enabled = normalizeEnabled(saved);

      const draft = {
        // salons
        disposChannelId: saved.disposChannelId || null,
        staffReportsChannelId: saved.staffReportsChannelId || null,
        pseudoScanChannelId: saved?.pseudo?.scanChannelId || null,

        // rôles
        staffRoleId: saved.staffRoleId || null,
        playerRoleId: saved.playerRoleId || null,
        trialRoleId: saved.trialRoleId || null,
      };

      const scope = `${guildId}:${interaction.user.id}`;

      const CID = {
        dispos: `setup:dispos:${scope}`,
        staffReports: `setup:staffReports:${scope}`,
        pseudoScan: `setup:pseudoScan:${scope}`,

        staff: `setup:staff:${scope}`,
        player: `setup:player:${scope}`,
        trial: `setup:trial:${scope}`,

        save: `setup:save:${scope}`,
        reset: `setup:reset:${scope}`,
        cancel: `setup:cancel:${scope}`,
        auto: `setup:auto:${scope}`,
      };

      // ----- Message 1 (salons) -----
      const rowDispos = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.dispos)
          .setPlaceholder(ICON.dispos)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowStaffReports = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.staffReports)
          .setPlaceholder(ICON.staffReports)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowPseudoScan = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.pseudoScan)
          .setPlaceholder(ICON.pseudoScan)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowActions1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.save).setLabel(ICON.save).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CID.reset).setLabel(ICON.reset).setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        embeds: [buildEmbed(guild, draft, enabled)],
        components: [rowDispos, rowStaffReports, rowPseudoScan, rowActions1],
        ephemeral: EPHEMERAL,
      });

      // ----- Message 2 (roles + auto) -----
      const rowRoleStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.staff).setPlaceholder(ICON.staff).setMinValues(0).setMaxValues(1)
      );
      const rowRolePlayer = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.player).setPlaceholder(ICON.player).setMinValues(0).setMaxValues(1)
      );
      const rowRoleTrial = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.trial).setPlaceholder(ICON.trial).setMinValues(0).setMaxValues(1)
      );

      const rowActions2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.auto)
          .setLabel(enabled ? ICON.autoOn : ICON.autoOff)
          .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.cancel).setLabel(ICON.cancel).setStyle(ButtonStyle.Danger)
      );

      const msg2 = await interaction.followUp({
        content: ICON.roles,
        components: [rowRoleStaff, rowRolePlayer, rowRoleTrial, rowActions2],
        ephemeral: EPHEMERAL,
      });

      const msg1 = await interaction.fetchReply();

      const refresh = async () => {
        rowActions2.components[0].setLabel(enabled ? ICON.autoOn : ICON.autoOff);
        rowActions2.components[0].setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary);

        await interaction.editReply({
          embeds: [buildEmbed(guild, draft, enabled)],
          components: [rowDispos, rowStaffReports, rowPseudoScan, rowActions1],
        });

        await msg2
          .edit({
            content: ICON.roles,
            components: [rowRoleStaff, rowRolePlayer, rowRoleTrial, rowActions2],
          })
          .catch(() => {});
      };

      const col1 = msg1.createMessageComponentCollector({ time: 10 * 60 * 1000 });
      const col2 = msg2.createMessageComponentCollector({ time: 10 * 60 * 1000 });

      const stopAll = (reason) => {
        try { col1.stop(reason); } catch {}
        try { col2.stop(reason); } catch {}
      };

      col1.on("collect", async (i) => {
        try {
          if (!isOwner(i, scope)) return i.reply({ content: ICON.no, ephemeral: true });

          if (i.isChannelSelectMenu()) {
            const v = i.values?.[0] || null;

            if (i.customId === CID.dispos) draft.disposChannelId = v;
            if (i.customId === CID.staffReports) draft.staffReportsChannelId = v;
            if (i.customId === CID.pseudoScan) draft.pseudoScanChannelId = v;

            await i.deferUpdate();
            return refresh();
          }

          if (i.isButton()) {
            if (i.customId === CID.reset) {
              draft.disposChannelId = null;
              draft.staffReportsChannelId = null;
              draft.pseudoScanChannelId = null;

              draft.staffRoleId = null;
              draft.playerRoleId = null;
              draft.trialRoleId = null;

              enabled = false;

              await i.deferUpdate();
              return refresh();
            }

            if (i.customId === CID.save) {
              const requiredOk =
                !!draft.disposChannelId &&
                !!draft.staffReportsChannelId &&
                !!draft.staffRoleId &&
                !!draft.playerRoleId;

              if (!requiredOk) return i.reply({ content: ICON.warn, ephemeral: true });

              const patch = {
                botLabel: "XIG BLAUGRANA FC Staff",
                guildName: guild.name,

                disposChannelId: draft.disposChannelId,
                staffReportsChannelId: draft.staffReportsChannelId,

                staffRoleId: draft.staffRoleId,
                playerRoleId: draft.playerRoleId,
                trialRoleId: draft.trialRoleId,

                pseudo: { ...(saved.pseudo || {}), scanChannelId: draft.pseudoScanChannelId },
                automations: { ...(saved.automations || {}), enabled: !!enabled },

                setupBy: interaction.user.id,
                setupAt: new Date().toISOString(),
              };

              upsertGuildConfig(guildId, patch);

              stopAll("saved");

              await i.update({
                content: ICON.save,
                embeds: [buildEmbed(guild, draft, enabled)],
                components: [],
              });

              await msg2.edit({ content: ICON.save, components: [] }).catch(() => {});
              return;
            }
          }
        } catch (e) {
          warn("[SETUP_COL1]", e);
          try { if (!i.deferred && !i.replied) await i.reply({ content: ICON.warn, ephemeral: true }); } catch {}
        }
      });

      col2.on("collect", async (i) => {
        try {
          if (!isOwner(i, scope)) return i.reply({ content: ICON.no, ephemeral: true });

          if (i.isRoleSelectMenu()) {
            const v = i.values?.[0] || null;

            if (i.customId === CID.staff) draft.staffRoleId = v;
            if (i.customId === CID.player) draft.playerRoleId = v;
            if (i.customId === CID.trial) draft.trialRoleId = v;

            await i.deferUpdate();
            return refresh();
          }

          if (i.isButton()) {
            if (i.customId === CID.auto) {
              enabled = !enabled;
              await i.deferUpdate();
              return refresh();
            }

            if (i.customId === CID.cancel) {
              stopAll("cancel");
              await i.update({ content: ICON.cancel, components: [] }).catch(() => {});
              try { await interaction.editReply({ content: ICON.cancel, embeds: [], components: [] }); } catch {}
              try { await msg2.edit({ content: ICON.cancel, components: [] }); } catch {}
              return;
            }
          }
        } catch (e) {
          warn("[SETUP_COL2]", e);
          try { if (!i.deferred && !i.replied) await i.reply({ content: ICON.warn, ephemeral: true }); } catch {}
        }
      });

      col1.on("end", async (_c, reason) => {
        if (reason === "time") {
          try { await interaction.editReply({ content: ICON.time, embeds: [], components: [] }); } catch {}
          try { await msg2.edit({ content: ICON.time, components: [] }); } catch {}
        }
      });

      log(`[SETUP] ${interaction.user.tag} ${guild.name} (${guildId})`);
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
