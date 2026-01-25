// src/commands/setup.js
// Setup minimal — 2 messages — emoji + mot-clé — multi-serveur
// Requis: 📅 + 📊 + 🛡️ + 👟
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

const ICON = {
  no: "⛔",
  warn: "⚠️",
  ok: "✅",
  time: "⏳",

  title: "⚙️",
  ch: "📂",
  roles: "🧩",
  auto: "🤖",

  dispos: "📅",
  staffReports: "📊",
  pseudoScan: "🎮",

  staff: "🛡️",
  player: "👟",
  trial: "🧪",

  save: "💾",
  reset: "🔄",
  cancel: "❎",
  autoOn: "🤖",
  autoOff: "🛑",
};

function fmtCh(id) {
  return id ? `<#${id}>` : "—";
}
function fmtRole(id) {
  return id ? `<@&${id}>` : "—";
}

function buildEmbed(guild, draft, autoEnabled) {
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
        `${ICON.ch} Salons • ${ICON.roles} Rôles • ${ICON.auto} Auto`,
        "",
        requiredOk ? `${ICON.ok} OK` : `${ICON.warn} Incomplet`,
        "",
        "Requis : 📅 Dispos + 📊 Staff + 🛡️ Staff + 👟 Joueur",
      ].join("\n")
    )
    .addFields(
      {
        name: `${ICON.ch} Salons`,
        value: [
          `${ICON.dispos} ${fmtCh(draft.disposChannelId)} — Dispos`,
          `${ICON.staffReports} ${fmtCh(draft.staffReportsChannelId)} — Staff`,
          `${ICON.pseudoScan} ${fmtCh(draft.pseudoScanChannelId)} — Pseudos (opt)`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${ICON.roles} Rôles`,
        value: [
          `${ICON.staff} ${fmtRole(draft.staffRoleId)} — Staff`,
          `${ICON.player} ${fmtRole(draft.playerRoleId)} — Joueur`,
          `${ICON.trial} ${fmtRole(draft.trialRoleId)} — Essai (opt)`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${ICON.auto} Automations`,
        value: `État: **${autoEnabled ? "ON" : "OFF"}**`,
        inline: false,
      }
    )
    .setFooter({ text: "XIG BLAUGRANA FC Staff" });
}

