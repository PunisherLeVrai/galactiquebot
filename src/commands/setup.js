// src/commands/setup.js
// Setup minimal — 2 messages — multi-serveur
// Requis: 📅 + 📊 + 🛡️ + (au moins 1 rôle joueur)
// + Postes (rôles) configurables pour /pseudo
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
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

  // salons
  dispos: "📅",
  staffReports: "📊",
  pseudoScan: "🎮",

  // rôles
  staff: "🛡️",
  players: "👟",

  // postes
  postes: "📌",

  // actions
  save: "💾",
  reset: "🔄",
  cancel: "❎",
  autoOn: "🤖",
  autoOff: "🛑",
  addPost: "➕",
  resetPosts: "🧹",
};

function fmtCh(id) {
  return id ? `<#${id}>` : "—";
}
function fmtRole(id) {
  return id ? `<@&${id}>` : "—";
}
function fmtRoles(ids) {
  const arr = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return arr.length ? arr.map((id) => `<@&${id}>`).join(" ") : "—";
}

function buildEmbed(guild, draft, autoEnabled) {
  const requiredOk =
    !!draft.disposChannelId &&
    !!draft.staffReportsChannelId &&
    !!draft.staffRoleId &&
    Array.isArray(draft.playerRoleIds) &&
    draft.playerRoleIds.length > 0;

  const postsPreview = (draft.posts || [])
    .slice(0, 8)
    .map((p) => `${p.label || "POSTE"}: <@&${p.roleId}>`)
    .join("\n");

  return new EmbedBuilder()
    .setTitle(`${ICON.title} Setup — ${guild.name}`)
    .setColor(0x5865f2)
    .setDescription(
      [
        requiredOk ? `${ICON.ok} OK` : `${ICON.warn} Incomplet`,
        "",
        "Requis : 📅 Dispos + 📊 Staff + 🛡️ Staff + 👟 (≥1 rôle joueur)",
      ].join("\n")
    )
    .addFields(
      {
        name: "Salons",
        value: [
          `${ICON.dispos} ${fmtCh(draft.disposChannelId)} — Dispos`,
          `${ICON.staffReports} ${fmtCh(draft.staffReportsChannelId)} — Staff`,
          `${ICON.pseudoScan} ${fmtCh(draft.pseudoScanChannelId)} — Pseudos (opt)`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Rôles",
        value: [
          `${ICON.staff} ${fmtRole(draft.staffRoleId)} — Staff`,
          `${ICON.players} ${fmtRoles(draft.playerRoleIds)} — Joueurs (filtre)`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${ICON.postes} Postes (/pseudo)`,
        value: postsPreview ? postsPreview : "—",
        inline: false,
      },
      {
        name: "Automations",
        value: `État: **${autoEnabled ? "ON" : "OFF"}**`,
        inline: false,
      }
    )
    .setFooter({ text: "XIG BLAUGRANA FC Staff" });
}

function inScope(i, scope) {
  return typeof i.customId === "string" && i.customId.endsWith(scope);
}

function cleanLabel(s) {
  const t = String(s || "")
    .replace(/[`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
  return t;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurer salons + rôles (multi) + postes + automations.")
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
        // salons
        disposChannelId: saved.disposChannelId || null,
        staffReportsChannelId: saved.staffReportsChannelId || null,
        pseudoScanChannelId: saved.pseudoScanChannelId || null,

        // rôles
        staffRoleId: saved.staffRoleId || null,
        playerRoleIds: Array.isArray(saved.playerRoleIds) ? saved.playerRoleIds : [],

        // postes
        posts: Array.isArray(saved.posts) ? saved.posts : [],

        // UI temporaire (non stocké)
        pendingPostRoleId: null,
        pendingPostLabel: "MDC", // valeur par défaut modifiable via menu
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
        players: `setup:players:${scope}`,

        // postes
        postRole: `setup:postRole:${scope}`,
        postLabel: `setup:postLabel:${scope}`,
        addPost: `setup:addPost:${scope}`,
        resetPosts: `setup:resetPosts:${scope}`,

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

      // ---------- Message 2 (roles + postes + auto/cancel) ----------
      // Row 1: Staff role
      const rowRoleStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.staff)
          .setPlaceholder(`${ICON.staff} Role Staff`)
          .setMinValues(0)
          .setMaxValues(1)
      );

      // Row 2: Players roles (multi)
      const rowRolePlayers = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.players)
          .setPlaceholder(`${ICON.players} Rôles Joueurs (multi)`)
          .setMinValues(0)
          .setMaxValues(10)
      );

      // Row 3: Post role (single) to bind
      const rowPostRole = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.postRole)
          .setPlaceholder(`${ICON.postes} Rôle Poste (à lier)`)
          .setMinValues(0)
          .setMaxValues(1)
      );

      // Row 4: Post label quick-pick (string select)
      const rowPostLabel = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.postLabel)
          .setPlaceholder(`${ICON.postes} Label Poste`)
          .addOptions(
            { label: "MDC", value: "MDC" },
            { label: "BU", value: "BU" },
            { label: "MOC", value: "MOC" },
            { label: "MC", value: "MC" },
            { label: "DG", value: "DG" },
            { label: "DD", value: "DD" },
            { label: "DC", value: "DC" },
            { label: "GB", value: "GB" }
          )
      );

      // Row 5: actions2 (auto/cancel + add/resetPosts)
      const rowActions2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.addPost)
          .setLabel(`${ICON.addPost} Ajouter Poste`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(CID.resetPosts)
          .setLabel(`${ICON.resetPosts} Reset Postes`)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(CID.auto)
          .setLabel(autoEnabled ? `${ICON.autoOn} Auto` : `${ICON.autoOff} Auto`)
          .setStyle(autoEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(CID.cancel)
          .setLabel(`${ICON.cancel} Cancel`)
          .setStyle(ButtonStyle.Danger)
      );

      const msg2 = await interaction.followUp({
        content: "🧩 Rôles / 📌 Postes",
        components: [rowRoleStaff, rowRolePlayers, rowPostRole, rowPostLabel, rowActions2],
        ephemeral: true,
      });

      const mainMsg = await interaction.fetchReply();

      const refresh = async () => {
        rowActions2.components[2]
          .setLabel(autoEnabled ? `${ICON.autoOn} Auto` : `${ICON.autoOff} Auto`)
          .setStyle(autoEnabled ? ButtonStyle.Success : ButtonStyle.Secondary);

        await interaction.editReply({
          embeds: [buildEmbed(guild, draft, autoEnabled)],
          components: [rowDispos, rowStaffReports, rowPseudoScan, rowActions1],
        });

        await msg2
          .edit({
            content: "🧩 Rôles / 📌 Postes",
            components: [rowRoleStaff, rowRolePlayers, rowPostRole, rowPostLabel, rowActions2],
          })
          .catch(() => {});
      };

      const col1 = mainMsg.createMessageComponentCollector({ time: 10 * 60 * 1000 });
      const col2 = msg2.createMessageComponentCollector({ time: 10 * 60 * 1000 });

      const stopAll = () => {
        try { col1.stop(); } catch {}
        try { col2.stop(); } catch {}
      };

      // ---- Collect Message 1
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
              draft.playerRoleIds = [];

              draft.posts = [];
              draft.pendingPostRoleId = null;
              draft.pendingPostLabel = "MDC";

              autoEnabled = false;

              await i.deferUpdate();
              return refresh();
            }

            if (i.customId === CID.save) {
              const requiredOk =
                !!draft.disposChannelId &&
                !!draft.staffReportsChannelId &&
                !!draft.staffRoleId &&
                Array.isArray(draft.playerRoleIds) &&
                draft.playerRoleIds.length > 0;

              if (!requiredOk) return i.reply({ content: ICON.warn, ephemeral: true });

              upsertGuildConfig(guildId, {
                botLabel: "XIG BLAUGRANA FC Staff",

                disposChannelId: draft.disposChannelId,
                staffReportsChannelId: draft.staffReportsChannelId,
                pseudoScanChannelId: draft.pseudoScanChannelId,

                staffRoleId: draft.staffRoleId,
                playerRoleIds: draft.playerRoleIds,

                posts: draft.posts,

                automations: { enabled: !!autoEnabled },

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

      // ---- Collect Message 2
      col2.on("collect", async (i) => {
        try {
          if (i.user.id !== interaction.user.id || !inScope(i, scope)) {
            return i.reply({ content: ICON.no, ephemeral: true });
          }

          if (i.isRoleSelectMenu()) {
            // Staff
            if (i.customId === CID.staff) {
              draft.staffRoleId = i.values?.[0] || null;
              await i.deferUpdate();
              return refresh();
            }

            // Players multi
            if (i.customId === CID.players) {
              draft.playerRoleIds = Array.isArray(i.values) ? i.values : [];
              await i.deferUpdate();
              return refresh();
            }

            // Post role to bind
            if (i.customId === CID.postRole) {
              draft.pendingPostRoleId = i.values?.[0] || null;
              await i.deferUpdate();
              return refresh();
            }
          }

          if (i.isStringSelectMenu()) {
            if (i.customId === CID.postLabel) {
              draft.pendingPostLabel = cleanLabel(i.values?.[0] || "MDC") || "MDC";
              await i.deferUpdate();
              return refresh();
            }
          }

          if (i.isButton()) {
            if (i.customId === CID.addPost) {
              // nécessite un rôle poste sélectionné
              if (!draft.pendingPostRoleId) {
                await i.reply({ content: ICON.warn, ephemeral: true });
                return;
              }

              const label = cleanLabel(draft.pendingPostLabel) || "POSTE";
              const roleId = draft.pendingPostRoleId;

              // upsert : si roleId déjà présent, on met à jour le label
              const next = (draft.posts || []).filter((p) => p && p.roleId);
              const idx = next.findIndex((p) => p.roleId === roleId);
              if (idx >= 0) next[idx] = { roleId, label };
              else next.push({ roleId, label });

              draft.posts = next;

              await i.deferUpdate();
              return refresh();
            }

            if (i.customId === CID.resetPosts) {
              draft.posts = [];
              draft.pendingPostRoleId = null;
              draft.pendingPostLabel = "MDC";
              await i.deferUpdate();
              return refresh();
            }

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
