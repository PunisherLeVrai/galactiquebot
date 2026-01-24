// src/commands/admin/setup.js
// SETUP COMPLET — salons + rôles + automations + pseudos + mainRoles + postes
// ✅ Buttons emoji-only
// ✅ 4 messages éphémères (limite 5 rows OK)
// ✅ Interactions stables (deferUpdate immédiat + refresh optimisé)
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

const DEFAULT_AUTOMATIONS = {
  enabled: false,
  reminderHour: 12,
  reportHours: [12, 17],
  closeHour: 17,
};

const ICON = {
  title: "⚙️",
  no: "⛔",
  warn: "⚠️",
  ok: "✅",
  time: "⏳",

  // sections
  channels: "📂",
  roles: "🧩",
  auto: "🤖",
  pseudo: "🎮",

  // channels
  dispos: "📅",
  staffReports: "📊",
  commands: "⌨️",
  planning: "🗓️",
  annonces: "📢",
  pseudoScan: "🎮",

  // roles (bot features)
  staffRole: "🛡️",
  playerRole: "👟",
  trialRole: "🧪",

  // main roles (display)
  president: "👑",
  fondateur: "🏛️",
  gm: "📌",
  cogm: "📎",
  staffDisplay: "🧷",

  // posts
  posts: "📍",

  // actions
  save: "💾",
  reset: "🔄",
  cancel: "❎",
  autoOn: "⚙️",
  autoOff: "🛑",
};

function fmtCh(id) {
  return id ? `<#${id}>` : "—";
}
function fmtRole(id) {
  return id ? `<@&${id}>` : "—";
}
function normalizeAutomations(saved) {
  const a = saved?.automations || {};
  const reportHours =
    Array.isArray(a.reportHours) && a.reportHours.length ? a.reportHours : DEFAULT_AUTOMATIONS.reportHours;

  return {
    enabled: typeof a.enabled === "boolean" ? a.enabled : DEFAULT_AUTOMATIONS.enabled,
    reminderHour: Number.isFinite(a.reminderHour) ? a.reminderHour : DEFAULT_AUTOMATIONS.reminderHour,
    reportHours,
    closeHour: Number.isFinite(a.closeHour) ? a.closeHour : DEFAULT_AUTOMATIONS.closeHour,
  };
}

function normalizePseudo(saved) {
  const p = saved?.pseudo || {};
  return {
    scanChannelId: p.scanChannelId || null,
    deleteMessages: p.deleteMessages === true,
    syncEnabled: p.syncEnabled !== false, // défaut true
    syncFetchMembers: p.syncFetchMembers !== false, // défaut true
    reminderEnabled: p.reminderEnabled === true, // défaut false
    reminderHours: Array.isArray(p.reminderHours) && p.reminderHours.length ? p.reminderHours : [12, 17, 21],
  };
}

function normalizeMainRoles(saved) {
  const mr = saved?.mainRoles || {};
  return {
    president: { id: mr?.president?.id || null },
    fondateur: { id: mr?.fondateur?.id || null },
    gm: { id: mr?.gm?.id || null },
    cogm: { id: mr?.cogm?.id || null },
    staff: { id: mr?.staff?.id || null },
  };
}

function normalizePosts(saved) {
  // saved.posts = [{id,label}]
  const posts = Array.isArray(saved?.posts) ? saved.posts : [];
  // on garde seulement les ids valides
  const ids = posts.map((p) => p?.id).filter(Boolean);
  return Array.from(new Set(ids));
}

