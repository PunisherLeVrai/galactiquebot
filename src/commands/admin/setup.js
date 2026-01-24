// src/commands/admin/setup.js
// SETUP COMPLET (salons + rôles + automations + pseudos) — Premium UI — Buttons emoji-only
// ✅ Automatisations DISPOS ON/OFF (toggle)
// ✅ PSEUDOS: salon scan + options (rappels ON/OFF, deleteMessages ON/OFF)
// ✅ PSEUDOS: mainRoles (Président/Fondateur/GM/coGM/Staff) + posts (POSTE1/2/3)
// ✅ Pas d'IDs à taper (menus)
// ✅ 3 messages éphémères (limite 5 rows respectée)
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

// Horaires par défaut DISPOS
const DEFAULT_AUTOMATIONS = {
  enabled: false,
  reminderHour: 12, // rappel
  reportHours: [12, 17], // rapport
  closeHour: 17, // fermeture
};

// Defaults PSEUDO
const DEFAULT_PSEUDO = {
  scanChannelId: null,
  deleteMessages: false,
  syncEnabled: true, // sync hourly
  syncFetchMembers: true,
  reminderEnabled: false, // 3/day
  reminderHours: [12, 17, 21],
};

// Emojis UI
const ICON = {
  title: "⚙️",
  channels: "📂",
  roles: "🧩",
  auto: "🤖",
  pseudo: "🎮",

  // salons
  dispos: "📅",
  staffReports: "📊",
  commands: "⌨️",
  planning: "🗓️",
  annonces: "📢",
  pseudoScan: "🎮",

  // rôles
  staff: "🛡️",
  player: "👟",
  trial: "🧪",

  // main roles pseudo
  president: "👑",
  fondateur: "🏛️",
  gm: "📌",
  cogm: "📎",
  staffMain: "🧷",
  posts: "🎯",

  // actions
  save: "💾",
  reset: "🔄",
  cancel: "❎",
  autoOn: "⚙️",
  autoOff: "🛑",

  // pseudo toggles
  pRemOn: "🔔",
  pRemOff: "🔕",
  pDelOn: "🧽",
  pDelOff: "📌",

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
  const reminderHours =
    Array.isArray(p.reminderHours) && p.reminderHours.length ? p.reminderHours : DEFAULT_PSEUDO.reminderHours;

  return {
    scanChannelId: p.scanChannelId || null,
    deleteMessages: typeof p.deleteMessages === "boolean" ? p.deleteMessages : DEFAULT_PSEUDO.deleteMessages,
    syncEnabled: typeof p.syncEnabled === "boolean" ? p.syncEnabled : DEFAULT_PSEUDO.syncEnabled,
    syncFetchMembers: typeof p.syncFetchMembers === "boolean" ? p.syncFetchMembers : DEFAULT_PSEUDO.syncFetchMembers,
    reminderEnabled: typeof p.reminderEnabled === "boolean" ? p.reminderEnabled : DEFAULT_PSEUDO.reminderEnabled,
    reminderHours,
  };
}

function normalizeMainRoles(saved) {
  const mr = saved?.mainRoles || {};
  const getId = (k) => (mr?.[k]?.id ? String(mr[k].id) : null);

  return {
    president: { id: getId("president") },
    fondateur: { id: getId("fondateur") },
    gm: { id: getId("gm") },
    cogm: { id: getId("cogm") },
    staff: { id: getId("staff") },
  };
}

function normalizePosts(saved) {
  const arr = Array.isArray(saved?.posts) ? saved.posts : [];
  // garde uniquement {id,label}
  return arr
    .filter((x) => x && typeof x === "object" && x.id)
    .slice(0, 3)
    .map((x) => ({ id: String(x.id), label: String(x.label || "").trim() || "Poste" }));
}