function inScope(i, scope) {
  return typeof i.customId === "string" && i.customId.endsWith(scope);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurer salons + rôles + automations.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: ICON.no, ephemeral: true });
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: ICON.no, ephemeral: true });
      }

      const guild = interaction.guild;
      const guildId = guild.id;

      const saved = getGuildConfig(guildId) || {};
      const draft = {
        disposChannelId: saved.disposChannelId || null,
        staffReportsChannelId: saved.staffReportsChannelId || null,
        pseudoScanChannelId: saved.pseudoScanChannelId || saved.pseudo?.scanChannelId || null,

        staffRoleId: saved.staffRoleId || null,
        playerRoleId: saved.playerRoleId || null,
        trialRoleId: saved.trialRoleId || null,
      };

      let autoEnabled = !!saved?.automations?.enabled;

      const scope = `${guildId}:${interaction.user.id}`;
      const CID = {
        // channels
        dispos: `setup:dispos:${scope}`,
        staffReports: `setup:staffReports:${scope}`,
        pseudoScan: `setup:pseudoScan:${scope}`,

        // roles
        staff: `setup:staff:${scope}`,
        player: `setup:player:${scope}`,
        trial: `setup:trial:${scope}`,

        // actions
        save: `setup:save:${scope}`,
        reset: `setup:reset:${scope}`,
        cancel: `setup:cancel:${scope}`,
        auto: `setup:auto:${scope}`,
      };

      // ---------- Message 1 (channels + save/reset) ----------
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
          .setPlaceholder(`${ICON.staffReports} Staff`)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowPseudoScan = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.pseudoScan)
          .setPlaceholder(`${ICON.pseudoScan} Pseudos (opt)`)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowActions1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.save).setLabel(`${ICON.save} Save`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CID.reset).setLabel(`${ICON.reset} Reset`).setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        embeds: [buildEmbed(guild, draft, autoEnabled)],
        components: [rowDispos, rowStaffReports, rowPseudoScan, rowActions1],
        ephemeral: true,
      });

      // ---------- Message 2 (roles + auto/cancel) ----------
      const rowRoleStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.staff)
          .setPlaceholder(`${ICON.staff} Role Staff`)
          .setMinValues(0)
          .setMaxValues(1)
      );

      const rowRolePlayer = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.player)
          .setPlaceholder(`${ICON.player} Role Joueur`)
          .setMinValues(0)
          .setMaxValues(1)
      );

      const rowRoleTrial = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.trial)
          .setPlaceholder(`${ICON.trial} Role Essai (opt)`)
          .setMinValues(0)
          .setMaxValues(1)
      );

      const rowActions2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.auto)
          .setLabel(autoEnabled ? `${ICON.autoOn} Auto` : `${ICON.autoOff} Auto`)
          .setStyle(autoEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.cancel).setLabel(`${ICON.cancel} Cancel`).setStyle(ButtonStyle.Danger)
      );

      const msg2 = await interaction.followUp({
        content: `${ICON.roles} Roles`,
        components: [rowRoleStaff, rowRolePlayer, rowRoleTrial, rowActions2],
        ephemeral: true,
      });

      const mainMsg = await interaction.fetchReply();

      const refresh = async () => {
        rowActions2.components[0]
          .setLabel(autoEnabled ? `${ICON.autoOn} Auto` : `${ICON.autoOff} Auto`)
          .setStyle(autoEnabled ? ButtonStyle.Success : ButtonStyle.Secondary);

        await interaction.editReply({
          embeds: [buildEmbed(guild, draft, autoEnabled)],
          components: [rowDispos, rowStaffReports, rowPseudoScan, rowActions1],
        });

        await msg2
          .edit({
            content: `${ICON.roles} Roles`,
            components: [rowRoleStaff, rowRolePlayer, rowRoleTrial, rowActions2],
          })
          .catch(() => {});
      };

      const col1 = mainMsg.createMessageComponentCollector({ time: 10 * 60 * 1000 });
      const col2 = msg2.createMessageComponentCollector({ time: 10 * 60 * 1000 });

      const stopAll = () => {
        try { col1.stop(); } catch {}
        try { col2.stop(); } catch {}
      };

      col1.on("collect", async (i) => {
        try {
          if (i.user.id !== interaction.user.id || !inScope(i, scope)) {
            return i.reply({ content: ICON.no, ephemeral: true });
          }

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

              autoEnabled = false;

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

              upsertGuildConfig(guildId, {
                botLabel: "XIG BLAUGRANA FC Staff",

                disposChannelId: draft.disposChannelId,
                staffReportsChannelId: draft.staffReportsChannelId,
                pseudoScanChannelId: draft.pseudoScanChannelId,

                staffRoleId: draft.staffRoleId,
                playerRoleId: draft.playerRoleId,
                trialRoleId: draft.trialRoleId,

                // minimal: ON/OFF
                automations: { enabled: !!autoEnabled },

                // (optionnel) compat pseudo store
                pseudo: { scanChannelId: draft.pseudoScanChannelId },

                setupBy: interaction.user.id,
                setupAt: new Date().toISOString(),
              });

              stopAll();
              await i
                .update({
                  content: `${ICON.save} Saved`,
                  embeds: [buildEmbed(guild, draft, autoEnabled)],
                  components: [],
                })
                .catch(() => {});
              await msg2.edit({ content: `${ICON.save} Saved`, components: [] }).catch(() => {});
            }
          }
        } catch {
          try { if (!i.replied) await i.reply({ content: ICON.warn, ephemeral: true }); } catch {}
        }
      });

      col2.on("collect", async (i) => {
        try {
          if (i.user.id !== interaction.user.id || !inScope(i, scope)) {
            return i.reply({ content: ICON.no, ephemeral: true });
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
            if (i.customId === CID.auto) {
              autoEnabled = !autoEnabled;
              await i.deferUpdate();
              return refresh();
            }

            if (i.customId === CID.cancel) {
              stopAll();
              await i.update({ content: `${ICON.cancel} Cancel`, components: [] }).catch(() => {});
              try { await interaction.editReply({ content: `${ICON.cancel} Cancel`, embeds: [], components: [] }); } catch {}
              try { await msg2.edit({ content: `${ICON.cancel} Cancel`, components: [] }); } catch {}
            }
          }
        } catch {
          try { if (!i.replied) await i.reply({ content: ICON.warn, ephemeral: true }); } catch {}
        }
      });

      col1.on("end", async () => {
        try { await interaction.editReply({ content: ICON.time, embeds: [], components: [] }); } catch {}
        try { await msg2.edit({ content: ICON.time, components: [] }); } catch {}
      });
    } catch {
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "⚠️", ephemeral: true });
        } else {
          await interaction.followUp({ content: "⚠️", ephemeral: true });
        }
      } catch {}
    }
  },
};
