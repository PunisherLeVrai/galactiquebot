// src/commands/setup.js
// Setup — 3 messages — multi-serveur — STAFF ONLY — version compacte + corrigée
// - salons: dispos + staff + pseudoScan(opt) + checkDispo(opt)
// - rôles: staffRoleIds (>=1) + playerRoleIds (>=1) + postRoleIds (0..25)
// - checkDispo: 7 IDs (Lun..Dim)
// - automations: enabled + pseudo {enabled, minute} + checkDispo {enabled, times[]}
// - ✅ reminderDispo: { enabled, mode, channelId, times[] }  (rappel horaire sans réaction)
//
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
  msg: "✉️",
  times: "🕒",
  plus: "➕",
  broom: "🧹",
  bell: "🔔",
};

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAY_INDEX = { Lun: 0, Mar: 1, Mer: 2, Jeu: 3, Ven: 4, Sam: 5, Dim: 6 };

// ⚠️ presets (max 12 effectifs après normalisation) — stable + utile
const PRESET_TIMES = [
  "17:10", "18:10", "19:10", "20:10", "20:45",
  "21:00", "21:10", "21:20", "21:40",
  "22:00", "22:10", "22:20", "22:40",
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

function normalizeReminderMode(v) {
  const s = String(v || "").toLowerCase().trim();
  if (s === "dm" || s === "mp") return "dm";
  if (s === "both" || s === "2") return "both";
  return "channel";
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

  const rdOn = !!a?.reminderDispo?.enabled;
  const rdMode = normalizeReminderMode(a?.reminderDispo?.mode);
  const rdCh = a?.reminderDispo?.channelId ? fmtCh(a.reminderDispo.channelId) : "—";
  const rdTimes = normalizeTimes(a?.reminderDispo?.times);

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
          `ReminderDispo: **${rdOn ? "ON" : "OFF"}** — mode: \`${rdMode}\` — salon: ${rdCh} — horaires: ${fmtTimes(rdTimes)}`,
        ].join("\n"),
      }
    )
    .setFooter({ text: "XIG BLAUGRANA FC Staff" });
}

