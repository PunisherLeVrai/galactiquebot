// src/commands/setup.js
// Setup — 2 messages — multi-serveur
// Requis: 📅 + 📊 + 🛡️ (≥1 rôle staff) + 👟 (≥1 rôle joueur)
// + Postes configurables pour /pseudo : 1..25 rôles (SANS label)
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

  dispos: "📅",
  staffReports: "📊",
  pseudoScan: "🎮",

  staff: "🛡️",
  players: "👟",
  postes: "📌",

  save: "💾",
  reset: "🔄",
  cancel: "❎",
  autoOn: "🤖",
  autoOff: "🛑",
};

function fmtCh(id) {
  return id ? `<#${id}>` : "—";
}
function fmtRoles(ids) {
  const arr = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return arr.length ? arr.map((id) => `<@&${id}>`).join(" ") : "—";
}

function buildEmbed(guild, draft, autoEnabled) {
  const requiredOk =
    !!draft.disposChannelId &&
    !!draft.staffReportsChannelId &&
    Array.isArray(draft.staffRoleIds) &&
    draft.staffRoleIds.length > 0 &&
    Array.isArray(draft.playerRoleIds) &&
    draft.playerRoleIds.length > 0;

  return new EmbedBuilder()
    .setTitle(`${ICON.title} Setup — ${guild.name}`)
    .setColor(0x5865f2)
    .setDescription(
      [
        requiredOk ? `${ICON.ok} OK` : `${ICON.warn} Incomplet`,
        "",
        "Requis : 📅 Dispos + 📊 Staff + 🛡️ (≥1 rôle staff) + 👟 (≥1 rôle joueur)",
        "",
        "Ces réglages servent aux commandes et à /pseudo (export_config ensuite).",
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
          `${ICON.staff} ${fmtRoles(draft.staffRoleIds)} — Staff (commandes + /pseudo)`,
          `${ICON.players} ${fmtRoles(draft.playerRoleIds)} — Joueurs (filtre + /pseudo)`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${ICON.postes} Postes (/pseudo)`,
        value: fmtRoles(draft.postRoleIds),
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

function uniq(arr) {
  const out = [];
  const set = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    if (!v) continue;
    if (set.has(v)) continue;
    set.add(v);
    out.push(v);
  }
  return out;
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

      // Compat: si "posts" existe encore au format [{roleId,label}], on le convertit en postRoleIds
      const legacyPostRoleIds = Array.isArray(saved.posts)
        ? saved.posts.map((p) => p?.roleId).filter(Boolean)
        : [];

      const draft = {
        // salons
        disposChannelId: saved.disposChannelId || null,
        staffReportsChannelId: saved.staffReportsChannelId || null,
        pseudoScanChannelId: saved.pseudoScanChannelId || null,

        // rôles (multi)
        staffRoleIds: Array.isArray(saved.staffRoleIds)
          ? saved.staffRoleIds.filter(Boolean)
          : (saved.staffRoleId ? [saved.staffRoleId] : []),

        playerRoleIds: Array.isArray(saved.playerRoleIds) ? saved.playerRoleIds.filter(Boolean) : [],

        // postes (multi 1..25) SANS label
        postRoleIds: uniq(
          Array.isArray(saved.postRoleIds) ? saved.postRoleIds : legacyPostRoleIds
        ),
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
        posts: `setup:posts:${scope}`,

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

      // defaults salons (best-effort)
      try {
        if (draft.disposChannelId) rowDispos.components[0].setDefaultChannels([draft.disposChannelId]);
        if (draft.staffReportsChannelId) rowStaffReports.components[0].setDefaultChannels([draft.staffReportsChannelId]);
        if (draft.pseudoScanChannelId) rowPseudoScan.components[0].setDefaultChannels([draft.pseudoScanChannelId]);
      } catch {}

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
      const rowRoleStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.staff)
          .setPlaceholder(`${ICON.staff} Rôles Staff (multi)`)
          .setMinValues(0)
          .setMaxValues(25)
      );

      const rowRolePlayers = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.players)
          .setPlaceholder(`${ICON.players} Rôles Joueurs (multi)`)
          .setMinValues(0)
          .setMaxValues(25)
      );

      const rowRolePosts = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.posts)
          .setPlaceholder(`${ICON.postes} Rôles Postes (1 à 25)`)
          .setMinValues(0)
          .setMaxValues(25)
      );

      // defaults rôles (best-effort)
      try {
        if (draft.staffRoleIds.length) rowRoleStaff.components[0].setDefaultRoles(draft.staffRoleIds.slice(0, 25));
        if (draft.playerRoleIds.length) rowRolePlayers.components[0].setDefaultRoles(draft.playerRoleIds.slice(0, 25));
        if (draft.postRoleIds.length) rowRolePosts.components[0].setDefaultRoles(draft.postRoleIds.slice(0, 25));
      } catch {}

      const rowActions2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.auto)
          .setLabel(autoEnabled ? `${ICON.autoOn} Auto` : `${ICON.autoOff} Auto`)
          .setStyle(autoEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.cancel).setLabel(`${ICON.cancel} Cancel`).setStyle(ButtonStyle.Danger)
      );

      const msg2 = await interaction.followUp({
        content: "🧩 Rôles / 📌 Postes",
        components: [rowRoleStaff, rowRolePlayers, rowRolePosts, rowActions2],
        ephemeral: true,
      });

      const mainMsg = await interaction.fetchReply();

      const refresh = async () => {
        rowActions2.components[0]
          .setLabel(autoEnabled ? `${ICON.autoOn} Auto` : `${ICON.autoOff} Auto`)
          .setStyle(autoEnabled ? ButtonStyle.Success : ButtonStyle.Secondary);

        // refresh defaults (best-effort)
        try {
          if (draft.disposChannelId) rowDispos.components[0].setDefaultChannels([draft.disposChannelId]);
          else rowDispos.components[0].setDefaultChannels([]);
          if (draft.staffReportsChannelId) rowStaffReports.components[0].setDefaultChannels([draft.staffReportsChannelId]);
          else rowStaffReports.components[0].setDefaultChannels([]);
          if (draft.pseudoScanChannelId) rowPseudoScan.components[0].setDefaultChannels([draft.pseudoScanChannelId]);
          else rowPseudoScan.components[0].setDefaultChannels([]);

          rowRoleStaff.components[0].setDefaultRoles(draft.staffRoleIds.slice(0, 25));
          rowRolePlayers.components[0].setDefaultRoles(draft.playerRoleIds.slice(0, 25));
          rowRolePosts.components[0].setDefaultRoles(draft.postRoleIds.slice(0, 25));
        } catch {}

        await interaction.editReply({
          embeds: [buildEmbed(guild, draft, autoEnabled)],
          components: [rowDispos, rowStaffReports, rowPseudoScan, rowActions1],
        });

        await msg2
          .edit({
            content: "🧩 Rôles / 📌 Postes",
            components: [rowRoleStaff, rowRolePlayers, rowRolePosts, rowActions2],
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

              draft.staffRoleIds = [];
              draft.playerRoleIds = [];
              draft.postRoleIds = [];

              autoEnabled = false;

              await i.deferUpdate();
              return refresh();
            }

            if (i.customId === CID.save) {
              const requiredOk =
                !!draft.disposChannelId &&
                !!draft.staffReportsChannelId &&
                Array.isArray(draft.staffRoleIds) &&
                draft.staffRoleIds.length > 0 &&
                Array.isArray(draft.playerRoleIds) &&
                draft.playerRoleIds.length > 0;

              if (!requiredOk) return i.reply({ content: ICON.warn, ephemeral: true });

              // Compat export: ancien format "posts" conservé (label neutre)
              const legacyPosts = (draft.postRoleIds || []).map((roleId) => ({ roleId: String(roleId), label: "POSTE" }));

              upsertGuildConfig(guildId, {
                botLabel: "XIG BLAUGRANA FC Staff",

                disposChannelId: draft.disposChannelId,
                staffReportsChannelId: draft.staffReportsChannelId,
                pseudoScanChannelId: draft.pseudoScanChannelId,

                staffRoleIds: uniq(draft.staffRoleIds),
                playerRoleIds: uniq(draft.playerRoleIds),

                // ✅ nouveau format (sans label)
                postRoleIds: uniq(draft.postRoleIds),

                // compat (si d'autres codes lisent encore staffRoleId / posts)
                staffRoleId: draft.staffRoleIds[0] || null,
                posts: legacyPosts,

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
            if (i.customId === CID.staff) {
              draft.staffRoleIds = uniq(i.values);
              await i.deferUpdate();
              return refresh();
            }

            if (i.customId === CID.players) {
              draft.playerRoleIds = uniq(i.values);
              await i.deferUpdate();
              return refresh();
            }

            if (i.customId === CID.posts) {
              // ✅ postes 0..25
              draft.postRoleIds = uniq(i.values);
              await i.deferUpdate();
              return refresh();
            }
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