function buildDashboardEmbed(guild, draft) {
  const requiredOk =
    !!draft.disposChannelId &&
    !!draft.staffReportsChannelId &&
    !!draft.staffRoleId &&
    !!draft.playerRoleId;

  const auto = draft.automations;
  const pseudo = draft.pseudo;
  const mr = draft.mainRoles;

  const postsCount = Array.isArray(draft.postsRoleIds) ? draft.postsRoleIds.length : 0;

  return new EmbedBuilder()
    .setTitle(`${ICON.title} Setup — ${guild.name}`)
    .setColor(0x5865f2)
    .setDescription(
      [
        `${ICON.channels} ${ICON.roles} ${ICON.auto} ${ICON.pseudo}`,
        "",
        requiredOk ? ICON.ok : ICON.warn,
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
          `${ICON.pseudoScan} ${fmtCh(pseudo.scanChannelId)}  (scan pseudos)`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${ICON.roles} Rôles bot`,
        value: [
          `${ICON.staffRole} ${fmtRole(draft.staffRoleId)}`,
          `${ICON.playerRole} ${fmtRole(draft.playerRoleId)}`,
          `${ICON.trialRole} ${fmtRole(draft.trialRoleId)} (opt)`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `🏷️ Rôles affichés (mainRoles)`,
        value: [
          `${ICON.president} ${fmtRole(mr.president.id)}`,
          `${ICON.fondateur} ${fmtRole(mr.fondateur.id)}`,
          `${ICON.gm} ${fmtRole(mr.gm.id)}`,
          `${ICON.cogm} ${fmtRole(mr.cogm.id)}`,
          `${ICON.staffDisplay} ${fmtRole(mr.staff.id)}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${ICON.posts} Postes`,
        value: postsCount ? `Sélectionnés: **${postsCount}** (affiche jusqu’à 3)` : "—",
        inline: false,
      },
      {
        name: `${ICON.auto} Automations dispos`,
        value: [
          `État: **${auto.enabled ? "ON" : "OFF"}**`,
          `🔔 ${auto.reminderHour}h`,
          `📊 ${auto.reportHours.join("h, ")}h`,
          `🔒 ${auto.closeHour}h`,
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({ text: "XIG BLAUGRANA FC Staff" });
}

// IDs courts (réduit les risques + reste < 100 chars)
function mkScope(guildId, userId) {
  return `${guildId.slice(-6)}${userId.slice(-6)}`; // 12 chars
}
function isOwner(i, scope) {
  return typeof i.customId === "string" && i.customId.endsWith(`:${scope}`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurer le bot (salons + rôles + automations + pseudos).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: ICON.no, ephemeral: EPHEMERAL });
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: ICON.no, ephemeral: EPHEMERAL });
      }

      const guild = interaction.guild;
      const guildId = guild.id;

      // utile pour mapper roleId -> role.name lors du Save (posts)
      try { await guild.roles.fetch(); } catch {}

      const saved = getGuildConfig(guildId) || {};
      const scope = mkScope(guildId, interaction.user.id);

      const draft = {
        // channels
        disposChannelId: saved.disposChannelId || null,
        staffReportsChannelId: saved.staffReportsChannelId || null,
        commandsChannelId: saved.commandsChannelId || null,
        planningChannelId: saved.planningChannelId || null,
        annoncesChannelId: saved.annoncesChannelId || null,

        // roles bot
        staffRoleId: saved.staffRoleId || null,
        playerRoleId: saved.playerRoleId || null,
        trialRoleId: saved.trialRoleId || null,

        // automations
        automations: normalizeAutomations(saved),

        // pseudo config
        pseudo: normalizePseudo(saved),

        // display roles
        mainRoles: normalizeMainRoles(saved),

        // posts role ids (multi)
        postsRoleIds: normalizePosts(saved),
      };

      // ---------- Custom IDs ----------
      const CID = {
        // msg1 channels
        dispos: `s:ch:dispos:${scope}`,
        staffReports: `s:ch:staff:${scope}`,
        commands: `s:ch:cmd:${scope}`,
        planning: `s:ch:plan:${scope}`,
        save: `s:save:${scope}`,
        reset: `s:reset:${scope}`,

        // msg2 channels + roles + toggle
        annonces: `s:ch:ann:${scope}`,
        pseudoScan: `s:ch:ps:${scope}`,
        staffRole: `s:r:staff:${scope}`,
        playerRole: `s:r:player:${scope}`,
        trialRole: `s:r:trial:${scope}`,
        autoToggle: `s:auto:${scope}`,
        cancel: `s:cancel:${scope}`,

        // msg3 mainRoles (display)
        mr_president: `s:mr:p:${scope}`,
        mr_fondateur: `s:mr:f:${scope}`,
        mr_gm: `s:mr:g:${scope}`,
        mr_cogm: `s:mr:c:${scope}`,
        mr_staff: `s:mr:s:${scope}`,

        // msg4 posts
        posts: `s:posts:${scope}`,
      };

      // ---------- Message 1 (4 channels + save/reset) ----------
      const rowDispos = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.dispos)
          .setPlaceholder(`${ICON.dispos}`)
          .setMinValues(0).setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );
      const rowStaffReports = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.staffReports)
          .setPlaceholder(`${ICON.staffReports}`)
          .setMinValues(0).setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );
      const rowCommands = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.commands)
          .setPlaceholder(`${ICON.commands}`)
          .setMinValues(0).setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );
      const rowPlanning = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.planning)
          .setPlaceholder(`${ICON.planning}`)
          .setMinValues(0).setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );
      const rowActions1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.save).setLabel(ICON.save).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CID.reset).setLabel(ICON.reset).setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        embeds: [buildDashboardEmbed(guild, draft)],
        components: [rowDispos, rowStaffReports, rowCommands, rowPlanning, rowActions1],
        ephemeral: EPHEMERAL,
      });

      const msg1 = await interaction.fetchReply();

      // ---------- Message 2 (annonces + pseudoScan + 3 roles + toggle/cancel) ----------
      const rowAnnonces = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.annonces)
          .setPlaceholder(`${ICON.annonces}`)
          .setMinValues(0).setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );
      const rowPseudoScan = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.pseudoScan)
          .setPlaceholder(`${ICON.pseudoScan}`)
          .setMinValues(0).setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );
      const rowRoleStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.staffRole).setPlaceholder(`${ICON.staffRole}`).setMinValues(0).setMaxValues(1)
      );
      const rowRolePlayer = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.playerRole).setPlaceholder(`${ICON.playerRole}`).setMinValues(0).setMaxValues(1)
      );
      const rowRoleTrial = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.trialRole).setPlaceholder(`${ICON.trialRole}`).setMinValues(0).setMaxValues(1)
      );
      const rowActions2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.autoToggle)
          .setLabel(draft.automations.enabled ? ICON.autoOn : ICON.autoOff)
          .setStyle(draft.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.cancel).setLabel(ICON.cancel).setStyle(ButtonStyle.Danger)
      );

      const msg2 = await interaction.followUp({
        content: `${ICON.roles}`,
        components: [rowAnnonces, rowPseudoScan, rowRoleStaff, rowRolePlayer, rowActions2],
        ephemeral: EPHEMERAL,
      });

      // NOTE: on remplace rowRoleTrial dans msg2 en 2e followup (sinon 6 rows)
      const msg2b = await interaction.followUp({
        content: `${ICON.trialRole}`,
        components: [rowRoleTrial],
        ephemeral: EPHEMERAL,
      });

      // ---------- Message 3 (mainRoles display) ----------
      const rowMrPresident = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.mr_president).setPlaceholder(`${ICON.president}`).setMinValues(0).setMaxValues(1)
      );
      const rowMrFondateur = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.mr_fondateur).setPlaceholder(`${ICON.fondateur}`).setMinValues(0).setMaxValues(1)
      );
      const rowMrGm = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.mr_gm).setPlaceholder(`${ICON.gm}`).setMinValues(0).setMaxValues(1)
      );
      const rowMrCoGm = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.mr_cogm).setPlaceholder(`${ICON.cogm}`).setMinValues(0).setMaxValues(1)
      );
      const rowMrStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.mr_staff).setPlaceholder(`${ICON.staffDisplay}`).setMinValues(0).setMaxValues(1)
      );

      const msg3 = await interaction.followUp({
        content: `🏷️`,
        components: [rowMrPresident, rowMrFondateur, rowMrGm, rowMrCoGm, rowMrStaff],
        ephemeral: EPHEMERAL,
      });

      // ---------- Message 4 (posts multi) ----------
      const rowPosts = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.posts)
          .setPlaceholder(`${ICON.posts}`)
          .setMinValues(0)
          .setMaxValues(25)
      );

      const msg4 = await interaction.followUp({
        content: `${ICON.posts}`,
        components: [rowPosts],
        ephemeral: EPHEMERAL,
      });

      // ---------- Refresh ----------
      const refresh = async () => {
        // update auto button state
        rowActions2.components[0].setLabel(draft.automations.enabled ? ICON.autoOn : ICON.autoOff);
        rowActions2.components[0].setStyle(draft.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);

        const payload1 = interaction.editReply({
          embeds: [buildDashboardEmbed(guild, draft)],
          components: [rowDispos, rowStaffReports, rowCommands, rowPlanning, rowActions1],
        });

        const payload2 = msg2.edit({
          content: `${ICON.roles}`,
          components: [rowAnnonces, rowPseudoScan, rowRoleStaff, rowRolePlayer, rowActions2],
        });

        // autres messages n’ont pas besoin d’embed
        await Promise.allSettled([payload1, payload2]);
      };

      // ---------- Collectors ----------
      const collectors = [
        msg1.createMessageComponentCollector({ time: 12 * 60 * 1000 }),
        msg2.createMessageComponentCollector({ time: 12 * 60 * 1000 }),
        msg2b.createMessageComponentCollector({ time: 12 * 60 * 1000 }),
        msg3.createMessageComponentCollector({ time: 12 * 60 * 1000 }),
        msg4.createMessageComponentCollector({ time: 12 * 60 * 1000 }),
      ];

      const stopAll = (reason) => {
        for (const c of collectors) {
          try { c.stop(reason); } catch {}
        }
      };

      for (const c of collectors) {
        c.on("collect", async (i) => {
          try {
            // Sécurité propriétaire
            if (!isOwner(i, scope)) return i.reply({ content: ICON.no, ephemeral: true });

            // ACK immédiat pour éviter "échec de l'interaction"
            if (!i.deferred && !i.replied) {
              await i.deferUpdate().catch(() => {});
            }

            // ---- Channel selects ----
            if (i.isChannelSelectMenu()) {
              const v = i.values?.[0] || null;

              if (i.customId === CID.dispos) draft.disposChannelId = v;
              if (i.customId === CID.staffReports) draft.staffReportsChannelId = v;
              if (i.customId === CID.commands) draft.commandsChannelId = v;
              if (i.customId === CID.planning) draft.planningChannelId = v;

              if (i.customId === CID.annonces) draft.annoncesChannelId = v;
              if (i.customId === CID.pseudoScan) draft.pseudo.scanChannelId = v;

              await refresh();
              return;
            }

            // ---- Role select (single) ----
            if (i.isRoleSelectMenu()) {
              const values = Array.isArray(i.values) ? i.values : [];
              const v = values[0] || null;

              if (i.customId === CID.staffRole) draft.staffRoleId = v;
              if (i.customId === CID.playerRole) draft.playerRoleId = v;
              if (i.customId === CID.trialRole) draft.trialRoleId = v;

              if (i.customId === CID.mr_president) draft.mainRoles.president.id = v;
              if (i.customId === CID.mr_fondateur) draft.mainRoles.fondateur.id = v;
              if (i.customId === CID.mr_gm) draft.mainRoles.gm.id = v;
              if (i.customId === CID.mr_cogm) draft.mainRoles.cogm.id = v;
              if (i.customId === CID.mr_staff) draft.mainRoles.staff.id = v;

              if (i.customId === CID.posts) {
                // multi select => i.values = roleIds[]
                draft.postsRoleIds = Array.from(new Set(values.filter(Boolean)));
              }

              await refresh();
              return;
            }

            // ---- Buttons ----
            if (i.isButton()) {
              if (i.customId === CID.autoToggle) {
                draft.automations.enabled = !draft.automations.enabled;
                await refresh();
                return;
              }

              if (i.customId === CID.reset) {
                draft.disposChannelId = null;
                draft.staffReportsChannelId = null;
                draft.commandsChannelId = null;
                draft.planningChannelId = null;
                draft.annoncesChannelId = null;

                draft.staffRoleId = null;
                draft.playerRoleId = null;
                draft.trialRoleId = null;

                draft.automations = { ...DEFAULT_AUTOMATIONS };

                draft.pseudo = normalizePseudo({});
                draft.mainRoles = normalizeMainRoles({});
                draft.postsRoleIds = [];

                await refresh();
                return;
              }

              if (i.customId === CID.cancel) {
                stopAll("cancel");
                try { await interaction.editReply({ content: ICON.cancel, embeds: [], components: [] }); } catch {}
                try { await msg2.edit({ content: ICON.cancel, components: [] }); } catch {}
                try { await msg2b.edit({ content: ICON.cancel, components: [] }); } catch {}
                try { await msg3.edit({ content: ICON.cancel, components: [] }); } catch {}
                try { await msg4.edit({ content: ICON.cancel, components: [] }); } catch {}
                return;
              }

              if (i.customId === CID.save) {
                const requiredOk =
                  !!draft.disposChannelId &&
                  !!draft.staffReportsChannelId &&
                  !!draft.staffRoleId &&
                  !!draft.playerRoleId;

                if (!requiredOk) {
                  return interaction.followUp({ content: ICON.warn, ephemeral: true }).catch(() => {});
                }

                // posts => [{id,label}] en prenant role.name
                const posts = [];
                for (const roleId of draft.postsRoleIds || []) {
                  const role = guild.roles.cache.get(roleId);
                  if (!role) continue;
                  posts.push({ id: roleId, label: role.name });
                }

                const patch = {
                  botLabel: "XIG BLAUGRANA FC Staff",
                  guildName: guild.name,

                  // channels
                  disposChannelId: draft.disposChannelId,
                  staffReportsChannelId: draft.staffReportsChannelId,
                  commandsChannelId: draft.commandsChannelId,
                  planningChannelId: draft.planningChannelId,
                  annoncesChannelId: draft.annoncesChannelId,

                  // roles bot
                  staffRoleId: draft.staffRoleId,
                  playerRoleId: draft.playerRoleId,
                  trialRoleId: draft.trialRoleId,

                  // automations
                  automations: {
                    enabled: !!draft.automations.enabled,
                    reminderHour: draft.automations.reminderHour,
                    reportHours: Array.isArray(draft.automations.reportHours) ? draft.automations.reportHours : DEFAULT_AUTOMATIONS.reportHours,
                    closeHour: draft.automations.closeHour,
                  },

                  // pseudo config (scan + sync + options)
                  pseudo: {
                    scanChannelId: draft.pseudo.scanChannelId,
                    deleteMessages: draft.pseudo.deleteMessages === true,
                    syncEnabled: draft.pseudo.syncEnabled !== false,
                    syncFetchMembers: draft.pseudo.syncFetchMembers !== false,
                    reminderEnabled: draft.pseudo.reminderEnabled === true,
                    reminderHours: Array.isArray(draft.pseudo.reminderHours) ? draft.pseudo.reminderHours : [12, 17, 21],
                  },

                  // main roles (display)
                  mainRoles: {
                    president: { id: draft.mainRoles.president.id || null },
                    fondateur: { id: draft.mainRoles.fondateur.id || null },
                    gm: { id: draft.mainRoles.gm.id || null },
                    cogm: { id: draft.mainRoles.cogm.id || null },
                    staff: { id: draft.mainRoles.staff.id || null },
                  },

                  // posts (display)
                  posts,

                  setupBy: interaction.user.id,
                  setupAt: new Date().toISOString(),
                };

                upsertGuildConfig(guildId, patch);

                stopAll("saved");

                // on ferme tout proprement
                try { await interaction.editReply({ content: ICON.save, embeds: [buildDashboardEmbed(guild, draft)], components: [] }); } catch {}
                try { await msg2.edit({ content: ICON.save, components: [] }); } catch {}
                try { await msg2b.edit({ content: ICON.save, components: [] }); } catch {}
                try { await msg3.edit({ content: ICON.save, components: [] }); } catch {}
                try { await msg4.edit({ content: ICON.save, components: [] }); } catch {}
                return;
              }
            }
          } catch (e) {
            warn("[SETUP_COLLECT_ERROR]", e);
            try {
              if (!i.deferred && !i.replied) await i.reply({ content: ICON.warn, ephemeral: true });
            } catch {}
          }
        });

        c.on("end", async (_col, reason) => {
          if (reason !== "time") return;
          try { await interaction.editReply({ content: ICON.time, embeds: [], components: [] }); } catch {}
          try { await msg2.edit({ content: ICON.time, components: [] }); } catch {}
          try { await msg2b.edit({ content: ICON.time, components: [] }); } catch {}
          try { await msg3.edit({ content: ICON.time, components: [] }); } catch {}
          try { await msg4.edit({ content: ICON.time, components: [] }); } catch {}
        });
      }

      log(`[SETUP] ${interaction.user.tag} sur ${guild.name} (${guildId})`);
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
