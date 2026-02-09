// src/commands/setup.js
// Setup V3 STABLE FIX — 1 message — multi-serveur — STAFF ONLY — GLOBAL LISTENER
// - 1 seul ephemeral + pages (select menu)
// - IDs Lun..Dim via 2 modals (limite Discord: 5 inputs/modal)
// - Page Automations <= 5 action rows (sinon Discord refuse) ✅
// - Boutons ouvrant un modal : PAS de deferUpdate() (sinon showModal échoue) ✅
// - Horaires automations via presets (select multi) ✅
// - Save = confirmation obligatoire (taper "CONFIRMER") ✅
// + BotLabel + BotIconUrl configurables (page Bot) ✅
// ✅ FIX: pas de troncature d’URL (512) + clamp dédié label (64)
// ✅ FIX: defaults select menus robustes (pas de instanceof Builder)
// ✅ FIX: validation URL image + rejet discord.com/channels/... (pas une image)
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
  broom: "🧹",
  preview: "📄",
  confirm: "✅",
  bot: "🤖",
  image: "🖼️",
  edit: "✏️",
};

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAY_INDEX = { Lun: 0, Mar: 1, Mer: 2, Jeu: 3, Ven: 4, Sam: 5, Dim: 6 };

// presets (24 options) — 00:00 -> 23:00 (select max 12 valeurs)
const PRESET_TIMES = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

const DEFAULT_BOT_LABEL = "XIG Bot";

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

function createRefreshQueue(fn) {
  let chain = Promise.resolve();
  return () => {
    chain = chain.then(fn).catch(() => {});
    return chain;
  };
}

function parseScopeFromCustomId(customId) {
  const s = String(customId || "");
  const parts = s.split(":");
  if (parts.length < 4) return null;
  const userId = parts[parts.length - 1];
  const guildId = parts[parts.length - 2];
  if (!/^\d{15,25}$/.test(guildId) || !/^\d{15,25}$/.test(userId)) return null;
  return `${guildId}:${userId}`;
}

// --------------------
// clamp séparé label (64) / url (512)
// --------------------
function clampLabel(s, { fallback = DEFAULT_BOT_LABEL } = {}) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return fallback;
  return t.slice(0, 64);
}

function clampUrlText(s) {
  const t = String(s ?? "").trim();
  return t ? t.slice(0, 512) : "";
}

/**
 * Normalise URL image:
 * - doit être http(s)
 * - rejette les liens "discord.com/channels/..." (pas une image)
 * - accepte cdn.discordapp.com / media.discordapp.net / n’importe quel host http(s)
 */
