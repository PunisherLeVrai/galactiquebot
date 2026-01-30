// src/commands/setup.js
// Setup — 3 messages — multi-serveur — STAFF ONLY — GLOBAL LISTENER (no collectors)
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

// ⚠️ presets (max 12)
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

// ---- Automations helpers ----
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
// --------------------
// Session store + GLOBAL LISTENER
// --------------------
const SETUP_SESSIONS = new Map(); // key: scope => session
let GLOBAL_SETUP_LISTENER_READY = false;

function createRefreshQueue(fn) {
  let chain = Promise.resolve();
  return () => {
    chain = chain.then(fn).catch(() => {});
    return chain;
  };
}

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

function parseScopeFromCustomId(customId) {
  // customId format: "setup:xxx:<guildId>:<userId>"
  const s = String(customId || "");
  const parts = s.split(":");
  if (parts.length < 4) return null;
  const userId = parts[parts.length - 1];
  const guildId = parts[parts.length - 2];
  if (!/^\d{15,25}$/.test(guildId) || !/^\d{15,25}$/.test(userId)) return null;
  return `${guildId}:${userId}`;
}

function isModalOpenButton(customId) {
  // ⚠️ IMPORTANT: si tu deferUpdate() avant showModal => interaction failed
  const s = String(customId || "");
  return (
    s.includes(":auto:pseudoMinute:") ||
    s.includes(":auto:checkAdd:") ||
    s.includes(":auto:rappelAdd:")
  );
}

