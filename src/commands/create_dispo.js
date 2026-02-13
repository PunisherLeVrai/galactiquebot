// src/commands/create_dispo.js
// /create_dispo — STAFF ONLY — EPHEMERAL — 1 message + session (style /setup)
// Crée 1..7 messages Dispo (Lun..Dim) dans un salon + ajoute ✅/❌
// ✅ PAS de sauvegarde d'IDs
// Modes: embed | image (attachment)
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  MessageFlags,
} = require("discord.js");

const { getGuildConfig } = require("../core/guildConfig");

const ICON = {
  no: "⛔",
  warn: "⚠️",
  ok: "✅",
  time: "⏳",
  title: "🧾",
  channel: "📅",
  mode: "🧩",
  days: "🗓️",
  edit: "✏️",
  broom: "🧹",
  confirm: "✅",
  cancel: "❎",
};

const DAYS_FULL = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const DAYS_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const ids = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  return ids.some((id) => id && member.roles?.cache?.has?.(String(id)));
}

function parseScopeFromCustomId(customId) {
  // format: "cdispo:xxx:<guildId>:<userId>"
  const s = String(customId || "");
  const parts = s.split(":");
  if (parts.length < 4) return null;
  const userId = parts[parts.length - 1];
  const guildId = parts[parts.length - 2];
  if (!/^\d{15,25}$/.test(guildId) || !/^\d{15,25}$/.test(userId)) return null;
  return `${guildId}:${userId}`;
}

function createRefreshQueue(fn) {
  let chain = Promise.resolve();
  return () => {
    chain = chain.then(fn).catch(() => {});
    return chain;
  };
}

// Boutons qui ouvrent un modal => PAS de deferUpdate()
function isModalOpenButtonCustomId(customId) {
  const s = String(customId || "");
  return s.includes("cdispo:modal:") || s.includes("cdispo:btn:confirm:") || s.includes("cdispo:btn:editText:");
}

function clampText(s, max = 1900) {
  const t = String(s ?? "").replace(/\r/g, "").trim();
  if (!t) return "";
  return t.slice(0, max);
}

function resolveDefaultChannelId(cfg) {
  // cible = disposChannelId en priorité
  const v = cfg?.disposChannelId ? String(cfg.disposChannelId) : null;
  return v || null;
}

function buildDefaultEmbed({ dayIndex, title, desc }) {
  const day = DAYS_FULL[dayIndex];
  return new EmbedBuilder()
    .setTitle(title ? `${title} — ${day}` : `Disponibilités — ${day}`)
    .setDescription(desc || "Réagis : ✅ présent | ❌ absent")
    .setColor(0x5865f2);
}

function buildSummaryEmbed(guild, draft, { dirty = false } = {}) {
  const dayList = draft.days.map((i) => DAYS_SHORT[i]).join(" • ") || "—";

  const lines = [
    `${draft.channelId ? `<#${draft.channelId}>` : "—"} — salon cible`,
    `${draft.mode === "image" ? "Image (attachement)" : "Embed"} — mode`,
    `${dayList} — jours à créer`,
    `Texte: ${draft.text ? "oui" : "non"}`,
    `Attachment: ${draft.attachmentName ? `oui (${draft.attachmentName})` : "non"}`,
    "",
    `Publier = bouton + taper \`CONFIRMER\``,
  ];

  const header = dirty ? `${ICON.warn} Modifs non publiées` : `${ICON.ok} Prêt`;

  return new EmbedBuilder()
    .setTitle(`${ICON.title} Create Dispo — ${guild.name}`)
    .setColor(0x5865f2)
    .setDescription([header, "", ...lines].join("\n"))
    .setFooter({ text: "XIG BLAUGRANA FC Staff" });
}