const inScope = (i, scope) => typeof i.customId === "string" && i.customId.endsWith(scope);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurer salons + rôles + postes + check dispo + automations.")
    .setDefaultMemberPermissions(0n),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: ICON.no, ephemeral: true });

      const guild = interaction.guild;
      const guildId = guild.id;
      const saved = getGuildConfig(guildId) || {};

      if (!isStaff(interaction.member, saved)) {
        return interaction.reply({ content: `${ICON.no} Accès réservé au STAFF.`, ephemeral: true });
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
          Array.isArray(saved.staffRoleIds)
            ? saved.staffRoleIds
            : saved.staffRoleId
              ? [saved.staffRoleId]
              : [],
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
          reminderDispo: {
            enabled: !!saved?.automations?.reminderDispo?.enabled,
            mode: normalizeReminderMode(saved?.automations?.reminderDispo?.mode || "channel"),
            channelId: saved?.automations?.reminderDispo?.channelId ? String(saved.automations.reminderDispo.channelId) : null,
            times: normalizeTimes(saved?.automations?.reminderDispo?.times),
          },
        },
      };

      const scope = `${guildId}:${interaction.user.id}`;
      const CID = {
        dispos: `setup:dispos:${scope}`,
        staffReports: `setup:staffReports:${scope}`,
        pseudoScan: `setup:pseudoScan:${scope}`,

        checkDispo: `setup:checkDispo:${scope}`,
        reminderChannel: `setup:reminderChannel:${scope}`,

        staff: `setup:staff:${scope}`,
        players: `setup:players:${scope}`,
        posts: `setup:posts:${scope}`,

        msg: (d) => `setup:msg:${d}:${scope}`,
        msgClear: `setup:msg:clear:${scope}`,

        autoGlobal: `setup:auto:global:${scope}`,
        autoPseudo: `setup:auto:pseudo:${scope}`,
        autoCheck: `setup:auto:check:${scope}`,
        autoReminder: `setup:auto:reminder:${scope}`,

        pseudoMinute: `setup:auto:pseudoMinute:${scope}`,

        checkTimes: `setup:auto:checkTimes:${scope}`,
        checkAdd: `setup:auto:checkAdd:${scope}`,
        checkClear: `setup:auto:checkClear:${scope}`,
        modalAddTime: `setup:modal:addTime:${scope}`,

        reminderMode: `setup:auto:reminderMode:${scope}`,
        reminderTimes: `setup:auto:reminderTimes:${scope}`,
        reminderAdd: `setup:auto:reminderAdd:${scope}`,
        reminderClear: `setup:auto:reminderClear:${scope}`,
        modalAddReminderTime: `setup:modal:addReminderTime:${scope}`,

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

      const rowAutoButtons1 = new ActionRowBuilder().addComponents(
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
          .setCustomId(CID.autoReminder)
          .setLabel("ReminderDispo")
          .setStyle(draft.automations.reminderDispo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      );

      const rowAutoButtons2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.cancel).setLabel(`${ICON.cancel} Cancel`).setStyle(ButtonStyle.Danger)
      );

      // defaults UI (menus)
      try {
        if (draft.disposChannelId) rowDispos.components[0].setDefaultChannels([draft.disposChannelId]);
        if (draft.staffReportsChannelId) rowStaffReports.components[0].setDefaultChannels([draft.staffReportsChannelId]);
        if (draft.pseudoScanChannelId) rowPseudoScan.components[0].setDefaultChannels([draft.pseudoScanChannelId]);

        if (draft.staffRoleIds.length) rowRoleStaff.components[0].setDefaultRoles(draft.staffRoleIds.slice(0, 25));
        if (draft.playerRoleIds.length) rowRolePlayers.components[0].setDefaultRoles(draft.playerRoleIds.slice(0, 25));
        if (draft.postRoleIds.length) rowRolePosts.components[0].setDefaultRoles(draft.postRoleIds.slice(0, 25));
      } catch {}

      await interaction.reply({
        embeds: [buildEmbed(guild, draft)],
        components: [rowDispos, rowStaffReports, rowPseudoScan, rowActions1],
        ephemeral: true,
      });

      const msg2 = await interaction.followUp({
        content: "🧩 Rôles / 📌 Postes / 🤖 Automations",
        components: [rowRoleStaff, rowRolePlayers, rowRolePosts, rowAutoButtons1, rowAutoButtons2],
        ephemeral: true,
      });

      // ---------- UI (message 3) ----------
      const rowCheckDispoChannel = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.checkDispo)
          .setPlaceholder(`${ICON.checkDispo} Salon Check Dispo (opt)`)
          .setMinValues(0)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );

      const rowReminderChannel = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.reminderChannel)
          .setPlaceholder(`${ICON.bell} Salon ReminderDispo (opt)`)
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
        new ButtonBuilder().setCustomId(CID.checkAdd).setLabel(`${ICON.plus} Ajouter HH:MM (Check)`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.checkClear).setLabel(`${ICON.broom} Clear horaires Check`).setStyle(ButtonStyle.Secondary)
      );

      const rowReminderMode = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.reminderMode)
          .setPlaceholder(`${ICON.bell} Mode ReminderDispo`)
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            { label: "channel", value: "channel", default: draft.automations.reminderDispo.mode === "channel" },
            { label: "dm", value: "dm", default: draft.automations.reminderDispo.mode === "dm" },
            { label: "both", value: "both", default: draft.automations.reminderDispo.mode === "both" }
          )
      );

      const rowReminderTimesSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.reminderTimes)
          .setPlaceholder(`${ICON.bell} Horaires ReminderDispo (max 12)`)
          .setMinValues(0)
          .setMaxValues(Math.min(12, preset.length))
          .addOptions(
            preset.map((t) => ({
              label: t,
              value: t,
              default: (draft.automations.reminderDispo.times || []).includes(t),
            }))
          )
      );

      const rowReminderButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.reminderAdd).setLabel(`${ICON.plus} Ajouter HH:MM (Reminder)`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.reminderClear).setLabel(`${ICON.broom} Clear Reminder`).setStyle(ButtonStyle.Secondary)
      );

      try {
        if (draft.checkDispoChannelId) rowCheckDispoChannel.components[0].setDefaultChannels([draft.checkDispoChannelId]);
        if (draft.automations.reminderDispo.channelId) rowReminderChannel.components[0].setDefaultChannels([draft.automations.reminderDispo.channelId]);
      } catch {}

      const msg3 = await interaction.followUp({
        content:
          "🗓️ **Check Dispo** — Salon (opt) + IDs messages + horaires auto.\n" +
          "🔔 **ReminderDispo** — Mode + salon (opt) + horaires auto.\n" +
          "➡️ IDs : clique un bouton puis **envoie l’ID** (il sera supprimé). Timeout: 60s.",
        components: [
          rowCheckDispoChannel,
          rowMsgButtons1,
          rowMsgButtons2,
          rowTimesSelect,
          rowTimesButtons,
          rowReminderMode,
          rowReminderChannel,
          rowReminderTimesSelect,
          rowReminderButtons,
        ],
        ephemeral: true,
      });

      const mainMsg = await interaction.fetchReply();

      // ---------- refresh ----------
      const refresh = async () => {
        // styles (automations)
        rowAutoButtons1.components[0].setStyle(draft.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
        rowAutoButtons1.components[1].setStyle(draft.automations.pseudo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
        rowAutoButtons1.components[3].setStyle(draft.automations.checkDispo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
        rowAutoButtons1.components[4].setStyle(draft.automations.reminderDispo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);

        // defaults
        try {
          rowDispos.components[0].setDefaultChannels(draft.disposChannelId ? [draft.disposChannelId] : []);
          rowStaffReports.components[0].setDefaultChannels(draft.staffReportsChannelId ? [draft.staffReportsChannelId] : []);
          rowPseudoScan.components[0].setDefaultChannels(draft.pseudoScanChannelId ? [draft.pseudoScanChannelId] : []);

          rowCheckDispoChannel.components[0].setDefaultChannels(draft.checkDispoChannelId ? [draft.checkDispoChannelId] : []);
          rowReminderChannel.components[0].setDefaultChannels(draft.automations.reminderDispo.channelId ? [draft.automations.reminderDispo.channelId] : []);

          rowRoleStaff.components[0].setDefaultRoles((draft.staffRoleIds || []).slice(0, 25));
          rowRolePlayers.components[0].setDefaultRoles((draft.playerRoleIds || []).slice(0, 25));
          rowRolePosts.components[0].setDefaultRoles((draft.postRoleIds || []).slice(0, 25));

          rowTimesSelect.components[0].setOptions(
            preset.map((t) => ({
              label: t,
              value: t,
              default: (draft.automations.checkDispo.times || []).includes(t),
            }))
          );

          rowReminderMode.components[0].setOptions(
            [
              { label: "channel", value: "channel", default: draft.automations.reminderDispo.mode === "channel" },
              { label: "dm", value: "dm", default: draft.automations.reminderDispo.mode === "dm" },
              { label: "both", value: "both", default: draft.automations.reminderDispo.mode === "both" },
            ]
          );

          rowReminderTimesSelect.components[0].setOptions(
            preset.map((t) => ({
              label: t,
              value: t,
              default: (draft.automations.reminderDispo.times || []).includes(t),
            }))
          );
        } catch {}

        await interaction.editReply({
          embeds: [buildEmbed(guild, draft)],
          components: [rowDispos, rowStaffReports, rowPseudoScan, rowActions1],
        });

        await msg2.edit({
          content: "🧩 Rôles / 📌 Postes / 🤖 Automations",
          components: [rowRoleStaff, rowRolePlayers, rowRolePosts, rowAutoButtons1, rowAutoButtons2],
        }).catch(() => {});

        await msg3.edit({
          content:
            "🗓️ **Check Dispo** — Salon (opt) + IDs messages + horaires auto.\n" +
            "🔔 **ReminderDispo** — Mode + salon (opt) + horaires auto.\n" +
            "➡️ IDs : clique un bouton puis **envoie l’ID** (il sera supprimé). Timeout: 60s.",
          components: [
            rowCheckDispoChannel,
            rowMsgButtons1,
            rowMsgButtons2,
            rowTimesSelect,
            rowTimesButtons,
            rowReminderMode,
            rowReminderChannel,
            rowReminderTimesSelect,
            rowReminderButtons,
          ],
        }).catch(() => {});
      };

      // ---------- collectors ----------
      const col1 = mainMsg.createMessageComponentCollector({ time: 10 * 60 * 1000 });
      const col2 = msg2.createMessageComponentCollector({ time: 10 * 60 * 1000 });
      const col3 = msg3.createMessageComponentCollector({ time: 10 * 60 * 1000 });

      const stopAll = () => {
        try { col1.stop(); } catch {}
        try { col2.stop(); } catch {}
        try { col3.stop(); } catch {}
      };

      async function askMessageId(i, dayLabel) {
        const idx = DAY_INDEX[dayLabel];
        if (typeof idx !== "number") return;

        await i.reply({
          content: `Envoie l’ID du message pour **${dayLabel}** (15-25 chiffres). Timeout: 60s.`,
          ephemeral: true,
        });

        const filter = (m) => m.author.id === interaction.user.id;
        const collected = await i.channel.awaitMessages({ filter, max: 1, time: 60_000 }).catch(() => null);
        const m = collected?.first?.() || null;

        if (!m) return i.followUp({ content: "⚠️ Timeout. Re-clique sur le bouton du jour.", ephemeral: true }).catch(() => {});
        const id = String(m.content || "").trim();
        try { await m.delete().catch(() => {}); } catch {}

        if (!isSnowflake(id)) {
          return i.followUp({ content: "⚠️ ID invalide. Re-clique et envoie un ID valide.", ephemeral: true }).catch(() => {});
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

      const openAddReminderTimeModal = (i) => {
        const modal = new ModalBuilder().setCustomId(CID.modalAddReminderTime).setTitle("ReminderDispo — ajouter HH:MM");
        const input = new TextInputBuilder()
          .setCustomId("time")
          .setLabel("Horaire (HH:MM)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("ex: 21:10");
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return i.showModal(modal);
      };

      // ✅ IMPORTANT: pas de interaction.client.on(...) (sinon listeners multiples)
      // On attend les modals via awaitModalSubmit avec un filter scope.
      const awaitModal = (filter) =>
        interaction.awaitModalSubmit({ filter, time: 10 * 60 * 1000 }).catch(() => null);

      // ---------- collect 1 (message principal) ----------
      col1.on("collect", async (i) => {
        try {
          if (i.user.id !== interaction.user.id || !inScope(i, scope)) {
            return i.reply({ content: ICON.no, ephemeral: true }).catch(() => {});
          }

          if (i.isChannelSelectMenu()) {
            const v = i.values?.[0] || null;
            if (i.customId === CID.dispos) draft.disposChannelId = v;
            if (i.customId === CID.staffReports) draft.staffReportsChannelId = v;
            if (i.customId === CID.pseudoScan) draft.pseudoScanChannelId = v;
            await i.deferUpdate();
            return refresh();
          }

          if (!i.isButton()) return;

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
              reminderDispo: { enabled: false, mode: "channel", channelId: null, times: [] },
            };

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

            if (!requiredOk) return i.reply({ content: ICON.warn, ephemeral: true }).catch(() => {});

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
                reminderDispo: {
                  enabled: !!draft.automations.reminderDispo.enabled,
                  mode: normalizeReminderMode(draft.automations.reminderDispo.mode || "channel"),
                  channelId: draft.automations.reminderDispo.channelId || null,
                  times: normalizeTimes(draft.automations.reminderDispo.times),
                },
              },

              setupBy: interaction.user.id,
              setupAt: new Date().toISOString(),
            });

            stopAll();
            await i.update({ content: `${ICON.save} Saved`, embeds: [buildEmbed(guild, draft)], components: [] }).catch(() => {});
            await msg2.edit({ content: `${ICON.save} Saved`, components: [] }).catch(() => {});
            await msg3.edit({ content: `${ICON.save} Saved`, components: [] }).catch(() => {});
          }
        } catch {
          try { if (!i.replied) await i.reply({ content: ICON.warn, ephemeral: true }); } catch {}
        }
      });
            // ---------- collect 2 (roles + automations buttons) ----------
      col2.on("collect", async (i) => {
        try {
          if (i.user.id !== interaction.user.id || !inScope(i, scope)) {
            return i.reply({ content: ICON.no, ephemeral: true }).catch(() => {});
          }

          if (i.isRoleSelectMenu()) {
            if (i.customId === CID.staff) draft.staffRoleIds = uniqIds(i.values, 25);
            if (i.customId === CID.players) draft.playerRoleIds = uniqIds(i.values, 25);
            if (i.customId === CID.posts) draft.postRoleIds = uniqIds(i.values, 25);
            await i.deferUpdate();
            return refresh();
          }

          if (!i.isButton()) return;

          if (i.customId === CID.autoGlobal) {
            draft.automations.enabled = !draft.automations.enabled;
            await i.deferUpdate();
            return refresh();
          }

          if (i.customId === CID.autoPseudo) {
            draft.automations.pseudo.enabled = !draft.automations.pseudo.enabled;
            await i.deferUpdate();
            return refresh();
          }

          if (i.customId === CID.pseudoMinute) {
            await openPseudoMinuteModal(i);
            const mi = await awaitModal((x) => x.customId === CID.modalPseudoMinute && x.user.id === interaction.user.id).catch(() => null);
            if (!mi) return;

            const minute = clampInt(mi.fields.getTextInputValue("minute"), { fallback: 10 });
            draft.automations.pseudo.minute = minute;

            await mi.reply({
              content: `✅ Minute pseudo: \`${minute}\` (HH:${String(minute).padStart(2, "0")}).`,
              ephemeral: true,
            }).catch(() => {});

            return refresh();
          }

          if (i.customId === CID.autoCheck) {
            draft.automations.checkDispo.enabled = !draft.automations.checkDispo.enabled;
            await i.deferUpdate();
            return refresh();
          }

          if (i.customId === CID.autoReminder) {
            draft.automations.reminderDispo.enabled = !draft.automations.reminderDispo.enabled;
            await i.deferUpdate();
            return refresh();
          }

          if (i.customId === CID.cancel) {
            stopAll();
            await i.update({ content: `${ICON.cancel} Cancel`, components: [] }).catch(() => {});
            try { await interaction.editReply({ content: `${ICON.cancel} Cancel`, embeds: [], components: [] }); } catch {}
            try { await msg2.edit({ content: `${ICON.cancel} Cancel`, components: [] }); } catch {}
            try { await msg3.edit({ content: `${ICON.cancel} Cancel`, components: [] }); } catch {}
          }
        } catch {
          try { if (!i.replied) await i.reply({ content: ICON.warn, ephemeral: true }); } catch {}
        }
      });

      // ---------- collect 3 (checkDispo + reminderDispo) ----------
      col3.on("collect", async (i) => {
        try {
          if (i.user.id !== interaction.user.id || !inScope(i, scope)) {
            return i.reply({ content: ICON.no, ephemeral: true }).catch(() => {});
          }

          // channel selects
          if (i.isChannelSelectMenu()) {
            const v = i.values?.[0] || null;
            if (i.customId === CID.checkDispo) draft.checkDispoChannelId = v;
            if (i.customId === CID.reminderChannel) draft.automations.reminderDispo.channelId = v;
            await i.deferUpdate();
            return refresh();
          }

          // string selects
          if (i.isStringSelectMenu()) {
            if (i.customId === CID.checkTimes) {
              draft.automations.checkDispo.times = normalizeTimes(i.values, { max: 12 });
              await i.deferUpdate();
              return refresh();
            }

            if (i.customId === CID.reminderTimes) {
              draft.automations.reminderDispo.times = normalizeTimes(i.values, { max: 12 });
              await i.deferUpdate();
              return refresh();
            }

            if (i.customId === CID.reminderMode) {
              draft.automations.reminderDispo.mode = normalizeReminderMode(i.values?.[0] || "channel");
              await i.deferUpdate();
              return refresh();
            }
          }

          // buttons
          if (!i.isButton()) return;

          if (i.customId === CID.msgClear) {
            draft.dispoMessageIds = new Array(7).fill(null);
            await i.deferUpdate();
            return refresh();
          }

          if (i.customId === CID.checkClear) {
            draft.automations.checkDispo.times = [];
            await i.deferUpdate();
            return refresh();
          }

          if (i.customId === CID.reminderClear) {
            draft.automations.reminderDispo.times = [];
            await i.deferUpdate();
            return refresh();
          }

          if (i.customId === CID.checkAdd) {
            await openAddTimeModal(i);
            const mi = await awaitModal((x) => x.customId === CID.modalAddTime && x.user.id === interaction.user.id).catch(() => null);
            if (!mi) return;

            const t = normalizeTimeStr(mi.fields.getTextInputValue("time"));
            if (!t) {
              await mi.reply({ content: "⚠️ Format invalide. Attendu: `HH:MM` (ex: 21:10).", ephemeral: true }).catch(() => {});
              return;
            }

            draft.automations.checkDispo.times = normalizeTimes([...(draft.automations.checkDispo.times || []), t], { max: 12 });
            await mi.reply({ content: `✅ Horaire ajouté (CheckDispo): \`${t}\``, ephemeral: true }).catch(() => {});
            return refresh();
          }

          if (i.customId === CID.reminderAdd) {
            await openAddReminderTimeModal(i);
            const mi = await awaitModal((x) => x.customId === CID.modalAddReminderTime && x.user.id === interaction.user.id).catch(() => null);
            if (!mi) return;

            const t = normalizeTimeStr(mi.fields.getTextInputValue("time"));
            if (!t) {
              await mi.reply({ content: "⚠️ Format invalide. Attendu: `HH:MM` (ex: 21:10).", ephemeral: true }).catch(() => {});
              return;
            }

            draft.automations.reminderDispo.times = normalizeTimes([...(draft.automations.reminderDispo.times || []), t], { max: 12 });
            await mi.reply({ content: `✅ Horaire ajouté (ReminderDispo): \`${t}\``, ephemeral: true }).catch(() => {});
            return refresh();
          }

          // boutons jours (IDs messages dispo)
          const day = DAYS.find((d) => i.customId === CID.msg(d));
          if (day) return askMessageId(i, day);
        } catch {
          try { if (!i.replied) await i.reply({ content: ICON.warn, ephemeral: true }); } catch {}
        }
      });

      col1.on("end", async () => {
        try { await interaction.editReply({ content: ICON.time, embeds: [], components: [] }); } catch {}
        try { await msg2.edit({ content: ICON.time, components: [] }); } catch {}
        try { await msg3.edit({ content: ICON.time, components: [] }); } catch {}
      });

    } catch {
      try {
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "⚠️", ephemeral: true });
        else await interaction.followUp({ content: "⚠️", ephemeral: true });
      } catch {}
    }
  },
};