function normalizeUrlOrNull(s) {
  const t = clampUrlText(s);
  if (!t) return null;
  if (!/^https?:\/\/\S+/i.test(t)) return null;
  if (/^https?:\/\/(www\.)?discord\.com\/channels\//i.test(t)) return null; // pas une image
  return t;
}

// boutons qui ouvrent un modal => pas de deferUpdate
function isModalOpenButtonCustomId(customId) {
  const s = String(customId || "");
  return (
    s.includes("setup:modal:") ||
    s.includes("setup:btn:confirmSave:") ||
    s.includes("setup:btn:openMinute:") ||
    s.includes("setup:btn:idsA:") ||
    s.includes("setup:btn:idsB:") ||
    s.includes("setup:btn:botInfo:")
  );
}

function buildEmbed(guild, draft, { page = "channels", dirty = false } = {}) {
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

  const pageLabel =
    page === "channels" ? "Salons" :
    page === "roles" ? "Rôles" :
    page === "ids" ? "CheckDispo / IDs" :
    page === "automations" ? "Automations" :
    "Bot";

  const statusLine = requiredOk ? `${ICON.ok} OK` : `${ICON.warn} Incomplet`;
  const dirtyLine = dirty ? `\n${ICON.warn} Modifs non sauvegardées (CONFIRMER requis)` : "";

  const botLabel = clampLabel(draft.botLabel, { fallback: DEFAULT_BOT_LABEL });
  const botIconUrl = normalizeUrlOrNull(draft.botIconUrl);

  const emb = new EmbedBuilder()
    .setTitle(`${ICON.title} Setup — ${guild.name}`)
    .setColor(0x5865f2)
    .setDescription(
      [
        `${statusLine} — Page: **${pageLabel}**${dirtyLine}`,
        "",
        "Requis : 📅 Dispos + 📊 Staff + 🛡️ (≥1 rôle staff) + 👟 (≥1 rôle joueur)",
        "Save = **uniquement** après confirmation (bouton + taper `CONFIRMER`).",
      ].join("\n")
    )
    .addFields(
      {
        name: `${ICON.bot} Bot`,
        value: [
          `${ICON.bot} Nom: **${botLabel}**`,
          `${ICON.image} Image: ${botIconUrl ? `\`${botIconUrl}\`` : "—"}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Salons",
        value: [
          `${ICON.dispos} ${fmtCh(draft.disposChannelId)} — Dispos`,
          `${ICON.staffReports} ${fmtCh(draft.staffReportsChannelId)} — Staff`,
          `${ICON.pseudoScan} ${fmtCh(draft.pseudoScanChannelId)} — Pseudos (opt)`,
          `${ICON.checkDispo} ${fmtCh(draft.checkDispoChannelId)} — CheckDispo (opt)`,
        ].join("\n"),
      },
      {
        name: "Rôles",
        value: [
          `${ICON.staff} ${fmtRoles(draft.staffRoleIds)} — Staff`,
          `${ICON.players} ${fmtRoles(draft.playerRoleIds)} — Joueurs (filtres)`,
          `${ICON.postes} ${fmtRoles(draft.postRoleIds)} — Postes (/pseudo)`,
        ].join("\n"),
      },
      { name: `${ICON.msg} IDs messages (Lun..Dim)`, value: fmtMsgIds(draft.dispoMessageIds) },
      {
        name: "Automations",
        value: [
          `Global: **${globalOn ? "ON" : "OFF"}**`,
          `Pseudo: **${pseudoOn ? "ON" : "OFF"}** — minute: \`${pseudoMin}\``,
          `CheckDispo: **${cdOn ? "ON" : "OFF"}** — ${fmtTimes(cdTimes)}`,
          `${ICON.rappel} Rappel: **${rpOn ? "ON" : "OFF"}** — ${fmtTimes(rpTimes)}`,
        ].join("\n"),
      }
    )
    .setFooter({ text: botLabel });

  if (botIconUrl) {
    try { emb.setThumbnail(botIconUrl); } catch {}
  }

  return emb;
}

// --------------------
// Sessions + global listener
// --------------------
const SETUP_SESSIONS = new Map(); // key: "<guildId>:<userId>"
let GLOBAL_SETUP_LISTENER_READY = false;

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

      const isModal = typeof i.isModalSubmit === "function" && i.isModalSubmit();
      if (!isComponent && !isModal) return;

      const customId = String(i.customId || "");
      if (!customId.startsWith("setup:")) return;

      const scope = parseScopeFromCustomId(customId);
      if (!scope) return;

      const session = SETUP_SESSIONS.get(scope);
      if (!session) {
        // session expirée => éviter "interaction failed"
        try {
          if (isComponent && !i.deferred && !i.replied) await i.deferUpdate().catch(() => {});
        } catch {}
        try {
          if (!i.replied && !i.deferred) {
            await i.reply({ content: "⚠️ Session /setup expirée. Relance /setup.", flags: MessageFlags.Ephemeral }).catch(() => {});
          } else {
            await i.followUp({ content: "⚠️ Session /setup expirée. Relance /setup.", flags: MessageFlags.Ephemeral }).catch(() => {});
          }
        } catch {}
        return;
      }

      if (String(i.user?.id) !== String(session.userId)) return;
      if (String(i.guildId) !== String(session.guildId)) return;

      // ACK ASAP (sauf boutons qui ouvrent un modal)
      if (isComponent && !isModalOpenButtonCustomId(customId)) {
        if (!i.deferred && !i.replied) await i.deferUpdate().catch(() => {});
      }

      await session.handle(i).catch(() => {});
    } catch {
      // silencieux
    }
  });
}