function buildConfirmModal(customId) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle("CONFIRMATION — Publier");
  const input = new TextInputBuilder()
    .setCustomId("confirm")
    .setLabel('Tape "CONFIRMER" pour publier')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("CONFIRMER");
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildEditTextModal(customId, curText) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle("Texte Dispo (optionnel)");
  const input = new TextInputBuilder()
    .setCustomId("text")
    .setLabel("Description/texte (optionnel)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setValue(clampText(curText || "", 1900));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

// --------------------
// Sessions + global listener
// --------------------
const CDISPO_SESSIONS = new Map();
let GLOBAL_CDISPO_LISTENER_READY = false;

function ensureGlobalCreateDispoListener(client) {
  if (GLOBAL_CDISPO_LISTENER_READY) return;
  if (!client?.on) return;

  GLOBAL_CDISPO_LISTENER_READY = true;

  client.on("interactionCreate", async (i) => {
    try {
      if (!i?.inGuild?.()) return;

      const isComponent = i.isButton?.() || i.isStringSelectMenu?.() || i.isChannelSelectMenu?.();
      const isModal = typeof i.isModalSubmit === "function" && i.isModalSubmit();
      if (!isComponent && !isModal) return;

      const customId = String(i.customId || "");
      if (!customId.startsWith("cdispo:")) return;

      const scope = parseScopeFromCustomId(customId);
      if (!scope) return;

      const session = CDISPO_SESSIONS.get(scope);
      if (!session) {
        try {
          if (isComponent && !i.deferred && !i.replied) await i.deferUpdate().catch(() => {});
        } catch {}
        try {
          if (!i.replied) {
            await i
              .followUp({ content: "⚠️ Session /create_dispo expirée. Relance la commande.", flags: MessageFlags.Ephemeral })
              .catch(() => {});
          }
        } catch {}
        return;
      }

      if (String(i.user?.id) !== String(session.userId)) return;
      if (String(i.guildId) !== String(session.guildId)) return;

      if (isComponent && !isModalOpenButtonCustomId(customId)) {
        if (!i.deferred && !i.replied) await i.deferUpdate().catch(() => {});
      }

      await session.handle(i).catch(() => {});
    } catch {
      // silencieux
    }
  });
}

// --------------------
// Command
// --------------------
module.exports.ensureGlobalCreateDispoListener = ensureGlobalCreateDispoListener;

module.exports.data = new SlashCommandBuilder()
  .setName("create_dispo")
  .setDescription("STAFF: Créer 1..7 messages Dispo (Lun..Dim) dans un salon (sans sauvegarde).")
  .addAttachmentOption((opt) =>
    opt.setName("image").setDescription("Optionnel: image à utiliser (mode Image)").setRequired(false)
  )
  .setDefaultMemberPermissions(0n);

module.exports.execute = async function execute(interaction) {
  try {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: ICON.no, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    ensureGlobalCreateDispoListener(interaction.client);

    const guild = interaction.guild;
    const guildId = guild.id;

    const cfg = getGuildConfig(guildId) || {};
    if (!isStaff(interaction.member, cfg)) {
      return interaction.reply({ content: `${ICON.no} Accès réservé au STAFF.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const defaultChannelId = resolveDefaultChannelId(cfg);
    if (!defaultChannelId) {
      return interaction
        .reply({ content: "⚠️ Aucun salon Dispos configuré. Fais d’abord `/setup`.", flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    const att = interaction.options.getAttachment("image");
    const userId = interaction.user.id;
    const scope = `${guildId}:${userId}`;

    // kill old session
    const prev = CDISPO_SESSIONS.get(scope);
    if (prev) {
      try { await prev.end("replaced").catch(() => {}); } catch {}
    }

    const draft = {
      channelId: defaultChannelId,
      mode: att ? "image" : "embed",
      days: [0, 1, 2, 3, 4, 5, 6],
      text: "",
      attachmentUrl: att?.url || null,
      attachmentName: att?.name || null,
    };

    let dirty = false;
    const markDirty = () => { dirty = true; };

    const CID = {
      channel: `cdispo:ch:channel:${scope}`,
      mode: `cdispo:sel:mode:${scope}`,
      days: `cdispo:sel:days:${scope}`,

      editTextBtn: `cdispo:btn:editText:${scope}`,
      editTextModal: `cdispo:modal:editText:${scope}`,

      clearTextBtn: `cdispo:btn:clearText:${scope}`,

      confirmBtn: `cdispo:btn:confirm:${scope}`,
      confirmModal: `cdispo:modal:confirm:${scope}`,

      resetBtn: `cdispo:btn:reset:${scope}`,
      cancelBtn: `cdispo:btn:cancel:${scope}`,
    };

    function rowChannel() {
      return new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CID.channel)
          .setPlaceholder(`${ICON.channel} Salon où publier`)
          .setMinValues(1)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );
    }

    function rowMode() {
      return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.mode)
          .setPlaceholder(`${ICON.mode} Mode`)
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            { label: "Embed", value: "embed", default: draft.mode === "embed" },
            { label: "Image (attachement)", value: "image", default: draft.mode === "image" }
          )
      );
    }

    function rowDays() {
      return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.days)
          .setPlaceholder(`${ICON.days} Jours à créer (1..7)`)
          .setMinValues(1)
          .setMaxValues(7)
          .addOptions(
            DAYS_SHORT.map((d, idx) => ({
              label: d,
              value: String(idx),
              default: draft.days.includes(idx),
            }))
          )
      );
    }

    function rowActions() {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CID.editTextBtn).setLabel(`${ICON.edit} Texte`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CID.clearTextBtn).setLabel(`${ICON.broom} Clear texte`).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.confirmBtn).setLabel(`${ICON.confirm} Publier`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CID.resetBtn).setLabel("Reset").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.cancelBtn).setLabel(`${ICON.cancel} Annuler`).setStyle(ButtonStyle.Danger)
      );
    }

    function applyDefaults(rows) {
      try {
        for (const row of rows) {
          const c = row.components?.[0];
          if (!c) continue;
          if (c instanceof ChannelSelectMenuBuilder) {
            if (c.data.custom_id === CID.channel) c.setDefaultChannels(draft.channelId ? [draft.channelId] : []);
          }
        }
      } catch {}
    }

    function components() {
      const rows = [rowChannel(), rowMode(), rowDays(), rowActions()];
      applyDefaults(rows);
      return rows;
    }

    await interaction.reply({
      embeds: [buildSummaryEmbed(guild, draft, { dirty })],
      components: components(),
      flags: MessageFlags.Ephemeral,
    });

    const doRefresh = async () => {
      await interaction
        .editReply({ embeds: [buildSummaryEmbed(guild, draft, { dirty })], components: components() })
        .catch(() => {});
    };

    const refresh = createRefreshQueue(doRefresh);

    let ended = false;
    async function end(reason = "end") {
      if (ended) return;
      ended = true;
      CDISPO_SESSIONS.delete(scope);
      try {
        await interaction
          .editReply({ content: ICON.time, embeds: [buildSummaryEmbed(guild, draft, { dirty })], components: [] })
          .catch(() => {});
      } catch {}
    }

    const timeout = setTimeout(() => end("timeout").catch(() => {}), 10 * 60 * 1000);
    timeout.unref?.();

    async function publishNow() {
      if (!draft.channelId) {
        await interaction.followUp({ content: "⚠️ Aucun salon sélectionné.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (!Array.isArray(draft.days) || draft.days.length < 1 || draft.days.length > 7) {
        await interaction.followUp({ content: "⚠️ Choisis 1 à 7 jours.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (draft.mode === "image" && !draft.attachmentUrl) {
        await interaction.followUp({
          content: "⚠️ Mode Image choisi, mais aucune image fournie. Relance `/create_dispo image:<fichier>` ou repasse en Embed.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      const channel = await guild.channels.fetch(String(draft.channelId)).catch(() => null);
      if (!channel || !channel.isTextBased?.()) {
        await interaction.followUp({ content: "⚠️ Le salon cible doit être un salon texte.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      const created = [];

      for (const dayIndex of draft.days) {
        const dayLabel = DAYS_FULL[dayIndex];
        let sent = null;

        if (draft.mode === "embed") {
          const emb = buildDefaultEmbed({
            dayIndex,
            title: "Disponibilités",
            desc: draft.text ? clampText(draft.text, 1900) : "Réagis : ✅ présent | ❌ absent",
          });

          sent = await channel.send({ embeds: [emb] }).catch(() => null);
        } else {
          const caption = draft.text
            ? clampText(draft.text, 1800)
            : `Disponibilités — ${dayLabel}\nRéagis : ✅ présent | ❌ absent`;

          sent = await channel
            .send({
              content: caption,
              files: [{ attachment: draft.attachmentUrl, name: draft.attachmentName || `dispo_${DAYS_SHORT[dayIndex]}.png` }],
            })
            .catch(() => null);
        }

        if (!sent?.id) continue;

        try { await sent.react("✅").catch(() => {}); } catch {}
        try { await sent.react("❌").catch(() => {}); } catch {}

        created.push({ dayIndex, id: sent.id });
      }

      const createdList = created.length
        ? created.map((x) => `${DAYS_SHORT[x.dayIndex]}: \`${x.id}\``).join("\n")
        : "—";

      await interaction.followUp({
        content: `✅ Messages créés: **${created.length}**\nSalon: <#${draft.channelId}>\nIDs (info):\n${createdList}`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});

      return end("published");
    }

    async function handle(i) {
      // MODALS
      if (i.isModalSubmit?.()) {
        if (i.customId === CID.editTextModal) {
          draft.text = clampText(i.fields.getTextInputValue("text"), 1900);
          markDirty();
          await i.reply({ content: "✅ Texte mis à jour.", flags: MessageFlags.Ephemeral }).catch(() => {});
          return refresh();
        }

        if (i.customId === CID.confirmModal) {
          const txt = String(i.fields.getTextInputValue("confirm") || "").trim().toUpperCase();
          if (txt !== "CONFIRMER") {
            await i.reply({ content: "⚠️ Confirmation refusée. Tape exactement: `CONFIRMER`.", flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
          }
          await i.reply({ content: "⏳ Publication en cours…", flags: MessageFlags.Ephemeral }).catch(() => {});
          return publishNow();
        }

        return;
      }

      // CHANNEL
      if (i.isChannelSelectMenu?.() && i.customId === CID.channel) {
        draft.channelId = i.values?.[0] ? String(i.values[0]) : null;
        markDirty();
        return refresh();
      }

      // MODE
      if (i.isStringSelectMenu?.() && i.customId === CID.mode) {
        const v = i.values?.[0];
        if (v === "embed" || v === "image") {
          draft.mode = v;
          markDirty();
          return refresh();
        }
      }

      // DAYS
      if (i.isStringSelectMenu?.() && i.customId === CID.days) {
        const picked = (i.values || [])
          .map((x) => Number(x))
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
        draft.days = Array.from(new Set(picked)).sort((a, b) => a - b);
        markDirty();
        return refresh();
      }

      // BUTTONS
      if (!i.isButton?.()) return;

      if (i.customId === CID.editTextBtn) {
        return i.showModal(buildEditTextModal(CID.editTextModal, draft.text)).catch(() => {});
      }

      if (i.customId === CID.clearTextBtn) {
        draft.text = "";
        markDirty();
        return refresh();
      }

      if (i.customId === CID.confirmBtn) {
        return i.showModal(buildConfirmModal(CID.confirmModal)).catch(() => {});
      }

      if (i.customId === CID.resetBtn) {
        draft.channelId = defaultChannelId;
        draft.mode = att ? "image" : "embed";
        draft.days = [0, 1, 2, 3, 4, 5, 6];
        draft.text = "";
        markDirty();
        return refresh();
      }

      if (i.customId === CID.cancelBtn) return end("cancel");
    }

    CDISPO_SESSIONS.set(scope, { guildId, userId, handle, end });

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
