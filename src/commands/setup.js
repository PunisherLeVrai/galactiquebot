// src/commands/setup.js
// Setup — 3 messages — multi-serveur — STAFF ONLY — version compacte + corrigée
// - salons: dispos + staff + pseudoScan(opt) + checkDispo(opt)
// - rôles: staffRoleIds (>=1) + playerRoleIds (>=1) + postRoleIds (0..25)
// - checkDispo: 7 IDs (Lun..Dim)
// - automations: enabled + pseudo {enabled, minute} + checkDispo {enabled, times[]} + rappel {enabled, times[]}
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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
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
  clock: "⏱️",
  checkDispo: "🗓️",
  rappel: "🔔",
  msg: "✉️",
  times: "🕒",
  plus: "➕",
  broom: "🧹",
};

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAY_INDEX = { Lun: 0, Mar: 1, Mer: 2, Jeu: 3, Ven: 4, Sam: 5, Dim: 6 };

// ⚠️ presets (max 12) — garde une liste stable + utile
const PRESET_TIMES = [
  "17:10",
  "18:10",
  "19:10",
  "20:10",
  "20:45",
  "21:00",
  "21:10",
  "21:20",
  "21:40",
  "22:00",
  "22:10",
  "22:20",
  "22:40",
];

function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const ids = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  return ids.some((id) => id && member.roles?.cache?.has?.(String(id)));
}

const fmtCh = (id) => (id ? `<#${id}>` : "—");
const fmtRoles = (ids) => {
  const arr = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return arr.length ? arr.map((id) => `<@&${id}>`).join(" ") : "—";
};

function uniqIds(arr, max = 25) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    const s = String(v || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function isSnowflake(v) {
  const s = String(v || "").trim();
  return /^[0-9]{15,25}$/.test(s);
}

function normalizeDispoMessageIds(input) {
  const src = Array.isArray(input) ? input : [];
  const out = new Array(7).fill(null);
  for (let i = 0; i < 7; i++) {
    const s = src[i] == null ? "" : String(src[i]).trim();
    out[i] = isSnowflake(s) ? s : null;
  }
  return out;
}

function fmtMsgIds(ids) {
  const arr = Array.isArray(ids) ? ids : [];
  return DAYS.map((d, i) => `${d}: ${arr[i] ? `\`${String(arr[i])}\`` : "—"}`).join("\n");
}

// ---- Automations helpers (doit matcher guildConfig.js) ----
function clampInt(n, { min = 0, max = 59, fallback = 10 } = {}) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const i = Math.trunc(x);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function normalizeTimeStr(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

function normalizeTimes(arr, { max = 12 } = {}) {
  const src = Array.isArray(arr) ? arr : [];
  const out = [];
  const seen = new Set();
  for (const v of src) {
    const t = normalizeTimeStr(v);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

const fmtTimes = (arr) => {
  const a = Array.isArray(arr) ? arr : [];
  return a.length ? a.map((t) => `\`${t}\``).join(" ") : "—";
};
function buildEmbed(guild, draft) {
  const requiredOk =
    !!draft.disposChannelId &&
    !!draft.staffReportsChannelId &&
    Array.isArray(draft.staffRoleIds) &&
    draft.staffRoleIds.length > 0 &&
    Array.isArray(draft.playerRoleIds) &&
    draft.playerRoleIds.length > 0;

  const a = draft.automations || {};
  const globalOn = !!a.enabled;

  const pseudoOn = !!a?.pseudo?.enabled;
  const pseudoMin = clampInt(a?.pseudo?.minute, { fallback: 10 });

  const cdOn = !!a?.checkDispo?.enabled;
  const cdTimes = normalizeTimes(a?.checkDispo?.times);

  const rpOn = !!a?.rappel?.enabled;
  const rpTimes = normalizeTimes(a?.rappel?.times);

  return new EmbedBuilder()
    .setTitle(`${ICON.title} Setup — ${guild.name}`)
    .setColor(0x5865f2)
    .setDescription(
      [
        requiredOk ? `${ICON.ok} OK` : `${ICON.warn} Incomplet`,
        "",
        "Requis : 📅 Dispos + 📊 Staff + 🛡️ (≥1 rôle staff) + 👟 (≥1 rôle joueur)",
        "",
        "Ces réglages servent aux commandes et à /pseudo + /check_dispo + automations.",
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
      },
      {
        name: "Rôles",
        value: [
          `${ICON.staff} ${fmtRoles(draft.staffRoleIds)} — Staff`,
          `${ICON.players} ${fmtRoles(draft.playerRoleIds)} — Joueurs (filtres)`,
        ].join("\n"),
      },
      { name: `${ICON.postes} Postes (/pseudo)`, value: fmtRoles(draft.postRoleIds) },
      {
        name: `${ICON.checkDispo} Check Dispo`,
        value: [
          `${ICON.checkDispo} Salon check (opt): ${fmtCh(draft.checkDispoChannelId)}`,
          `${ICON.msg} Messages (Lun..Dim):`,
          fmtMsgIds(draft.dispoMessageIds),
        ].join("\n"),
      },
      {
        name: "Automations",
        value: [
          `Global: **${globalOn ? "ON" : "OFF"}**`,
          `Pseudo: **${pseudoOn ? "ON" : "OFF"}** — minute: \`${pseudoMin}\` (HH:${String(pseudoMin).padStart(2, "0")})`,
          `CheckDispo: **${cdOn ? "ON" : "OFF"}** — horaires: ${fmtTimes(cdTimes)}`,
          `${ICON.rappel} Rappel: **${rpOn ? "ON" : "OFF"}** — horaires: ${fmtTimes(rpTimes)}`,
        ].join("\n"),
      }
    )
    .setFooter({ text: "XIG BLAUGRANA FC Staff" });
}