// ---------- Modals builders ----------
function buildPseudoMinuteModal(customId, curMinute) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle("Pseudo — minute (0-59)");
  const input = new TextInputBuilder()
    .setCustomId("minute")
    .setLabel("Minute (0-59)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("ex: 10")
    .setValue(String(clampInt(curMinute, { fallback: 10 })));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildIdsModalA(customId, ids) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle("IDs Dispo — Lun à Ven");
  const fields = ["Lun", "Mar", "Mer", "Jeu", "Ven"].map((d) => {
    const idx = DAY_INDEX[d];
    return new TextInputBuilder()
      .setCustomId(d)
      .setLabel(`${d} (ID message)`)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder("15-25 chiffres (vide = aucun)")
      .setValue(ids[idx] ? String(ids[idx]) : "");
  });
  modal.addComponents(...fields.map((f) => new ActionRowBuilder().addComponents(f)));
  return modal;
}

function buildIdsModalB(customId, ids) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle("IDs Dispo — Sam à Dim");
  const fields = ["Sam", "Dim"].map((d) => {
    const idx = DAY_INDEX[d];
    return new TextInputBuilder()
      .setCustomId(d)
      .setLabel(`${d} (ID message)`)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder("15-25 chiffres (vide = aucun)")
      .setValue(ids[idx] ? String(ids[idx]) : "");
  });
  modal.addComponents(...fields.map((f) => new ActionRowBuilder().addComponents(f)));
  return modal;
}

function buildConfirmSaveModal(customId) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle("CONFIRMATION — Save");
  const input = new TextInputBuilder()
    .setCustomId("confirm")
    .setLabel('Tape "CONFIRMER" pour sauvegarder')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("CONFIRMER");
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildBotInfoModal(customId, { botLabel, botIconUrl }) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle("Bot — Nom + Image");

  const name = new TextInputBuilder()
    .setCustomId("botLabel")
    .setLabel("Nom du bot (1-64)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder(DEFAULT_BOT_LABEL)
    .setValue(clampLabel(botLabel, { fallback: DEFAULT_BOT_LABEL }));

  const icon = new TextInputBuilder()
    .setCustomId("botIconUrl")
    .setLabel("URL image (https://...) — optionnel")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("https://cdn.discordapp.com/...png")
    .setValue(clampUrlText(botIconUrl || ""));

  modal.addComponents(new ActionRowBuilder().addComponents(name), new ActionRowBuilder().addComponents(icon));
  return modal;
}

// --------------------
// Exports
// --------------------
module.exports.ensureGlobalSetupListener = ensureGlobalSetupListener;

module.exports.data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Configurer bot + salons + rôles + IDs check dispo + automations.")
  .setDefaultMemberPermissions(0n);

