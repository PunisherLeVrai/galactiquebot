// src/commands/setup.js
// Setup — 2 messages — multi-serveur — STAFF ONLY
// Requis: 📅 + 📊 + 🛡️ (≥1 rôle staff) + 👟 (≥1 rôle joueur)
// + Postes configurables pour /pseudo : 0..25 rôles (SANS label)
// + ✅ Check Dispo: salon (opt) + 7 IDs de messages (Lun..Dim) pour /check_dispo
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

  // ✅ check dispo
  checkDispo: "🗓️",
  msg: "✉️",
};

// ✅ STAFF ONLY (même logique que /pseudo /export_config)
function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;

  const staffRoleIds = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  return staffRoleIds.some((id) => id && member.roles.cache.has(String(id)));
}

function fmtCh(id) {
  return id ? `<#${id}>` : "—";
}
function fmtRoles(ids) {
  const arr = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return arr.length ? arr.map((id) => `<@&${id}>`).join(" ") : "—";
}
function uniqIds(arr, max = 25) {
  const out = [];
  const set = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (set.has(s)) continue;
    set.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
function cleanMsgId(v) {
  const s = String(v || "").trim();
  // Discord snowflake: 17..20 digits (on garde souple)
  if (!/^\d{16,25}$/.test(s)) return "";
  return s;
}
function fmtMsgIds(ids) {
  const arr = Array.isArray(ids) ? ids : [];
  const days = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const lines = [];
  for (let i = 0; i < 7; i++) {
    const id = arr[i] ? String(arr[i]) : "";
    lines.push(`${days[i]}: ${id ? `\`${id}\`` : "—"}`);
  }
  return lines.join("\n");
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
        "Ces réglages servent aux commandes et à /pseudo.",
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
          `${ICON.players} ${fmtRoles(draft.playerRoleIds)} — Joueurs`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${ICON.postes} Postes (/pseudo)`,
        value: fmtRoles(draft.postRoleIds),
        inline: false,
      },
      {
        name: `${ICON.checkDispo} Check Dispo`,
        value: [
          `${ICON.checkDispo} Salon check (opt): ${fmtCh(draft.checkDispoChannelId)}`,
          `${ICON.msg} Messages (Lun..Dim):`,
          fmtMsgIds(draft.dispoMessageIds),
        ].join("\n"),
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurer salons + rôles (multi) + postes + check dispo + automations.")
    // IMPORTANT: si tu mets Administrator ici, les STAFF non-admin ne verront pas /setup.
    // Le vrai contrôle est fait par isStaff() ci-dessous.
    .setDefaultMemberPermissions(0n),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: ICON.no, ephemeral: true });

      const guild = interaction.guild;
      const guildId = guild.id;

      // on lit la config actuelle pour vérifier le staff
      const saved = getGuildConfig(guildId) || {};

      // ✅ STAFF ONLY
      if (!isStaff(interaction.member, saved)) {
        return interaction.reply({ content: `${ICON.no} Accès réservé au STAFF.`, ephemeral: true });
      }

      // compat: ancien format posts [{roleId,label}] -> postRoleIds
      const legacyPostRoleIds = Array.isArray(saved.posts)
        ? saved.posts.map((p) => p?.roleId).filter(Boolean)
        : [];

      const draft = {
        // salons
        disposChannelId: saved.disposChannelId || null,
        staffReportsChannelId: saved.staffReportsChannelId || null,
        pseudoScanChannelId: saved.pseudoScanChannelId || null,

        // ✅ check dispo
        checkDispoChannelId: saved.checkDispoChannelId || null,
        dispoMessageIds: Array.isArray(saved.dispoMessageIds) ? saved.dispoMessageIds.slice(0, 7) : [],

        // rôles (multi)
        staffRoleIds: uniqIds(
          Array.isArray(saved.staffRoleIds)
            ? saved.staffRoleIds
            : saved.staffRoleId
              ? [saved.staffRoleId]
              : [],
          25
        ),
        playerRoleIds: uniqIds(Array.isArray(saved.playerRoleIds) ? saved.playerRoleIds : [], 25),

        // postes (0..25)
        postRoleIds: uniqIds(Array.isArray(saved.postRoleIds) ? saved.postRoleIds : legacyPostRoleIds, 25),
      };

      let autoEnabled = !!saved?.automations?.enabled;

      const scope = `${guildId}:${interaction.user.id}`;
      const CID = {
        // channels
        dispos: `setup:dispos:${scope}`,
        staffReports: `setup:staffReports:${scope}`,
        pseudoScan: `setup:pseudoScan:${scope}`,

        // ✅ check dispo channel
        checkDispo: `setup:checkDispo:${scope}`,

        // roles
        staff: `setup:staff:${scope}`,
        players: `setup:players:${scope}`,
        posts: `setup:posts:${scope}`,

        // ✅ message ids (buttons)
        msgLun: `setup:msg:Lun:${scope}`,
        msgMar: `setup:msg:Mar:${scope}`,
        msgMer: `setup:msg:Mer:${scope}`,
        msgJeu: `setup:msg:Jeu:${scope}`,
        msgVen: `setup:msg:Ven:${scope}`,
        msgSam: `setup:msg:Sam:${scope}`,
        msgDim: `setup:msg:Dim:${scope}`,
        msgClear: `setup:msg:clear:${scope}`,

        // actions
        save: `setup:save:${scope}`,
        reset: `setup:reset:${scope}`,
        cancel: `setup:cancel:${scope}`,
        auto: `setup:auto:${scope}`,
      };

      // ---------- Message 1 ----------
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
        if (draft.staffReportsChannelId)
          rowStaffReports.components[0].setDefaultChannels([draft.staffReportsChannelId]);
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

      // ---------- Message 2 ----------
      const rowRoleStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.staff)
          .setPlaceholder(`${ICON.staff} Rôles Staff (0..25)`)
          .setMinValues(0)
          .setMaxValues(25)
      );

      const rowRolePlayers = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.players)
          .setPlaceholder(`${ICON.players} Rôles Joueurs (0..25)`)
          .setMinValues(0)
          .setMaxValues(25)
      );

      const rowRolePosts = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.posts)
          .setPlaceholder(`${ICON.postes} Rôles Postes (0..25)`)
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

      // ---------- Message 3 (Check Dispo) ----------
      const rowCheckDispoChannel = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.checkDispo)
          .setPlaceholder(`${ICON.checkDispo} Salon Check Dispo (opt)`)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      try {
        if (draft.checkDispoChannelId) rowCheckDispoChannel.components[0].setDefaultChannels([draft.checkDispoChannelId]);
      } catch {}

      const rowMsgButtons1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.msgLun).setLabel("ID Lun").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.msgMar).setLabel("ID Mar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.msgMer).setLabel("ID Mer").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.msgJeu).setLabel("ID Jeu").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.msgVen).setLabel("ID Ven").setStyle(ButtonStyle.Primary)
      );

      const rowMsgButtons2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.msgSam).setLabel("ID Sam").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.msgDim).setLabel("ID Dim").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.msgClear).setLabel("Clear IDs").setStyle(ButtonStyle.Secondary)
      );

      const msg3 = await interaction.followUp({
        content:
          "🗓️ **Check Dispo** — Choisis le salon (opt) puis clique un bouton pour définir l’ID du message.\n" +
          "➡️ Quand tu cliques un jour, **réponds avec l’ID** (17-20 chiffres) dans la fenêtre modale.",
        components: [rowCheckDispoChannel, rowMsgButtons1, rowMsgButtons2],
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
          if (draft.staffReportsChannelId)
            rowStaffReports.components[0].setDefaultChannels([draft.staffReportsChannelId]);
          else rowStaffReports.components[0].setDefaultChannels([]);
          if (draft.pseudoScanChannelId) rowPseudoScan.components[0].setDefaultChannels([draft.pseudoScanChannelId]);
          else rowPseudoScan.components[0].setDefaultChannels([]);

          rowRoleStaff.components[0].setDefaultRoles(draft.staffRoleIds.slice(0, 25));
          rowRolePlayers.components[0].setDefaultRoles(draft.playerRoleIds.slice(0, 25));
          rowRolePosts.components[0].setDefaultRoles(draft.postRoleIds.slice(0, 25));

          if (draft.checkDispoChannelId) rowCheckDispoChannel.components[0].setDefaultChannels([draft.checkDispoChannelId]);
          else rowCheckDispoChannel.components[0].setDefaultChannels([]);
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

        await msg3
          .edit({
            content:
              "🗓️ **Check Dispo** — Choisis le salon (opt) puis clique un bouton pour définir l’ID du message.\n" +
              "➡️ Quand tu cliques un jour, **réponds avec l’ID** (17-20 chiffres) dans la fenêtre modale.",
            components: [rowCheckDispoChannel, rowMsgButtons1, rowMsgButtons2],
          })
          .catch(() => {});
      };

      const col1 = mainMsg.createMessageComponentCollector({ time: 10 * 60 * 1000 });
      const col2 = msg2.createMessageComponentCollector({ time: 10 * 60 * 1000 });
      const col3 = msg3.createMessageComponentCollector({ time: 10 * 60 * 1000 });

      const stopAll = () => {
        try { col1.stop(); } catch {}
        try { col2.stop(); } catch {}
        try { col3.stop(); } catch {}
      };

      const setDayIndex = (label) => {
        const map = { Lun: 0, Mar: 1, Mer: 2, Jeu: 3, Ven: 4, Sam: 5, Dim: 6 };
        return map[label] ?? null;
      };

      async function askMessageId(i, dayLabel) {
        const idx = setDayIndex(dayLabel);
        if (idx === null) return;

        // On utilise un prompt simple via ephemeral reply + awaitMessages (fiable, sans modals)
        // (Discord modals demandent TextInputBuilder, plus long; ici c’est robuste.)
        await i.reply({
          content:
            `Envoie maintenant l’ID du message pour **${dayLabel}** (17-20 chiffres).\n` +
            `Tu peux aussi copier l’ID du message via "Mode développeur".\n` +
            `⏳ Attente 60s...`,
          ephemeral: true,
        });

        const filter = (m) => m.author.id === interaction.user.id;
        const ch = i.channel;
        const collected = await ch
          .awaitMessages({ filter, max: 1, time: 60_000 })
          .catch(() => null);

        const msg = collected && collected.first ? collected.first() : null;
        if (!msg) {
          return i.followUp({ content: "⚠️ Timeout. Re-clique sur le bouton du jour.", ephemeral: true }).catch(() => {});
        }

        const id = cleanMsgId(msg.content);
        // On supprime le message utilisateur pour garder propre (best-effort)
        try { await msg.delete().catch(() => {}); } catch {}

        if (!id) {
          return i.followUp({ content: "⚠️ ID invalide. Re-clique et envoie un ID de message valide.", ephemeral: true }).catch(() => {});
        }

        // set dans draft
        const arr = Array.isArray(draft.dispoMessageIds) ? draft.dispoMessageIds.slice(0, 7) : [];
        while (arr.length < 7) arr.push("");
        arr[idx] = id;

        // uniqIds garderait l’ordre? non. Ici on veut l’ordre semaine => on NE PASSE PAS par uniqIds.
        draft.dispoMessageIds = arr;

        return refresh();
      }

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

              draft.checkDispoChannelId = null;
              draft.dispoMessageIds = [];

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

              // compat: ancien format posts (label neutre)
              const legacyPosts = (draft.postRoleIds || []).map((roleId) => ({
                roleId: String(roleId),
                label: "POSTE",
              }));

              // dispoMessageIds: on nettoie mais ON GARDE l’ordre Lun..Dim
              const dm = Array.isArray(draft.dispoMessageIds) ? draft.dispoMessageIds.slice(0, 7) : [];
              const dispoMessageIds = [];
              for (let k = 0; k < 7; k++) dispoMessageIds.push(cleanMsgId(dm[k]) || "");

              upsertGuildConfig(guildId, {
                botLabel: "XIG BLAUGRANA FC Staff",

                disposChannelId: draft.disposChannelId,
                staffReportsChannelId: draft.staffReportsChannelId,
                pseudoScanChannelId: draft.pseudoScanChannelId,

                // ✅ check dispo
                checkDispoChannelId: draft.checkDispoChannelId,
                dispoMessageIds,

                staffRoleIds: uniqIds(draft.staffRoleIds, 25),
                playerRoleIds: uniqIds(draft.playerRoleIds, 25),

                postRoleIds: uniqIds(draft.postRoleIds, 25),

                // compat
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
              await msg3.edit({ content: `${ICON.save} Saved`, components: [] }).catch(() => {});
            }
          }
        } catch {
          try {
            if (!i.replied) await i.reply({ content: ICON.warn, ephemeral: true });
          } catch {}
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
              draft.staffRoleIds = uniqIds(i.values, 25);
              await i.deferUpdate();
              return refresh();
            }
            if (i.customId === CID.players) {
              draft.playerRoleIds = uniqIds(i.values, 25);
              await i.deferUpdate();
              return refresh();
            }
            if (i.customId === CID.posts) {
              draft.postRoleIds = uniqIds(i.values, 25);
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
              try {
                await interaction.editReply({ content: `${ICON.cancel} Cancel`, embeds: [], components: [] });
              } catch {}
              try {
                await msg2.edit({ content: `${ICON.cancel} Cancel`, components: [] });
              } catch {}
              try {
                await msg3.edit({ content: `${ICON.cancel} Cancel`, components: [] });
              } catch {}
            }
          }
        } catch {
          try {
            if (!i.replied) await i.reply({ content: ICON.warn, ephemeral: true });
          } catch {}
        }
      });

      // ---- Collect Message 3 (Check Dispo)
      col3.on("collect", async (i) => {
        try {
          if (i.user.id !== interaction.user.id || !inScope(i, scope)) {
            return i.reply({ content: ICON.no, ephemeral: true });
          }

          if (i.isChannelSelectMenu()) {
            const v = i.values?.[0] || null;
            if (i.customId === CID.checkDispo) draft.checkDispoChannelId = v;

            await i.deferUpdate();
            return refresh();
          }

          if (i.isButton()) {
            if (i.customId === CID.msgClear) {
              draft.dispoMessageIds = [];
              await i.deferUpdate();
              return refresh();
            }

            // Demande ID pour le jour
            if (i.customId === CID.msgLun) return askMessageId(i, "Lun");
            if (i.customId === CID.msgMar) return askMessageId(i, "Mar");
            if (i.customId === CID.msgMer) return askMessageId(i, "Mer");
            if (i.customId === CID.msgJeu) return askMessageId(i, "Jeu");
            if (i.customId === CID.msgVen) return askMessageId(i, "Ven");
            if (i.customId === CID.msgSam) return askMessageId(i, "Sam");
            if (i.customId === CID.msgDim) return askMessageId(i, "Dim");
          }
        } catch {
          try {
            if (!i.replied) await i.reply({ content: ICON.warn, ephemeral: true });
          } catch {}
        }
      });

      col1.on("end", async () => {
        try { await interaction.editReply({ content: ICON.time, embeds: [], components: [] }); } catch {}
        try { await msg2.edit({ content: ICON.time, components: [] }); } catch {}
        try { await msg3.edit({ content: ICON.time, components: [] }); } catch {}
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