function ensureGlobalSetupListener(client) {
  if (GLOBAL_SETUP_LISTENER_READY) return;
  if (!client?.on) return;
  GLOBAL_SETUP_LISTENER_READY = true;

  client.on("interactionCreate", async (i) => {
    try {
      if (!i?.inGuild?.()) return;

      const isComponent =
        i.isButton?.() ||
        i.isStringSelectMenu?.() ||
        i.isRoleSelectMenu?.() ||
        i.isChannelSelectMenu?.();

      const isModal = i.isModalSubmit?. && i.isModalSubmit();

      if (!isComponent && !isModal) return;

      const customId = String(i.customId || "");
      if (!customId.startsWith("setup:")) return;

      const scope = parseScopeFromCustomId(customId);
      if (!scope) return;

      const session = SETUP_SESSIONS.get(scope);
      if (!session) {
        // éviter un "interaction failed" côté user
        try {
          if (isComponent && !isModalOpenButton(customId) && !i.deferred && !i.replied) {
            await i.deferUpdate().catch(() => {});
          }
        } catch {}
        try {
          if (!i.replied && typeof i.reply === "function") {
            await i.reply({ content: "⚠️ Session /setup expirée. Relance /setup.", flags: MessageFlags.Ephemeral }).catch(() => {});
          }
        } catch {}
        return;
      }

      if (String(i.user?.id) !== String(session.userId)) return;
      if (String(i.guildId) !== String(session.guildId)) return;

      // ✅ ACK ASAP (sauf boutons qui ouvrent un modal)
      if (isComponent && !isModalOpenButton(customId)) {
        if (!i.deferred && !i.replied) await i.deferUpdate().catch(() => {});
      }

      await session.handle(i).catch(() => {});
    } catch {
      // silencieux
    }
  });
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

      const client = interaction.client;
      ensureGlobalSetupListener(client);

      const guild = interaction.guild;
      const guildId = guild.id;
      const saved = getGuildConfig(guildId) || {};

      if (!isStaff(interaction.member, saved)) {
        return interaction.reply({ content: `${ICON.no} Accès réservé au STAFF.`, flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      const legacyPostRoleIds = Array.isArray(saved.posts) ? saved.posts.map((p) => p?.roleId).filter(Boolean) : [];

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
          pseudo: { enabled: saved?.automations?.pseudo?.enabled !== false, minute: clampInt(saved?.automations?.pseudo?.minute, { fallback: 10 }) },
          checkDispo: { enabled: !!saved?.automations?.checkDispo?.enabled, times: normalizeTimes(saved?.automations?.checkDispo?.times) },
          rappel: { enabled: !!saved?.automations?.rappel?.enabled, times: normalizeTimes(saved?.automations?.rappel?.times) },
        },
      };

      const userId = interaction.user.id;
      const scope = `${guildId}:${userId}`;

      // kill previous session
      const prev = SETUP_SESSIONS.get(scope);
      if (prev) {
        try { await prev.end("replaced").catch(() => {}); } catch {}
      }

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

      // ---------- UI BUILD ----------
      const rowDispos = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(CID.dispos).setPlaceholder(`${ICON.dispos} Dispos`).setMinValues(0).setMaxValues(1).addChannelTypes(ChannelType.GuildText)
      );
      const rowStaffReports = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(CID.staffReports).setPlaceholder(`${ICON.staffReports} Staff`).setMinValues(0).setMaxValues(1).addChannelTypes(ChannelType.GuildText)
      );
      const rowPseudoScan = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(CID.pseudoScan).setPlaceholder(`${ICON.pseudoScan} Pseudos (opt)`).setMinValues(0).setMaxValues(1).addChannelTypes(ChannelType.GuildText)
      );

      const rowActions1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.save).setLabel(`${ICON.save} Save`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CID.reset).setLabel(`${ICON.reset} Reset`).setStyle(ButtonStyle.Secondary)
      );

      const rowRoleStaff = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.staff).setPlaceholder(`${ICON.staff} Rôles Staff (0..25)`).setMinValues(0).setMaxValues(25)
      );
      const rowRolePlayers = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.players).setPlaceholder(`${ICON.players} Rôles Joueurs (0..25)`).setMinValues(0).setMaxValues(25)
      );
      const rowRolePosts = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(CID.posts).setPlaceholder(`${ICON.postes} Rôles Postes (0..25)`).setMinValues(0).setMaxValues(25)
      );

      const rowAutoButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.autoGlobal).setLabel("Global").setStyle(draft.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.autoPseudo).setLabel("Pseudo").setStyle(draft.automations.pseudo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.pseudoMinute).setLabel(`${ICON.clock} Minute`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.autoCheck).setLabel("CheckDispo").setStyle(draft.automations.checkDispo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.autoRappel).setLabel("Rappel").setStyle(draft.automations.rappel.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      );

      const rowCancel = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.cancel).setLabel(`${ICON.cancel} Cancel`).setStyle(ButtonStyle.Danger)
      );

      const rowCheckDispoChannel = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(CID.checkDispo).setPlaceholder(`${ICON.checkDispo} Salon Check Dispo (opt)`).setMinValues(0).setMaxValues(1).addChannelTypes(ChannelType.GuildText)
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
          .addOptions(preset.map((t) => ({ label: t, value: t, default: (draft.automations.checkDispo.times || []).includes(t) })))
      );

      const rowTimesButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.checkAdd).setLabel(`${ICON.plus} Ajouter HH:MM (CheckDispo)`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.checkClear).setLabel(`${ICON.broom} Clear CheckDispo`).setStyle(ButtonStyle.Secondary)
      );

      const rowRappelTimesSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.rappelTimes)
          .setPlaceholder(`${ICON.rappel} Horaires Rappel (max 12)`)
          .setMinValues(0)
          .setMaxValues(Math.min(12, preset.length))
          .addOptions(preset.map((t) => ({ label: t, value: t, default: (draft.automations.rappel.times || []).includes(t) })))
      );

      const rowRappelButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.rappelAdd).setLabel(`${ICON.plus} Ajouter HH:MM (Rappel)`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.rappelClear).setLabel(`${ICON.broom} Clear Rappel`).setStyle(ButtonStyle.Secondary)
      );

      // defaults
      try {
        if (draft.disposChannelId) rowDispos.components[0].setDefaultChannels([draft.disposChannelId]);
        if (draft.staffReportsChannelId) rowStaffReports.components[0].setDefaultChannels([draft.staffReportsChannelId]);
        if (draft.pseudoScanChannelId) rowPseudoScan.components[0].setDefaultChannels([draft.pseudoScanChannelId]);
        if (draft.checkDispoChannelId) rowCheckDispoChannel.components[0].setDefaultChannels([draft.checkDispoChannelId]);

        if (draft.staffRoleIds.length) rowRoleStaff.components[0].setDefaultRoles(draft.staffRoleIds.slice(0, 25));
        if (draft.playerRoleIds.length) rowRolePlayers.components[0].setDefaultRoles(draft.playerRoleIds.slice(0, 25));
        if (draft.postRoleIds.length) rowRolePosts.components[0].setDefaultRoles(draft.postRoleIds.slice(0, 25));
      } catch {}

      // send 3 ephemerals
      await interaction.reply({
        embeds: [buildEmbed(guild, draft)],
        components: [rowDispos, rowStaffReports, rowPseudoScan, rowActions1],
        flags: MessageFlags.Ephemeral,
      });

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
        rowAutoButtons.components[0].setStyle(draft.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
        rowAutoButtons.components[1].setStyle(draft.automations.pseudo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
        rowAutoButtons.components[3].setStyle(draft.automations.checkDispo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
        rowAutoButtons.components[4].setStyle(draft.automations.rappel.enabled ? ButtonStyle.Success : ButtonStyle.Secondary);

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

        await interaction.editReply({
          embeds: [buildEmbed(guild, draft)],
          components: [rowDispos, rowStaffReports, rowPseudoScan, rowActions1],
        }).catch(() => {});

        await msg2.edit({
          content: "🧩 Rôles / 📌 Postes / 🤖 Automations",
          components: [rowRoleStaff, rowRolePlayers, rowRolePosts, rowAutoButtons, rowCancel],
        }).catch(() => {});

        await msg3.edit({
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
        }).catch(() => {});
      };

      const refresh = createRefreshQueue(doRefresh);
      function buildPseudoMinuteModal() {
        const modal = new ModalBuilder().setCustomId(CID.modalPseudoMinute).setTitle("Pseudo — minute (0-59)");
        const input = new TextInputBuilder()
          .setCustomId("minute")
          .setLabel("Minute (0-59)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("ex: 10")
          .setValue(String(clampInt(draft.automations?.pseudo?.minute, { fallback: 10 })));
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return modal;
      }

      function buildAddTimeModal(customId, title, placeholder) {
        const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
        const input = new TextInputBuilder()
          .setCustomId("time")
          .setLabel("Horaire (HH:MM)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder(placeholder);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return modal;
      }

      let ended = false;

      async function end(reason = "end") {
        if (ended) return;
        ended = true;

        SETUP_SESSIONS.delete(scope);

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

        try { await interaction.editReply({ content: ICON.time, embeds: [buildEmbed(guild, draft)], components: disabled1 }); } catch {}
        try { await msg2.edit({ content: ICON.time, components: disabled2 }); } catch {}
        try { await msg3.edit({ content: ICON.time, components: disabled3 }); } catch {}
      }

      const t = setTimeout(() => end("timeout").catch(() => {}), 10 * 60 * 1000);
      t.unref?.();

      async function handle(i) {
        // ---- MODALS ----
        if (i.isModalSubmit?.()) {
          if (i.customId === CID.modalPseudoMinute) {
            const minute = clampInt(i.fields.getTextInputValue("minute"), { fallback: 10 });
            draft.automations.pseudo.minute = minute;
            await i.reply({ content: `✅ Minute pseudo: \`${minute}\``, flags: MessageFlags.Ephemeral }).catch(() => {});
            return refresh();
          }

          if (i.customId === CID.modalAddTime) {
            const t1 = normalizeTimeStr(i.fields.getTextInputValue("time"));
            if (!t1) {
              await i.reply({ content: "⚠️ Format invalide. Attendu: `HH:MM` (ex: 21:10).", flags: MessageFlags.Ephemeral }).catch(() => {});
              return;
            }
            draft.automations.checkDispo.times = normalizeTimes([...(draft.automations.checkDispo.times || []), t1], { max: 12 });
            await i.reply({ content: `✅ Horaire ajouté (CheckDispo): \`${t1}\``, flags: MessageFlags.Ephemeral }).catch(() => {});
            return refresh();
          }

          if (i.customId === CID.modalAddRappelTime) {
            const t2 = normalizeTimeStr(i.fields.getTextInputValue("time"));
            if (!t2) {
              await i.reply({ content: "⚠️ Format invalide. Attendu: `HH:MM` (ex: 20:45).", flags: MessageFlags.Ephemeral }).catch(() => {});
              return;
            }
            draft.automations.rappel.times = normalizeTimes([...(draft.automations.rappel.times || []), t2], { max: 12 });
            await i.reply({ content: `✅ Horaire ajouté (Rappel): \`${t2}\``, flags: MessageFlags.Ephemeral }).catch(() => {});
            return refresh();
          }

          return;
        }

        // ---- MENUS ----
        if (i.isChannelSelectMenu?.()) {
          const v = i.values?.[0] || null;
          if (i.customId === CID.dispos) draft.disposChannelId = v;
          if (i.customId === CID.staffReports) draft.staffReportsChannelId = v;
          if (i.customId === CID.pseudoScan) draft.pseudoScanChannelId = v;
          if (i.customId === CID.checkDispo) draft.checkDispoChannelId = v;
          return refresh();
        }

        if (i.isRoleSelectMenu?.()) {
          if (i.customId === CID.staff) draft.staffRoleIds = uniqIds(i.values, 25);
          if (i.customId === CID.players) draft.playerRoleIds = uniqIds(i.values, 25);
          if (i.customId === CID.posts) draft.postRoleIds = uniqIds(i.values, 25);
          return refresh();
        }

        if (i.isStringSelectMenu?.()) {
          if (i.customId === CID.checkTimes) {
            draft.automations.checkDispo.times = normalizeTimes(i.values, { max: 12 });
            return refresh();
          }
          if (i.customId === CID.rappelTimes) {
            draft.automations.rappel.times = normalizeTimes(i.values, { max: 12 });
            return refresh();
          }
          return;
        }

        if (!i.isButton?.()) return;

        // ---- OPEN MODALS (IMPORTANT: listener global n'a PAS deferUpdate pour ces boutons) ----
        if (i.customId === CID.pseudoMinute) {
          return i.showModal(buildPseudoMinuteModal()).catch(() => {});
        }
        if (i.customId === CID.checkAdd) {
          return i.showModal(buildAddTimeModal(CID.modalAddTime, "CheckDispo — ajouter HH:MM", "ex: 21:10")).catch(() => {});
        }
        if (i.customId === CID.rappelAdd) {
          return i.showModal(buildAddTimeModal(CID.modalAddRappelTime, "Rappel — ajouter HH:MM", "ex: 20:45")).catch(() => {});
        }

        // ---- BUTTONS ----
        const day = DAYS.find((d) => i.customId === CID.msg(d));
        if (day) {
          await i.followUp({ content: `Envoie l’ID du message pour **${day}** (15-25 chiffres). Timeout: 60s.`, flags: MessageFlags.Ephemeral }).catch(() => {});
          const textChannel = interaction.channel;
          if (!textChannel) return;

          const filter = (m) => m.author?.id === userId;
          const collected = await textChannel.awaitMessages({ filter, max: 1, time: 60_000 }).catch(() => null);
          const m = collected?.first?.() || null;

          if (!m) {
            await i.followUp({ content: "⚠️ Timeout. Re-clique sur le bouton du jour.", flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
          }

          const id = String(m.content || "").trim();
          try { await m.delete().catch(() => {}); } catch {}

          if (!isSnowflake(id)) {
            await i.followUp({ content: "⚠️ ID invalide. Re-clique et envoie un ID valide.", flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
          }

          const idx = DAY_INDEX[day];
          const next = normalizeDispoMessageIds(draft.dispoMessageIds);
          next[idx] = id;
          draft.dispoMessageIds = next;

          return refresh();
        }

        if (i.customId === CID.msgClear) {
          draft.dispoMessageIds = new Array(7).fill(null);
          return refresh();
        }

        if (i.customId === CID.autoGlobal) {
          draft.automations.enabled = !draft.automations.enabled;
          return refresh();
        }
        if (i.customId === CID.autoPseudo) {
          draft.automations.pseudo.enabled = !draft.automations.pseudo.enabled;
          return refresh();
        }
        if (i.customId === CID.autoCheck) {
          draft.automations.checkDispo.enabled = !draft.automations.checkDispo.enabled;
          return refresh();
        }
        if (i.customId === CID.autoRappel) {
          draft.automations.rappel.enabled = !draft.automations.rappel.enabled;
          return refresh();
        }

        if (i.customId === CID.checkClear) {
          draft.automations.checkDispo.times = [];
          return refresh();
        }
        if (i.customId === CID.rappelClear) {
          draft.automations.rappel.times = [];
          return refresh();
        }

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
          return refresh();
        }

        if (i.customId === CID.save) {
          const requiredOk =
            !!draft.disposChannelId &&
            !!draft.staffReportsChannelId &&
            (draft.staffRoleIds || []).length > 0 &&
            (draft.playerRoleIds || []).length > 0;

          if (!requiredOk) {
            await i.followUp({ content: ICON.warn, flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
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
              pseudo: { enabled: !!draft.automations.pseudo.enabled, minute: clampInt(draft.automations.pseudo.minute, { fallback: 10 }) },
              checkDispo: { enabled: !!draft.automations.checkDispo.enabled, times: normalizeTimes(draft.automations.checkDispo.times) },
              rappel: { enabled: !!draft.automations.rappel.enabled, times: normalizeTimes(draft.automations.rappel.times) },
            },

            setupBy: userId,
            setupAt: new Date().toISOString(),
          });

          try {
            await interaction.editReply({ content: `${ICON.save} Saved`, embeds: [buildEmbed(guild, draft)], components: [] }).catch(() => {});
            await msg2.edit({ content: `${ICON.save} Saved`, components: [] }).catch(() => {});
            await msg3.edit({ content: `${ICON.save} Saved`, components: [] }).catch(() => {});
          } catch {}

          return end("saved");
        }

        if (i.customId === CID.cancel) {
          try {
            await interaction.editReply({ content: `${ICON.cancel} Cancel`, embeds: [], components: [] }).catch(() => {});
            await msg2.edit({ content: `${ICON.cancel} Cancel`, components: [] }).catch(() => {});
            await msg3.edit({ content: `${ICON.cancel} Cancel`, components: [] }).catch(() => {});
          } catch {}
          return end("cancel");
        }
      }

      // register session
      SETUP_SESSIONS.set(scope, { guildId, userId, handle, end });

      // initial paint
      refresh().catch(() => {});
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