module.exports.execute = async function execute(interaction) {
  try {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: ICON.no, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    ensureGlobalSetupListener(interaction.client);

    const guild = interaction.guild;
    const guildId = guild.id;

    const saved = getGuildConfig(guildId) || {};
    if (!isStaff(interaction.member, saved)) {
      return interaction.reply({ content: `${ICON.no} Accès réservé au STAFF.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const legacyPostRoleIds = Array.isArray(saved.posts) ? saved.posts.map((p) => p?.roleId).filter(Boolean) : [];

    const draft = {
      botLabel: clampLabel(saved.botLabel, { fallback: DEFAULT_BOT_LABEL }),
      botIconUrl: saved.botIconUrl ? String(saved.botIconUrl) : null,

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

    const userId = interaction.user.id;
    const scope = `${guildId}:${userId}`;

    // kill old session
    const prev = SETUP_SESSIONS.get(scope);
    if (prev) {
      try { await prev.end("replaced").catch(() => {}); } catch {}
    }

    const CID = {
      page: `setup:page:${scope}`,

      botInfoBtn: `setup:btn:botInfo:${scope}`,
      botInfoModal: `setup:modal:botInfo:${scope}`,

      dispos: `setup:ch:dispos:${scope}`,
      staffReports: `setup:ch:staff:${scope}`,
      pseudoScan: `setup:ch:pseudoScan:${scope}`,
      checkDispo: `setup:ch:checkDispo:${scope}`,

      staff: `setup:role:staff:${scope}`,
      players: `setup:role:players:${scope}`,
      posts: `setup:role:posts:${scope}`,

      idsAButton: `setup:btn:idsA:${scope}`,
      idsBButton: `setup:btn:idsB:${scope}`,
      idsClear: `setup:btn:idsClear:${scope}`,
      idsAModal: `setup:modal:idsA:${scope}`,
      idsBModal: `setup:modal:idsB:${scope}`,

      autoTab: `setup:auto:tab:${scope}`,
      autoGlobal: `setup:btn:autoGlobal:${scope}`,
      autoPseudo: `setup:btn:autoPseudo:${scope}`,
      autoCheck: `setup:btn:autoCheck:${scope}`,
      autoRappel: `setup:btn:autoRappel:${scope}`,

      pseudoMinuteBtn: `setup:btn:openMinute:${scope}`,
      pseudoMinuteModal: `setup:modal:pseudoMinute:${scope}`,

      checkTimes: `setup:sel:checkTimes:${scope}`,
      rappelTimes: `setup:sel:rappelTimes:${scope}`,

      clearTabTimes: `setup:btn:clearTabTimes:${scope}`,

      preview: `setup:btn:preview:${scope}`,
      confirmSaveBtn: `setup:btn:confirmSave:${scope}`,
      confirmSaveModal: `setup:modal:confirmSave:${scope}`,
      reset: `setup:btn:reset:${scope}`,
      cancel: `setup:btn:cancel:${scope}`,
    };

    let page = "bot";       // bot | channels | roles | ids | automations
    let autoTab = "check";  // check | rappel
    let dirty = false;

    const preset = PRESET_TIMES.map(normalizeTimeStr).filter(Boolean);

    const markDirty = () => { dirty = true; };

    function rowPageSelect() {
      return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.page)
          .setPlaceholder("Choisir une page")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            { label: "Bot", value: "bot", default: page === "bot" },
            { label: "Salons", value: "channels", default: page === "channels" },
            { label: "Rôles", value: "roles", default: page === "roles" },
            { label: "CheckDispo / IDs", value: "ids", default: page === "ids" },
            { label: "Automations", value: "automations", default: page === "automations" }
          )
      );
    }

    function rowActions() {
      if (page === "automations") {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CID.pseudoMinuteBtn).setLabel(`${ICON.clock} Minute`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(CID.clearTabTimes).setLabel(`${ICON.broom} Clear horaires`).setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(CID.confirmSaveBtn).setLabel(`${ICON.confirm} Confirmer`).setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(CID.reset).setLabel(`${ICON.reset} Reset`).setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(CID.cancel).setLabel(`${ICON.cancel} Annuler`).setStyle(ButtonStyle.Danger)
        );
      }

      return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.preview).setLabel(`${ICON.preview} Aperçu`).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.confirmSaveBtn).setLabel(`${ICON.confirm} Confirmer Save`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CID.reset).setLabel(`${ICON.reset} Reset`).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.cancel).setLabel(`${ICON.cancel} Annuler`).setStyle(ButtonStyle.Danger)
      );
    }

    function componentsForPage() {
      const rows = [rowPageSelect()];

      if (page === "bot") {
        rows.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(CID.botInfoBtn).setLabel(`${ICON.edit} Nom + Image`).setStyle(ButtonStyle.Primary)
          )
        );
      }

      if (page === "channels") {
        rows.push(
          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(CID.dispos)
              .setPlaceholder(`${ICON.dispos} Salon Dispos (requis)`)
              .setMinValues(0).setMaxValues(1)
              .addChannelTypes(ChannelType.GuildText)
          ),
          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(CID.staffReports)
              .setPlaceholder(`${ICON.staffReports} Salon Staff (requis)`)
              .setMinValues(0).setMaxValues(1)
              .addChannelTypes(ChannelType.GuildText)
          ),
          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(CID.pseudoScan)
              .setPlaceholder(`${ICON.pseudoScan} Salon Pseudos (opt)`)
              .setMinValues(0).setMaxValues(1)
              .addChannelTypes(ChannelType.GuildText)
          )
        );
      }

      if (page === "roles") {
        rows.push(
          new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId(CID.staff).setPlaceholder(`${ICON.staff} Rôles Staff (>=1 requis)`).setMinValues(0).setMaxValues(25)
          ),
          new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId(CID.players).setPlaceholder(`${ICON.players} Rôles Joueurs (>=1 requis)`).setMinValues(0).setMaxValues(25)
          ),
          new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId(CID.posts).setPlaceholder(`${ICON.postes} Rôles Postes (0..25)`).setMinValues(0).setMaxValues(25)
          )
        );
      }

      if (page === "ids") {
        rows.push(
          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(CID.checkDispo)
              .setPlaceholder(`${ICON.checkDispo} Salon CheckDispo (opt)`)
              .setMinValues(0).setMaxValues(1)
              .addChannelTypes(ChannelType.GuildText)
          ),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(CID.idsAButton).setLabel(`${ICON.msg} IDs Lun→Ven`).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(CID.idsBButton).setLabel(`${ICON.msg} IDs Sam→Dim`).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(CID.idsClear).setLabel(`${ICON.broom} Clear IDs`).setStyle(ButtonStyle.Secondary)
          )
        );
      }

      if (page === "automations") {
        // ⚠️ total rows <= 5 (row0 page + row1 toggles + row2 tab + row3 select + row4 actions)
        rows.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(CID.autoGlobal).setLabel("Global").setStyle(draft.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(CID.autoPseudo).setLabel("Pseudo").setStyle(draft.automations.pseudo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(CID.autoCheck).setLabel("CheckDispo").setStyle(draft.automations.checkDispo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(CID.autoRappel).setLabel("Rappel").setStyle(draft.automations.rappel.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
          ),
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(CID.autoTab)
              .setPlaceholder("Configurer horaires…")
              .setMinValues(1).setMaxValues(1)
              .addOptions(
                { label: "Horaires CheckDispo", value: "check", default: autoTab === "check" },
                { label: "Horaires Rappel", value: "rappel", default: autoTab === "rappel" }
              )
          ),
          autoTab === "check"
            ? new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId(CID.checkTimes)
                  .setPlaceholder(`${ICON.times} Horaires CheckDispo (max 12)`)
                  .setMinValues(0)
                  .setMaxValues(12)
                  .addOptions(
                    preset.map((t) => ({
                      label: t,
                      value: t,
                      default: (draft.automations.checkDispo.times || []).includes(t),
                    }))
                  )
              )
            : new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId(CID.rappelTimes)
                  .setPlaceholder(`${ICON.rappel} Horaires Rappel (max 12)`)
                  .setMinValues(0)
                  .setMaxValues(12)
                  .addOptions(
                    preset.map((t) => ({
                      label: t,
                      value: t,
                      default: (draft.automations.rappel.times || []).includes(t),
                    }))
                  )
              )
        );
      }

      rows.push(rowActions());
      return rows;
    }

    /**
     * ✅ Defaults robustes:
     * - on ne dépend PAS de instanceof Builder (fragile suivant versions)
     * - on teste la présence de méthodes setDefaultChannels / setDefaultRoles
     */
    function applyDefaultsToRows(rows) {
      try {
        for (const row of rows) {
          for (const c of row.components || []) {
            const cid = c?.data?.custom_id;

            if (typeof c?.setDefaultChannels === "function") {
              if (cid === CID.dispos) c.setDefaultChannels(draft.disposChannelId ? [draft.disposChannelId] : []);
              if (cid === CID.staffReports) c.setDefaultChannels(draft.staffReportsChannelId ? [draft.staffReportsChannelId] : []);
              if (cid === CID.pseudoScan) c.setDefaultChannels(draft.pseudoScanChannelId ? [draft.pseudoScanChannelId] : []);
              if (cid === CID.checkDispo) c.setDefaultChannels(draft.checkDispoChannelId ? [draft.checkDispoChannelId] : []);
            }

            if (typeof c?.setDefaultRoles === "function") {
              if (cid === CID.staff) c.setDefaultRoles((draft.staffRoleIds || []).slice(0, 25));
              if (cid === CID.players) c.setDefaultRoles((draft.playerRoleIds || []).slice(0, 25));
              if (cid === CID.posts) c.setDefaultRoles((draft.postRoleIds || []).slice(0, 25));
            }
          }
        }
      } catch {}
    }

    await interaction.reply({
      embeds: [buildEmbed(guild, draft, { page, dirty })],
      components: (() => {
        const rows = componentsForPage();
        applyDefaultsToRows(rows);
        return rows;
      })(),
      flags: MessageFlags.Ephemeral,
    });

    const doRefresh = async () => {
      const rows = componentsForPage();
      applyDefaultsToRows(rows);
      await interaction.editReply({
        embeds: [buildEmbed(guild, draft, { page, dirty })],
        components: rows,
      }).catch(() => {});
    };

    const refresh = createRefreshQueue(doRefresh);

    let ended = false;
    async function end() {
      if (ended) return;
      ended = true;
      SETUP_SESSIONS.delete(scope);
      try {
        await interaction.editReply({
          content: ICON.time,
          embeds: [buildEmbed(guild, draft, { page, dirty })],
          components: [],
        }).catch(() => {});
      } catch {}
    }

    const timeout = setTimeout(() => end().catch(() => {}), 10 * 60 * 1000);
    timeout.unref?.();

    async function handle(i) {
      // MODALS
      if (i.isModalSubmit?.()) {
        if (i.customId === CID.botInfoModal) {
          const name = clampLabel(i.fields.getTextInputValue("botLabel"), { fallback: DEFAULT_BOT_LABEL });
          const iconRaw = clampUrlText(i.fields.getTextInputValue("botIconUrl"));
          const icon = iconRaw ? normalizeUrlOrNull(iconRaw) : null;

          if (iconRaw && !icon) {
            await i.reply({
              content: `⚠️ URL invalide. Mets une URL http(s) d’image (évite \`discord.com/channels/...\`) ou laisse vide.`,
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
          }

          draft.botLabel = name;
          draft.botIconUrl = icon;
          markDirty();
          await i.reply({ content: `✅ Bot mis à jour: **${name}**`, flags: MessageFlags.Ephemeral }).catch(() => {});
          return refresh();
        }

        if (i.customId === CID.pseudoMinuteModal) {
          const minute = clampInt(i.fields.getTextInputValue("minute"), { fallback: 10 });
          draft.automations.pseudo.minute = minute;
          markDirty();
          await i.reply({ content: `✅ Minute pseudo: \`${minute}\``, flags: MessageFlags.Ephemeral }).catch(() => {});
          return refresh();
        }

        if (i.customId === CID.idsAModal) {
          const next = normalizeDispoMessageIds(draft.dispoMessageIds);
          for (const d of ["Lun", "Mar", "Mer", "Jeu", "Ven"]) {
            const raw = String(i.fields.getTextInputValue(d) || "").trim();
            const idx = DAY_INDEX[d];
            next[idx] = raw ? (isSnowflake(raw) ? raw : null) : null;
          }
          draft.dispoMessageIds = next;
          markDirty();
          await i.reply({ content: "✅ IDs Lun→Ven mis à jour.", flags: MessageFlags.Ephemeral }).catch(() => {});
          return refresh();
        }

        if (i.customId === CID.idsBModal) {
          const next = normalizeDispoMessageIds(draft.dispoMessageIds);
          for (const d of ["Sam", "Dim"]) {
            const raw = String(i.fields.getTextInputValue(d) || "").trim();
            const idx = DAY_INDEX[d];
            next[idx] = raw ? (isSnowflake(raw) ? raw : null) : null;
          }
          draft.dispoMessageIds = next;
          markDirty();
          await i.reply({ content: "✅ IDs Sam→Dim mis à jour.", flags: MessageFlags.Ephemeral }).catch(() => {});
          return refresh();
        }

        if (i.customId === CID.confirmSaveModal) {
          const txt = String(i.fields.getTextInputValue("confirm") || "").trim().toUpperCase();
          if (txt !== "CONFIRMER") {
            await i.reply({ content: "⚠️ Confirmation refusée. Tape exactement: `CONFIRMER`.", flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
          }

          const requiredOk =
            !!draft.disposChannelId &&
            !!draft.staffReportsChannelId &&
            (draft.staffRoleIds || []).length > 0 &&
            (draft.playerRoleIds || []).length > 0;

          if (!requiredOk) {
            await i.reply({ content: "⚠️ Setup incomplet (requis manquants).", flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
          }

          const legacyPosts = (draft.postRoleIds || []).map((roleId) => ({ roleId: String(roleId), label: "POSTE" }));

          upsertGuildConfig(guildId, {
            botLabel: clampLabel(draft.botLabel, { fallback: DEFAULT_BOT_LABEL }),
            botIconUrl: normalizeUrlOrNull(draft.botIconUrl),

            disposChannelId: draft.disposChannelId,
            staffReportsChannelId: draft.staffReportsChannelId,
            pseudoScanChannelId: draft.pseudoScanChannelId,
            checkDispoChannelId: draft.checkDispoChannelId,

            dispoMessageIds: normalizeDispoMessageIds(draft.dispoMessageIds),

            staffRoleIds: uniqIds(draft.staffRoleIds, 25),
            playerRoleIds: uniqIds(draft.playerRoleIds, 25),
            postRoleIds: uniqIds(draft.postRoleIds, 25),

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

            setupBy: userId,
            setupAt: new Date().toISOString(),
          });

          dirty = false;
          await i.reply({ content: `${ICON.save} Sauvegardé.`, flags: MessageFlags.Ephemeral }).catch(() => {});
          return end();
        }

        return;
      }

      // PAGE SELECT
      if (i.isStringSelectMenu?.() && i.customId === CID.page) {
        const v = i.values?.[0];
        if (v === "bot" || v === "channels" || v === "roles" || v === "ids" || v === "automations") {
          page = v;
          return refresh();
        }
        return;
      }

      // CHANNEL SELECTS
      if (i.isChannelSelectMenu?.()) {
        const v = i.values?.[0] || null;
        if (i.customId === CID.dispos) draft.disposChannelId = v;
        if (i.customId === CID.staffReports) draft.staffReportsChannelId = v;
        if (i.customId === CID.pseudoScan) draft.pseudoScanChannelId = v;
        if (i.customId === CID.checkDispo) draft.checkDispoChannelId = v;
        markDirty();
        return refresh();
      }

      // ROLE SELECTS
      if (i.isRoleSelectMenu?.()) {
        if (i.customId === CID.staff) draft.staffRoleIds = uniqIds(i.values, 25);
        if (i.customId === CID.players) draft.playerRoleIds = uniqIds(i.values, 25);
        if (i.customId === CID.posts) draft.postRoleIds = uniqIds(i.values, 25);
        markDirty();
        return refresh();
      }

      // STRING SELECTS (automations)
      if (i.isStringSelectMenu?.()) {
        if (i.customId === CID.autoTab) {
          const v = i.values?.[0];
          if (v === "check" || v === "rappel") autoTab = v;
          return refresh();
        }
        if (i.customId === CID.checkTimes) {
          draft.automations.checkDispo.times = normalizeTimes(i.values, { max: 12 });
          markDirty();
          return refresh();
        }
        if (i.customId === CID.rappelTimes) {
          draft.automations.rappel.times = normalizeTimes(i.values, { max: 12 });
          markDirty();
          return refresh();
        }
      }

      // BUTTONS
      if (!i.isButton?.()) return;

      if (i.customId === CID.preview) return refresh();

      if (i.customId === CID.botInfoBtn) {
        return i.showModal(buildBotInfoModal(CID.botInfoModal, { botLabel: draft.botLabel, botIconUrl: draft.botIconUrl })).catch(() => {});
      }

      if (i.customId === CID.confirmSaveBtn) {
        return i.showModal(buildConfirmSaveModal(CID.confirmSaveModal)).catch(() => {});
      }

      if (i.customId === CID.reset) {
        draft.botLabel = DEFAULT_BOT_LABEL;
        draft.botIconUrl = null;

        draft.disposChannelId = null;
        draft.staffReportsChannelId = null;
        draft.pseudoScanChannelId = null;
        draft.checkDispoChannelId = null;

        draft.staffRoleIds = [];
        draft.playerRoleIds = [];
        draft.postRoleIds = [];

        draft.dispoMessageIds = new Array(7).fill(null);

        draft.automations = {
          enabled: false,
          pseudo: { enabled: true, minute: 10 },
          checkDispo: { enabled: false, times: [] },
          rappel: { enabled: false, times: [] },
        };

        markDirty();
        return refresh();
      }

      if (i.customId === CID.cancel) return end();

      // IDs
      if (i.customId === CID.idsAButton) return i.showModal(buildIdsModalA(CID.idsAModal, draft.dispoMessageIds)).catch(() => {});
      if (i.customId === CID.idsBButton) return i.showModal(buildIdsModalB(CID.idsBModal, draft.dispoMessageIds)).catch(() => {});
      if (i.customId === CID.idsClear) {
        draft.dispoMessageIds = new Array(7).fill(null);
        markDirty();
        return refresh();
      }

      // Automations toggles
      if (i.customId === CID.autoGlobal) { draft.automations.enabled = !draft.automations.enabled; markDirty(); return refresh(); }
      if (i.customId === CID.autoPseudo) { draft.automations.pseudo.enabled = !draft.automations.pseudo.enabled; markDirty(); return refresh(); }
      if (i.customId === CID.autoCheck) { draft.automations.checkDispo.enabled = !draft.automations.checkDispo.enabled; markDirty(); return refresh(); }
      if (i.customId === CID.autoRappel) { draft.automations.rappel.enabled = !draft.automations.rappel.enabled; markDirty(); return refresh(); }

      // Minute Pseudo
      if (i.customId === CID.pseudoMinuteBtn) {
        return i.showModal(buildPseudoMinuteModal(CID.pseudoMinuteModal, draft.automations.pseudo.minute)).catch(() => {});
      }

      // Clear horaires (selon onglet)
      if (i.customId === CID.clearTabTimes) {
        if (autoTab === "check") draft.automations.checkDispo.times = [];
        else draft.automations.rappel.times = [];
        markDirty();
        return refresh();
      }
    }

    SETUP_SESSIONS.set(scope, { guildId, userId, handle, end });

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
};