const inScope = (i, scope) => typeof i.customId === "string" && i.customId.endsWith(scope);

// ✅ désactive les composants à la fin (évite clics -> interaction failed)
function disableComponents(rows) {
  return rows.map((row) => {
    const r = ActionRowBuilder.from(row);
    r.components = r.components.map((c) => {
      if (typeof c.setDisabled === "function") c.setDisabled(true);
      return c;
    });
    return r;
  });
}

// ✅ mini-queue pour éviter les refresh concurrents (source fréquente de "interaction failed")
function createRefreshQueue(fn) {
  let chain = Promise.resolve();
  return () => {
    chain = chain.then(fn).catch(() => {});
    return chain;
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurer salons + rôles + postes + check dispo + automations.")
    .setDefaultMemberPermissions(0n),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ content: ICON.no, flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      const guild = interaction.guild;
      const guildId = guild.id;
      const saved = getGuildConfig(guildId) || {};

      if (!isStaff(interaction.member, saved)) {
        return interaction
          .reply({ content: `${ICON.no} Accès réservé au STAFF.`, flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }

      const legacyPostRoleIds = Array.isArray(saved.posts)
        ? saved.posts.map((p) => p?.roleId).filter(Boolean)
        : [];

      const draft = {
        disposChannelId: saved.disposChannelId || null,
        staffReportsChannelId: saved.staffReportsChannelId || null,
        pseudoScanChannelId: saved.pseudoScanChannelId || null,

        checkDispoChannelId: saved.checkDispoChannelId || null,
        dispoMessageIds: normalizeDispoMessageIds(saved.dispoMessageIds),

        staffRoleIds: uniqIds(
          Array.isArray(saved.staffRoleIds) ? saved.staffRoleIds : saved.staffRoleId ? [saved.staffRoleId] : [],
          25
        ),
        playerRoleIds: uniqIds(Array.isArray(saved.playerRoleIds) ? saved.playerRoleIds : [], 25),
        postRoleIds: uniqIds(Array.isArray(saved.postRoleIds) ? saved.postRoleIds : legacyPostRoleIds, 25),

        automations: {
          enabled: !!saved?.automations?.enabled,
          pseudo: {
            enabled: saved?.automations?.pseudo?.enabled !== false,
            minute: clampInt(saved?.automations?.pseudo?.minute, { fallback: 10 }),
          },
          checkDispo: {
            enabled: !!saved?.automations?.checkDispo?.enabled,
            times: normalizeTimes(saved?.automations?.checkDispo?.times),
          },
          rappel: {
            enabled: !!saved?.automations?.rappel?.enabled,
            times: normalizeTimes(saved?.automations?.rappel?.times),
          },
        },
      };

      const scope = `${guildId}:${interaction.user.id}`;
      const CID = {
        dispos: `setup:dispos:${scope}`,
        staffReports: `setup:staffReports:${scope}`,
        pseudoScan: `setup:pseudoScan:${scope}`,
        checkDispo: `setup:checkDispo:${scope}`,

        staff: `setup:staff:${scope}`,
        players: `setup:players:${scope}`,
        posts: `setup:posts:${scope}`,

        msg: (d) => `setup:msg:${d}:${scope}`,
        msgClear: `setup:msg:clear:${scope}`,

        autoGlobal: `setup:auto:global:${scope}`,
        autoPseudo: `setup:auto:pseudo:${scope}`,
        autoCheck: `setup:auto:check:${scope}`,
        autoRappel: `setup:auto:rappel:${scope}`,
        pseudoMinute: `setup:auto:pseudoMinute:${scope}`,

        checkTimes: `setup:auto:checkTimes:${scope}`,
        checkAdd: `setup:auto:checkAdd:${scope}`,
        checkClear: `setup:auto:checkClear:${scope}`,
        modalAddTime: `setup:modal:addTime:${scope}`,

        rappelTimes: `setup:auto:rappelTimes:${scope}`,
        rappelAdd: `setup:auto:rappelAdd:${scope}`,
        rappelClear: `setup:auto:rappelClear:${scope}`,
        modalAddRappelTime: `setup:modal:addRappelTime:${scope}`,

        save: `setup:save:${scope}`,
        reset: `setup:reset:${scope}`,
        cancel: `setup:cancel:${scope}`,
        modalPseudoMinute: `setup:modal:pseudoMinute:${scope}`,
      };
      // ---------- UI (message 1) ----------
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

      // ---------- UI (message 2) ----------
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

      const rowAutoButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.autoGlobal)
          .setLabel("Global")
          .setStyle(draft.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(CID.autoPseudo)
          .setLabel("Pseudo")
          .setStyle(draft.automations.pseudo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(CID.pseudoMinute)
          .setLabel(`${ICON.clock} Minute`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(CID.autoCheck)
          .setLabel("CheckDispo")
          .setStyle(draft.automations.checkDispo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(CID.autoRappel)
          .setLabel("Rappel")
          .setStyle(draft.automations.rappel.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      );

      const rowCancel = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.cancel).setLabel(`${ICON.cancel} Cancel`).setStyle(ButtonStyle.Danger)
      );

      // ---------- UI (message 3) ----------
      const rowCheckDispoChannel = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.checkDispo)
          .setPlaceholder(`${ICON.checkDispo} Salon Check Dispo (opt)`)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowMsgButtons1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.msg("Lun")).setLabel("ID Lun").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.msg("Mar")).setLabel("ID Mar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.msg("Mer")).setLabel("ID Mer").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.msg("Jeu")).setLabel("ID Jeu").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.msg("Ven")).setLabel("ID Ven").setStyle(ButtonStyle.Primary)
      );

      const rowMsgButtons2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.msg("Sam")).setLabel("ID Sam").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.msg("Dim")).setLabel("ID Dim").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.msgClear).setLabel("Clear IDs").setStyle(ButtonStyle.Secondary)
      );

      const preset = PRESET_TIMES.map(normalizeTimeStr).filter(Boolean);

      const rowTimesSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.checkTimes)
          .setPlaceholder(`${ICON.times} Horaires CheckDispo (max 12)`)
          .setMinValues(0)
          .setMaxValues(Math.min(12, preset.length))
          .addOptions(
            preset.map((t) => ({
              label: t,
              value: t,
              default: (draft.automations.checkDispo.times || []).includes(t),
            }))
          )
      );

      const rowTimesButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.checkAdd)
          .setLabel(`${ICON.plus} Ajouter HH:MM (CheckDispo)`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(CID.checkClear)
          .setLabel(`${ICON.broom} Clear CheckDispo`)
          .setStyle(ButtonStyle.Secondary)
      );

      const rowRappelTimesSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.rappelTimes)
          .setPlaceholder(`${ICON.rappel} Horaires Rappel (max 12)`)
          .setMinValues(0)
          .setMaxValues(Math.min(12, preset.length))
          .addOptions(
            preset.map((t) => ({
              label: t,
              value: t,
              default: (draft.automations.rappel.times || []).includes(t),
            }))
          )
      );

      const rowRappelButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.rappelAdd)
          .setLabel(`${ICON.plus} Ajouter HH:MM (Rappel)`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(CID.rappelClear)
          .setLabel(`${ICON.broom} Clear Rappel`)
          .setStyle(ButtonStyle.Secondary)
      );

      // defaults UI
      try {
        if (draft.disposChannelId) rowDispos.components[0].setDefaultChannels([draft.disposChannelId]);
        if (draft.staffReportsChannelId) rowStaffReports.components[0].setDefaultChannels([draft.staffReportsChannelId]);
        if (draft.pseudoScanChannelId) rowPseudoScan.components[0].setDefaultChannels([draft.pseudoScanChannelId]);
        if (draft.checkDispoChannelId) rowCheckDispoChannel.components[0].setDefaultChannels([draft.checkDispoChannelId]);

        if (draft.staffRoleIds.length) rowRoleStaff.components[0].setDefaultRoles(draft.staffRoleIds.slice(0, 25));
        if (draft.playerRoleIds.length) rowRolePlayers.components[0].setDefaultRoles(draft.playerRoleIds.slice(0, 25));
        if (draft.postRoleIds.length) rowRolePosts.components[0].setDefaultRoles(draft.postRoleIds.slice(0, 25));
      } catch {}

      await interaction.reply({
        embeds: [buildEmbed(guild, draft)],
        components: [rowDispos, rowStaffReports, rowPseudoScan, rowActions1],
        flags: MessageFlags.Ephemeral,
      });

      // ✅ récupère le "message 1"
      const msg1 = await interaction.fetchReply().catch(() => null);

      const msg2 = await interaction.followUp({
        content: "🧩 Rôles / 📌 Postes / 🤖 Automations",
        components: [rowRoleStaff, rowRolePlayers, rowRolePosts, rowAutoButtons, rowCancel],
        flags: MessageFlags.Ephemeral,
      });

      const msg3 = await interaction.followUp({
        content:
          "🗓️ **Check Dispo** — Salon (opt) + IDs messages + horaires auto.\n" +
          "🔔 **Rappel** — Horaires auto (pour relancer ceux sans réponse).\n" +
          "➡️ IDs : clique un bouton puis **envoie l’ID** (il sera supprimé). Timeout: 60s.",
        components: [
          rowCheckDispoChannel,
          rowMsgButtons1,
          rowMsgButtons2,
          rowTimesSelect,
          rowTimesButtons,
          rowRappelTimesSelect,
          rowRappelButtons,
        ],
        flags: MessageFlags.Ephemeral,
      });

      const doRefresh = async () => {
        // styles
        rowAutoButtons.components[0].setStyle(draft.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
        rowAutoButtons.components[1].setStyle(draft.automations.pseudo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
        rowAutoButtons.components[3].setStyle(draft.automations.checkDispo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
        rowAutoButtons.components[4].setStyle(draft.automations.rappel.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);

        // defaults
        try {
          rowDispos.components[0].setDefaultChannels(draft.disposChannelId ? [draft.disposChannelId] : []);
          rowStaffReports.components[0].setDefaultChannels(draft.staffReportsChannelId ? [draft.staffReportsChannelId] : []);
          rowPseudoScan.components[0].setDefaultChannels(draft.pseudoScanChannelId ? [draft.pseudoScanChannelId] : []);
          rowCheckDispoChannel.components[0].setDefaultChannels(draft.checkDispoChannelId ? [draft.checkDispoChannelId] : []);

          rowRoleStaff.components[0].setDefaultRoles((draft.staffRoleIds || []).slice(0, 25));
          rowRolePlayers.components[0].setDefaultRoles((draft.playerRoleIds || []).slice(0, 25));
          rowRolePosts.components[0].setDefaultRoles((draft.postRoleIds || []).slice(0, 25));

          rowTimesSelect.components[0].setOptions(
            preset.map((t) => ({ label: t, value: t, default: (draft.automations.checkDispo.times || []).includes(t) }))
          );
          rowRappelTimesSelect.components[0].setOptions(
            preset.map((t) => ({ label: t, value: t, default: (draft.automations.rappel.times || []).includes(t) }))
          );
        } catch {}

        await interaction
          .editReply({
            embeds: [buildEmbed(guild, draft)],
            components: [rowDispos, rowStaffReports, rowPseudoScan, rowActions1],
          })
          .catch(() => {});

        await msg2
          .edit({
            content: "🧩 Rôles / 📌 Postes / 🤖 Automations",
            components: [rowRoleStaff, rowRolePlayers, rowRolePosts, rowAutoButtons, rowCancel],
          })
          .catch(() => {});

        await msg3
          .edit({
            content:
              "🗓️ **Check Dispo** — Salon (opt) + IDs messages + horaires auto.\n" +
              "🔔 **Rappel** — Horaires auto (pour relancer ceux sans réponse).\n" +
              "➡️ IDs : clique un bouton puis **envoie l’ID** (il sera supprimé). Timeout: 60s.",
            components: [
              rowCheckDispoChannel,
              rowMsgButtons1,
              rowMsgButtons2,
              rowTimesSelect,
              rowTimesButtons,
              rowRappelTimesSelect,
              rowRappelButtons,
            ],
          })
          .catch(() => {});
      };

      const refresh = createRefreshQueue(doRefresh);
      async function askMessageId(i, dayLabel) {
        const idx = DAY_INDEX[dayLabel];
        if (typeof idx !== "number") return;

        await i
          .reply({
            content: `Envoie l’ID du message pour **${dayLabel}** (15-25 chiffres). Timeout: 60s.`,
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});

        // ✅ utiliser le channel réel
        const textChannel = interaction.channel;
        if (!textChannel) {
          return i.followUp({ content: "⚠️ Canal introuvable.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        const filter = (m) => m.author.id === interaction.user.id;
        const collected = await textChannel.awaitMessages({ filter, max: 1, time: 60_000 }).catch(() => null);
        const m = collected?.first?.() || null;

        if (!m) {
          return i
            .followUp({ content: "⚠️ Timeout. Re-clique sur le bouton du jour.", flags: MessageFlags.Ephemeral })
            .catch(() => {});
        }

        const id = String(m.content || "").trim();
        try {
          await m.delete().catch(() => {});
        } catch {}

        if (!isSnowflake(id)) {
          return i
            .followUp({ content: "⚠️ ID invalide. Re-clique et envoie un ID valide.", flags: MessageFlags.Ephemeral })
            .catch(() => {});
        }

        const next = normalizeDispoMessageIds(draft.dispoMessageIds);
        next[idx] = id;
        draft.dispoMessageIds = next;

        return refresh();
      }

      const openPseudoMinuteModal = (i) => {
        const modal = new ModalBuilder().setCustomId(CID.modalPseudoMinute).setTitle("Pseudo — minute (0-59)");
        const input = new TextInputBuilder()
          .setCustomId("minute")
          .setLabel("Minute (0-59)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("ex: 10")
          .setValue(String(clampInt(draft.automations?.pseudo?.minute, { fallback: 10 })));

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return i.showModal(modal);
      };

      const openAddTimeModal = (i) => {
        const modal = new ModalBuilder().setCustomId(CID.modalAddTime).setTitle("CheckDispo — ajouter HH:MM");
        const input = new TextInputBuilder()
          .setCustomId("time")
          .setLabel("Horaire (HH:MM)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("ex: 21:10");
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return i.showModal(modal);
      };

      const openAddRappelTimeModal = (i) => {
        const modal = new ModalBuilder().setCustomId(CID.modalAddRappelTime).setTitle("Rappel — ajouter HH:MM");
        const input = new TextInputBuilder()
          .setCustomId("time")
          .setLabel("Horaire (HH:MM)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("ex: 20:45");
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return i.showModal(modal);
      };

      const awaitModal = (filter) => interaction.awaitModalSubmit({ filter, time: 10 * 60 * 1000 }).catch(() => null);

      // ✅ Collectors attachés aux MESSAGES
      const collectors = [];
      const makeCollector = (msg) => {
        if (!msg?.createMessageComponentCollector) return null;
        const c = msg.createMessageComponentCollector({
          time: 10 * 60 * 1000,
          filter: (i) => i.user.id === interaction.user.id && inScope(i, scope),
        });
        collectors.push(c);
        return c;
      };

      const c1 = makeCollector(msg1);
      const c2 = makeCollector(msg2);
      const c3 = makeCollector(msg3);

      const stopAll = () => {
        for (const c of collectors) {
          try {
            c.stop();
          } catch {}
        }
      };

      let ended = false;
      const endAll = async () => {
        if (ended) return;
        ended = true;

        const disabled1 = disableComponents([rowDispos, rowStaffReports, rowPseudoScan, rowActions1]);
        const disabled2 = disableComponents([rowRoleStaff, rowRolePlayers, rowRolePosts, rowAutoButtons, rowCancel]);
        const disabled3 = disableComponents([
          rowCheckDispoChannel,
          rowMsgButtons1,
          rowMsgButtons2,
          rowTimesSelect,
          rowTimesButtons,
          rowRappelTimesSelect,
          rowRappelButtons,
        ]);

        try {
          await interaction.editReply({ content: ICON.time, embeds: [buildEmbed(guild, draft)], components: disabled1 });
        } catch {}
        try {
          await msg2.edit({ content: ICON.time, components: disabled2 });
        } catch {}
        try {
          await msg3.edit({ content: ICON.time, components: disabled3 });
        } catch {}
      };

      const onCollect = async (i) => {
        try {
          // Channel select
          if (i.isChannelSelectMenu()) {
            const v = i.values?.[0] || null;

            if (i.customId === CID.dispos) draft.disposChannelId = v;
            if (i.customId === CID.staffReports) draft.staffReportsChannelId = v;
            if (i.customId === CID.pseudoScan) draft.pseudoScanChannelId = v;
            if (i.customId === CID.checkDispo) draft.checkDispoChannelId = v;

            await i.deferUpdate().catch(() => {});
            return refresh();
          }

          // Role select
          if (i.isRoleSelectMenu()) {
            if (i.customId === CID.staff) draft.staffRoleIds = uniqIds(i.values, 25);
            if (i.customId === CID.players) draft.playerRoleIds = uniqIds(i.values, 25);
            if (i.customId === CID.posts) draft.postRoleIds = uniqIds(i.values, 25);

            await i.deferUpdate().catch(() => {});
            return refresh();
          }

          // Time select
          if (i.isStringSelectMenu()) {
            if (i.customId === CID.checkTimes) {
              draft.automations.checkDispo.times = normalizeTimes(i.values, { max: 12 });
              await i.deferUpdate().catch(() => {});
              return refresh();
            }
            if (i.customId === CID.rappelTimes) {
              draft.automations.rappel.times = normalizeTimes(i.values, { max: 12 });
              await i.deferUpdate().catch(() => {});
              return refresh();
            }
          }

          if (!i.isButton()) return;

          // Toggles
          if (i.customId === CID.autoGlobal) {
            draft.automations.enabled = !draft.automations.enabled;
            await i.deferUpdate().catch(() => {});
            return refresh();
          }
          if (i.customId === CID.autoPseudo) {
            draft.automations.pseudo.enabled = !draft.automations.pseudo.enabled;
            await i.deferUpdate().catch(() => {});
            return refresh();
          }
          if (i.customId === CID.autoCheck) {
            draft.automations.checkDispo.enabled = !draft.automations.checkDispo.enabled;
            await i.deferUpdate().catch(() => {});
            return refresh();
          }
          if (i.customId === CID.autoRappel) {
            draft.automations.rappel.enabled = !draft.automations.rappel.enabled;
            await i.deferUpdate().catch(() => {});
            return refresh();
          }

          // Clears
          if (i.customId === CID.msgClear) {
            draft.dispoMessageIds = new Array(7).fill(null);
            await i.deferUpdate().catch(() => {});
            return refresh();
          }
          if (i.customId === CID.checkClear) {
            draft.automations.checkDispo.times = [];
            await i.deferUpdate().catch(() => {});
            return refresh();
          }
          if (i.customId === CID.rappelClear) {
            draft.automations.rappel.times = [];
            await i.deferUpdate().catch(() => {});
            return refresh();
          }

          // Modals
          if (i.customId === CID.pseudoMinute) {
            await openPseudoMinuteModal(i).catch(() => {});
            const mi = await awaitModal((x) => x.customId === CID.modalPseudoMinute && x.user.id === interaction.user.id);
            if (!mi) return;

            const minute = clampInt(mi.fields.getTextInputValue("minute"), { fallback: 10 });
            draft.automations.pseudo.minute = minute;

            await mi
              .reply({
                content: `✅ Minute pseudo: \`${minute}\` (HH:${String(minute).padStart(2, "0")}).`,
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
            return refresh();
          }

          if (i.customId === CID.checkAdd) {
            await openAddTimeModal(i).catch(() => {});
            const mi = await awaitModal((x) => x.customId === CID.modalAddTime && x.user.id === interaction.user.id);
            if (!mi) return;

            const t = normalizeTimeStr(mi.fields.getTextInputValue("time"));
            if (!t) {
              await mi
                .reply({ content: "⚠️ Format invalide. Attendu: `HH:MM` (ex: 21:10).", flags: MessageFlags.Ephemeral })
                .catch(() => {});
              return;
            }

            draft.automations.checkDispo.times = normalizeTimes([...(draft.automations.checkDispo.times || []), t], { max: 12 });
            await mi.reply({ content: `✅ Horaire ajouté (CheckDispo): \`${t}\``, flags: MessageFlags.Ephemeral }).catch(() => {});
            return refresh();
          }

          if (i.customId === CID.rappelAdd) {
            await openAddRappelTimeModal(i).catch(() => {});
            const mi = await awaitModal((x) => x.customId === CID.modalAddRappelTime && x.user.id === interaction.user.id);
            if (!mi) return;

            const t = normalizeTimeStr(mi.fields.getTextInputValue("time"));
            if (!t) {
              await mi
                .reply({ content: "⚠️ Format invalide. Attendu: `HH:MM` (ex: 20:45).", flags: MessageFlags.Ephemeral })
                .catch(() => {});
              return;
            }

            draft.automations.rappel.times = normalizeTimes([...(draft.automations.rappel.times || []), t], { max: 12 });
            await mi.reply({ content: `✅ Horaire ajouté (Rappel): \`${t}\``, flags: MessageFlags.Ephemeral }).catch(() => {});
            return refresh();
          }

          // Days (ID message)
          const day = DAYS.find((d) => i.customId === CID.msg(d));
          if (day) return askMessageId(i, day);

          // Reset
          if (i.customId === CID.reset) {
            draft.disposChannelId = null;
            draft.staffReportsChannelId = null;
            draft.pseudoScanChannelId = null;

            draft.staffRoleIds = [];
            draft.playerRoleIds = [];
            draft.postRoleIds = [];

            draft.checkDispoChannelId = null;
            draft.dispoMessageIds = new Array(7).fill(null);

            draft.automations = {
              enabled: false,
              pseudo: { enabled: true, minute: 10 },
              checkDispo: { enabled: false, times: [] },
              rappel: { enabled: false, times: [] },
            };

            await i.deferUpdate().catch(() => {});
            return refresh();
          }

          // Save
          if (i.customId === CID.save) {
            const requiredOk =
              !!draft.disposChannelId &&
              !!draft.staffReportsChannelId &&
              (draft.staffRoleIds || []).length > 0 &&
              (draft.playerRoleIds || []).length > 0;

            if (!requiredOk) {
              return i.reply({ content: ICON.warn, flags: MessageFlags.Ephemeral }).catch(() => {});
            }

            const legacyPosts = (draft.postRoleIds || []).map((roleId) => ({ roleId: String(roleId), label: "POSTE" }));

            upsertGuildConfig(guildId, {
              botLabel: "XIG BLAUGRANA FC Staff",
              disposChannelId: draft.disposChannelId,
              staffReportsChannelId: draft.staffReportsChannelId,
              pseudoScanChannelId: draft.pseudoScanChannelId,

              checkDispoChannelId: draft.checkDispoChannelId,
              dispoMessageIds: normalizeDispoMessageIds(draft.dispoMessageIds),

              staffRoleIds: uniqIds(draft.staffRoleIds, 25),
              playerRoleIds: uniqIds(draft.playerRoleIds, 25),
              postRoleIds: uniqIds(draft.postRoleIds, 25),

              // compat
              staffRoleId: draft.staffRoleIds[0] || null,
              posts: legacyPosts,

              automations: {
                enabled: !!draft.automations.enabled,
                pseudo: {
                  enabled: !!draft.automations.pseudo.enabled,
                  minute: clampInt(draft.automations.pseudo.minute, { fallback: 10 }),
                },
                checkDispo: {
                  enabled: !!draft.automations.checkDispo.enabled,
                  times: normalizeTimes(draft.automations.checkDispo.times),
                },
                rappel: {
                  enabled: !!draft.automations.rappel.enabled,
                  times: normalizeTimes(draft.automations.rappel.times),
                },
              },

              setupBy: interaction.user.id,
              setupAt: new Date().toISOString(),
            });

            stopAll();

            await i.update({ content: `${ICON.save} Saved`, embeds: [buildEmbed(guild, draft)], components: [] }).catch(() => {});
            await msg2.edit({ content: `${ICON.save} Saved`, components: [] }).catch(() => {});
            await msg3.edit({ content: `${ICON.save} Saved`, components: [] }).catch(() => {});
            return;
          }

          // Cancel
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
            return;
          }
        } catch {
          try {
            if (!i.replied && !i.deferred) {
              await i.reply({ content: ICON.warn, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
          } catch {}
        }
      };

      // branche les collectors
      for (const c of [c1, c2, c3].filter(Boolean)) {
        c.on("collect", onCollect);
        c.on("end", () => endAll().catch(() => {}));
      }
    } catch {
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "⚠️", flags: MessageFlags.Ephemeral }).catch(() => {});
        } else {
          await interaction.followUp({ content: "⚠️", flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      } catch {}
    }
  },
};