function buildDashboardEmbed(guild, draft, auto, pseudo, mainRoles, posts) {
  const requiredOk =
    !!draft.disposChannelId &&
    !!draft.staffReportsChannelId &&
    !!draft.staffRoleId &&
    !!draft.playerRoleId;

  const postsText = posts.length ? posts.map((p) => `• <@&${p.id}>`).join("\n") : "—";

  return new EmbedBuilder()
    .setTitle(`${ICON.title} Setup — ${guild.name}`)
    .setColor(0x5865f2)
    .setDescription(
      [
        `${ICON.channels} Salons • ${ICON.roles} Rôles • ${ICON.auto} Dispos • ${ICON.pseudo} Pseudos`,
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
          `${ICON.pseudoScan} ${fmtCh(pseudo.scanChannelId)}  (scan pseudo)`,
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
        name: `${ICON.auto} Dispos`,
        value: [
          `État: **${auto.enabled ? "ON" : "OFF"}**`,
          `🔔 ${auto.reminderHour}h`,
          `📊 ${auto.reportHours.join("h, ")}h`,
          `🔒 ${auto.closeHour}h`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${ICON.pseudo} Pseudos`,
        value: [
          `Sync horaire: **${pseudo.syncEnabled ? "ON" : "OFF"}**`,
          `Rappels: **${pseudo.reminderEnabled ? "ON" : "OFF"}** (${pseudo.reminderHours.join("h, ")}h)`,
          `Delete msg: **${pseudo.deleteMessages ? "ON" : "OFF"}**`,
          "",
          `${ICON.president} ${fmtRole(mainRoles.president?.id)}`,
          `${ICON.fondateur} ${fmtRole(mainRoles.fondateur?.id)}`,
          `${ICON.gm} ${fmtRole(mainRoles.gm?.id)}`,
          `${ICON.cogm} ${fmtRole(mainRoles.cogm?.id)}`,
          `${ICON.staffMain} ${fmtRole(mainRoles.staff?.id)}`,
          "",
          `${ICON.posts} ${postsText}`,
        ].join("\n"),
        inline: false,
      },
      { name: "ID", value: fmtId(guild.id), inline: false }
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
    .setDescription("Configurer le bot (salons + rôles + automations + pseudos).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: ICON.no, ephemeral: EPHEMERAL });
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator))
        return interaction.reply({ content: ICON.no, ephemeral: EPHEMERAL });

      const guild = interaction.guild;
      const guildId = guild.id;

      // Saved
      const saved = getGuildConfig(guildId) || {};
      let auto = normalizeAutomations(saved);
      let pseudo = normalizePseudo(saved);
      let mainRoles = normalizeMainRoles(saved);
      let posts = normalizePosts(saved);

      // Draft
      const draft = {
        disposChannelId: saved.disposChannelId || null,
        staffReportsChannelId: saved.staffReportsChannelId || null,
        commandsChannelId: saved.commandsChannelId || null,
        planningChannelId: saved.planningChannelId || null,
        annoncesChannelId: saved.annoncesChannelId || null,

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
        pseudoScan: `setup:pseudoScan:${scope}`,

        // rôles setup
        staff: `setup:staff:${scope}`,
        player: `setup:player:${scope}`,
        trial: `setup:trial:${scope}`,

        // main roles pseudo
        president: `setup:president:${scope}`,
        fondateur: `setup:fondateur:${scope}`,
        gm: `setup:gm:${scope}`,
        cogm: `setup:cogm:${scope}`,
        staffMain: `setup:staffMain:${scope}`,
        posts: `setup:posts:${scope}`,

        // actions
        save: `setup:save:${scope}`,
        reset: `setup:reset:${scope}`,
        cancel: `setup:cancel:${scope}`,
        autoToggle: `setup:auto:${scope}`,

        // pseudo toggles
        pseudoReminderToggle: `setup:pRem:${scope}`,
        pseudoDeleteToggle: `setup:pDel:${scope}`,
        pseudoSyncToggle: `setup:pSync:${scope}`,
      };

      // MESSAGE 1 (4 menus salons + 1 row boutons)
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

      const rowActions1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.save).setLabel(ICON.save).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CID.reset).setLabel(ICON.reset).setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        embeds: [buildDashboardEmbed(guild, draft, auto, pseudo, mainRoles, posts)],
        components: [rowDispos, rowStaffReports, rowCommands, rowPlanning, rowActions1],
        ephemeral: EPHEMERAL,
      });

      // MESSAGE 2 (annonces + 3 roles + toggle/cancel)
      const rowAnnonces = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.annonces)
          .setPlaceholder(`${ICON.annonces} Annonces (opt)`)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowRoleStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.staff).setPlaceholder(`${ICON.staff} Staff`).setMinValues(0).setMaxValues(1)
      );

      const rowRolePlayer = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.player).setPlaceholder(`${ICON.player} Joueur`).setMinValues(0).setMaxValues(1)
      );

      const rowRoleTrial = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.trial).setPlaceholder(`${ICON.trial} Essai (opt)`).setMinValues(0).setMaxValues(1)
      );

      const rowActions2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.autoToggle)
          .setLabel(auto.enabled ? ICON.autoOn : ICON.autoOff)
          .setStyle(auto.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.cancel).setLabel(ICON.cancel).setStyle(ButtonStyle.Danger)
      );

      const msg2 = await interaction.followUp({
        content: ICON.roles,
        components: [rowAnnonces, rowRoleStaff, rowRolePlayer, rowRoleTrial, rowActions2],
        ephemeral: EPHEMERAL,
      });

      // MESSAGE 3 (PSEUDOS)
      const rowPseudoScan = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.pseudoScan)
          .setPlaceholder(`${ICON.pseudoScan} Salon scan pseudo`)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowMainRole1 = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.president).setPlaceholder(`${ICON.president} Président`).setMinValues(0).setMaxValues(1)
      );

      const rowMainRole2 = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.fondateur).setPlaceholder(`${ICON.fondateur} Fondateur`).setMinValues(0).setMaxValues(1)
      );

      const rowMainRole3 = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.gm).setPlaceholder(`${ICON.gm} GM`).setMinValues(0).setMaxValues(1)
      );

      // Posts (POSTE1/2/3) + toggles pseudo sur la 5e row
      const rowPosts = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.posts)
          .setPlaceholder(`${ICON.posts} Postes (max 3)`)
          .setMinValues(0)
          .setMaxValues(3)
      );

      const rowPseudoToggles = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.pseudoSyncToggle)
          .setLabel(pseudo.syncEnabled ? "🔁" : "⏹️")
          .setStyle(pseudo.syncEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(CID.pseudoReminderToggle)
          .setLabel(pseudo.reminderEnabled ? ICON.pRemOn : ICON.pRemOff)
          .setStyle(pseudo.reminderEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(CID.pseudoDeleteToggle)
          .setLabel(pseudo.deleteMessages ? ICON.pDelOn : ICON.pDelOff)
          .setStyle(pseudo.deleteMessages ? ButtonStyle.Success : ButtonStyle.Secondary)
      );

      const msg3 = await interaction.followUp({
        content: ICON.pseudo,
        components: [rowPseudoScan, rowMainRole1, rowMainRole2, rowMainRole3, rowPosts],
        ephemeral: EPHEMERAL,
      });

      // on envoie les toggles sur un 4e message (sinon on dépasse 5 rows si on ajoute cogm/staffMain)
      // + on ajoute les 2 derniers main roles ici
      const rowMainRole4 = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.cogm).setPlaceholder(`${ICON.cogm} coGM`).setMinValues(0).setMaxValues(1)
      );

      const rowMainRole5 = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.staffMain).setPlaceholder(`${ICON.staffMain} Staff`).setMinValues(0).setMaxValues(1)
      );

      const msg4 = await interaction.followUp({
        content: "🧩",
        components: [rowMainRole4, rowMainRole5, rowPseudoToggles],
        ephemeral: EPHEMERAL,
      });

      const mainMsg = await interaction.fetchReply();

      const refresh = async () => {
        // update labels/styles
        rowActions2.components[0].setLabel(auto.enabled ? ICON.autoOn : ICON.autoOff);
        rowActions2.components[0].setStyle(auto.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);

        rowPseudoToggles.components[0].setLabel(pseudo.syncEnabled ? "🔁" : "⏹️");
        rowPseudoToggles.components[0].setStyle(pseudo.syncEnabled ? ButtonStyle.Success : ButtonStyle.Secondary);

        rowPseudoToggles.components[1].setLabel(pseudo.reminderEnabled ? ICON.pRemOn : ICON.pRemOff);
        rowPseudoToggles.components[1].setStyle(pseudo.reminderEnabled ? ButtonStyle.Success : ButtonStyle.Secondary);

        rowPseudoToggles.components[2].setLabel(pseudo.deleteMessages ? ICON.pDelOn : ICON.pDelOff);
        rowPseudoToggles.components[2].setStyle(pseudo.deleteMessages ? ButtonStyle.Success : ButtonStyle.Secondary);

        await interaction.editReply({
          embeds: [buildDashboardEmbed(guild, draft, auto, pseudo, mainRoles, posts)],
          components: [rowDispos, rowStaffReports, rowCommands, rowPlanning, rowActions1],
        });

        await msg2
          .edit({
            content: ICON.roles,
            components: [rowAnnonces, rowRoleStaff, rowRolePlayer, rowRoleTrial, rowActions2],
          })
          .catch(() => {});

        await msg3
          .edit({
            content: ICON.pseudo,
            components: [rowPseudoScan, rowMainRole1, rowMainRole2, rowMainRole3, rowPosts],
          })
          .catch(() => {});

        await msg4
          .edit({
            content: "🧩",
            components: [rowMainRole4, rowMainRole5, rowPseudoToggles],
          })
          .catch(() => {});
      };

      const collectorMain = mainMsg.createMessageComponentCollector({ time: 10 * 60 * 1000 });
      const collector2 = msg2.createMessageComponentCollector({ time: 10 * 60 * 1000 });
      const collector3 = msg3.createMessageComponentCollector({ time: 10 * 60 * 1000 });
      const collector4 = msg4.createMessageComponentCollector({ time: 10 * 60 * 1000 });

      const stopAll = (reason) => {
        try { collectorMain.stop(reason); } catch {}
        try { collector2.stop(reason); } catch {}
        try { collector3.stop(reason); } catch {}
        try { collector4.stop(reason); } catch {}
      };

      // ---- Collectors ----

      collectorMain.on("collect", async (i) => {
        try {
          if (!isOwnerScope(interaction, i, scope)) return i.reply({ content: ICON.no, ephemeral: true });

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
              // salons
              draft.disposChannelId = null;
              draft.staffReportsChannelId = null;
              draft.commandsChannelId = null;
              draft.planningChannelId = null;
              draft.annoncesChannelId = null;

              // roles setup
              draft.staffRoleId = null;
              draft.playerRoleId = null;
              draft.trialRoleId = null;

              // autos
              auto = { ...DEFAULT_AUTOMATIONS };

              // pseudo
              pseudo = { ...DEFAULT_PSEUDO };
              mainRoles = normalizeMainRoles({});
              posts = [];

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

                // salons
                disposChannelId: draft.disposChannelId,
                staffReportsChannelId: draft.staffReportsChannelId,
                commandsChannelId: draft.commandsChannelId,
                planningChannelId: draft.planningChannelId,
                annoncesChannelId: draft.annoncesChannelId,

                // roles setup
                staffRoleId: draft.staffRoleId,
                playerRoleId: draft.playerRoleId,
                trialRoleId: draft.trialRoleId,

                // dispos automations
                automations: {
                  enabled: !!auto.enabled,
                  reminderHour: auto.reminderHour,
                  reportHours: Array.isArray(auto.reportHours) ? auto.reportHours : DEFAULT_AUTOMATIONS.reportHours,
                  closeHour: auto.closeHour,
                },

                // pseudo
                pseudo: {
                  scanChannelId: pseudo.scanChannelId,
                  deleteMessages: !!pseudo.deleteMessages,
                  syncEnabled: !!pseudo.syncEnabled,
                  syncFetchMembers: !!pseudo.syncFetchMembers,
                  reminderEnabled: !!pseudo.reminderEnabled,
                  reminderHours: Array.isArray(pseudo.reminderHours) ? pseudo.reminderHours : DEFAULT_PSEUDO.reminderHours,
                },

                // main roles + posts
                mainRoles: {
                  president: { id: mainRoles.president?.id || null },
                  fondateur: { id: mainRoles.fondateur?.id || null },
                  gm: { id: mainRoles.gm?.id || null },
                  cogm: { id: mainRoles.cogm?.id || null },
                  staff: { id: mainRoles.staff?.id || null },
                },
                posts,

                setupBy: interaction.user.id,
                setupAt: new Date().toISOString(),
              };

              const savedNow = upsertGuildConfig(guildId, patch) || {};
              auto = normalizeAutomations(savedNow);
              pseudo = normalizePseudo(savedNow);
              mainRoles = normalizeMainRoles(savedNow);
              posts = normalizePosts(savedNow);

              stopAll("saved");

              await i.update({
                content: ICON.save,
                embeds: [buildDashboardEmbed(guild, draft, auto, pseudo, mainRoles, posts)],
                components: [],
              });

              await msg2.edit({ content: ICON.save, components: [] }).catch(() => {});
              await msg3.edit({ content: ICON.save, components: [] }).catch(() => {});
              await msg4.edit({ content: ICON.save, components: [] }).catch(() => {});
              return;
            }
          }
        } catch (e) {
          warn("setup collectorMain error:", e);
          try { if (!i.deferred && !i.replied) await i.reply({ content: ICON.warn, ephemeral: true }); } catch {}
        }
      });

      collector2.on("collect", async (i) => {
        try {
          if (!isOwnerScope(interaction, i, scope)) return i.reply({ content: ICON.no, ephemeral: true });

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
              auto.enabled = !auto.enabled;
              await i.deferUpdate();
              return refresh();
            }

            if (i.customId === CID.cancel) {
              stopAll("cancel");
              await i.update({ content: ICON.cancel, components: [] }).catch(() => {});
              try { await interaction.editReply({ content: ICON.cancel, embeds: [], components: [] }); } catch {}
              try { await msg3.edit({ content: ICON.cancel, components: [] }); } catch {}
              try { await msg4.edit({ content: ICON.cancel, components: [] }); } catch {}
              try { await msg2.edit({ content: ICON.cancel, components: [] }); } catch {}
              return;
            }
          }
        } catch (e) {
          warn("setup collector2 error:", e);
          try { if (!i.deferred && !i.replied) await i.reply({ content: ICON.warn, ephemeral: true }); } catch {}
        }
      });

      collector3.on("collect", async (i) => {
        try {
          if (!isOwnerScope(interaction, i, scope)) return i.reply({ content: ICON.no, ephemeral: true });

          if (i.isChannelSelectMenu()) {
            const v = i.values?.[0] || null;
            if (i.customId === CID.pseudoScan) pseudo.scanChannelId = v;
            await i.deferUpdate();
            return refresh();
          }

          if (i.isRoleSelectMenu()) {
            // posts (multi) ou main roles
            if (i.customId === CID.posts) {
              const ids = Array.isArray(i.values) ? i.values.slice(0, 3) : [];
              // on stocke avec les noms actuels des rôles (label)
              posts = ids.map((rid) => {
                const role = guild.roles.cache.get(rid);
                return { id: rid, label: role?.name ? String(role.name) : "Poste" };
              });

              await i.deferUpdate();
              return refresh();
            }

            const v = i.values?.[0] || null;
            if (i.customId === CID.president) mainRoles.president = { id: v };
            if (i.customId === CID.fondateur) mainRoles.fondateur = { id: v };
            if (i.customId === CID.gm) mainRoles.gm = { id: v };

            await i.deferUpdate();
            return refresh();
          }
        } catch (e) {
          warn("setup collector3 error:", e);
          try { if (!i.deferred && !i.replied) await i.reply({ content: ICON.warn, ephemeral: true }); } catch {}
        }
      });

      collector4.on("collect", async (i) => {
        try {
          if (!isOwnerScope(interaction, i, scope)) return i.reply({ content: ICON.no, ephemeral: true });

          if (i.isRoleSelectMenu()) {
            const v = i.values?.[0] || null;
            if (i.customId === CID.cogm) mainRoles.cogm = { id: v };
            if (i.customId === CID.staffMain) mainRoles.staff = { id: v };
            await i.deferUpdate();
            return refresh();
          }

          if (i.isButton()) {
            if (i.customId === CID.pseudoSyncToggle) {
              pseudo.syncEnabled = !pseudo.syncEnabled;
              await i.deferUpdate();
              return refresh();
            }
            if (i.customId === CID.pseudoReminderToggle) {
              pseudo.reminderEnabled = !pseudo.reminderEnabled;
              await i.deferUpdate();
              return refresh();
            }
            if (i.customId === CID.pseudoDeleteToggle) {
              pseudo.deleteMessages = !pseudo.deleteMessages;
              await i.deferUpdate();
              return refresh();
            }
          }
        } catch (e) {
          warn("setup collector4 error:", e);
          try { if (!i.deferred && !i.replied) await i.reply({ content: ICON.warn, ephemeral: true }); } catch {}
        }
      });

      collectorMain.on("end", async (_c, reason) => {
        if (reason === "time") {
          try { await interaction.editReply({ content: ICON.time, embeds: [], components: [] }); } catch {}
          try { await msg2.edit({ content: ICON.time, components: [] }); } catch {}
          try { await msg3.edit({ content: ICON.time, components: [] }); } catch {}
          try { await msg4.edit({ content: ICON.time, components: [] }); } catch {}
        }
      });

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
