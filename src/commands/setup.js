// src/commands/setup.js
// Setup PROSYNC — multi-serveur — STAFF ONLY
// Configuration : salons, rôles, IDs et automations
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

const {
  getGuildConfig,
  upsertGuildConfig,
} = require("../core/guildConfig");

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
  warningRole: "⚠️",
  msg: "✉️",
  times: "🕒",
  broom: "🧹",
  preview: "📄",
  confirm: "✅",
};

const DAYS = [
  "Lun",
  "Mar",
  "Mer",
  "Jeu",
  "Ven",
  "Sam",
  "Dim",
];

const DAY_INDEX = {
  Lun: 0,
  Mar: 1,
  Mer: 2,
  Jeu: 3,
  Ven: 4,
  Sam: 5,
  Dim: 6,
};

const PRESET_TIMES = Array.from(
  { length: 24 },
  (_, hour) => `${String(hour).padStart(2, "0")}:00`
);

function isStaff(member, config) {
  if (!member) return false;

  if (
    member.permissions?.has?.(
      PermissionFlagsBits.Administrator
    )
  ) {
    return true;
  }

  const roleIds = Array.isArray(config?.staffRoleIds)
    ? config.staffRoleIds
    : [];

  return roleIds.some((roleId) =>
    member.roles?.cache?.has?.(String(roleId))
  );
}

function fmtChannel(id) {
  return id ? `<#${id}>` : "—";
}

function fmtRoles(ids) {
  const values = Array.isArray(ids)
    ? ids.filter(Boolean)
    : [];

  return values.length
    ? values.map((id) => `<@&${id}>`).join(" ")
    : "—";
}

function uniqIds(input, max = 25) {
  const output = [];
  const seen = new Set();

  for (const value of Array.isArray(input) ? input : []) {
    const id = String(value || "").trim();

    if (!id || seen.has(id)) continue;

    seen.add(id);
    output.push(id);

    if (output.length >= max) break;
  }

  return output;
}

function isSnowflake(value) {
  return /^[0-9]{15,25}$/.test(
    String(value || "").trim()
  );
}

function normalizeDispoMessageIds(input) {
  const source = Array.isArray(input) ? input : [];
  const output = new Array(7).fill(null);

  for (let index = 0; index < 7; index++) {
    const value =
      source[index] === null ||
      source[index] === undefined
        ? ""
        : String(source[index]).trim();

    output[index] = isSnowflake(value)
      ? value
      : null;
  }

  return output;
}

function fmtMessageIds(ids) {
  const values = Array.isArray(ids) ? ids : [];

  return DAYS.map(
    (day, index) =>
      `${day}: ${
        values[index]
          ? `\`${String(values[index])}\``
          : "—"
      }`
  ).join("\n");
}

function clampInt(
  value,
  { min = 0, max = 59, fallback = 10 } = {}
) {
  const number = Number(value);

  if (!Number.isFinite(number)) return fallback;

  const integer = Math.trunc(number);

  if (integer < min) return min;
  if (integer > max) return max;

  return integer;
}

function normalizeTimeStr(value) {
  const string = String(value || "").trim();
  const match = string.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(
    minutes
  ).padStart(2, "0")}`;
}

function normalizeTimes(input, { max = 12 } = {}) {
  const output = [];
  const seen = new Set();

  for (const value of Array.isArray(input) ? input : []) {
    const time = normalizeTimeStr(value);

    if (!time || seen.has(time)) continue;

    seen.add(time);
    output.push(time);

    if (output.length >= max) break;
  }

  output.sort((a, b) => a.localeCompare(b));
  return output;
}

function fmtTimes(input) {
  const values = Array.isArray(input) ? input : [];

  return values.length
    ? values.map((time) => `\`${time}\``).join(" ")
    : "—";
}

function createRefreshQueue(fn) {
  let chain = Promise.resolve();

  return () => {
    chain = chain.then(fn).catch(() => {});
    return chain;
  };
}

function parseScopeFromCustomId(customId) {
  const parts = String(customId || "").split(":");

  if (parts.length < 4) return null;

  const userId = parts[parts.length - 1];
  const guildId = parts[parts.length - 2];

  if (
    !/^\d{15,25}$/.test(guildId) ||
    !/^\d{15,25}$/.test(userId)
  ) {
    return null;
  }

  return `${guildId}:${userId}`;
}

function isModalOpenButtonCustomId(customId) {
  const value = String(customId || "");

  return (
    value.includes("setup:modal:") ||
    value.includes("setup:btn:confirmSave:") ||
    value.includes("setup:btn:openMinute:") ||
    value.includes("setup:btn:idsA:") ||
    value.includes("setup:btn:idsB:")
  );
}

function buildEmbed(
  guild,
  draft,
  { page = "channels", dirty = false } = {}
) {
  const requiredOk =
    Boolean(draft.disposChannelId) &&
    Boolean(draft.staffReportsChannelId) &&
    Array.isArray(draft.staffRoleIds) &&
    draft.staffRoleIds.length > 0 &&
    Array.isArray(draft.playerRoleIds) &&
    draft.playerRoleIds.length > 0;

  const automations = draft.automations || {};

  const globalOn = Boolean(automations.enabled);

  const pseudoOn = Boolean(
    automations.pseudo?.enabled
  );

  const pseudoMinute = clampInt(
    automations.pseudo?.minute,
    { fallback: 10 }
  );

  const checkOn = Boolean(
    automations.checkDispo?.enabled
  );

  const checkTimes = normalizeTimes(
    automations.checkDispo?.times
  );

  const rappelOn = Boolean(
    automations.rappel?.enabled
  );

  const rappelTimes = normalizeTimes(
    automations.rappel?.times
  );

  const warningOn = Boolean(
    automations.avertissement?.enabled
  );

  const warningRoleId =
    automations.avertissement?.roleId || null;

  const lastCheckTime =
    checkTimes.length > 0
      ? checkTimes[checkTimes.length - 1]
      : null;

  const pageLabel =
    page === "channels"
      ? "Salons"
      : page === "roles"
        ? "Rôles"
        : page === "ids"
          ? "CheckDispo / IDs"
          : "Automations";

  const statusLine = requiredOk
    ? `${ICON.ok} OK`
    : `${ICON.warn} Incomplet`;

  const dirtyLine = dirty
    ? `\n${ICON.warn} Modifications non sauvegardées`
    : "";

  return new EmbedBuilder()
    .setTitle(`${ICON.title} PROSYNC Setup — ${guild.name}`)
    .setColor(0xed4245)
    .setDescription(
      [
        `${statusLine} — Page : **${pageLabel}**${dirtyLine}`,
        "",
        "Requis : salon Dispos, salon Staff, au moins un rôle Staff et un rôle Joueur.",
        "L’automation Avertissement s’exécute au dernier horaire CheckDispo.",
      ].join("\n")
    )
    .addFields(
      {
        name: "Salons",
        value: [
          `${ICON.dispos} ${fmtChannel(
            draft.disposChannelId
          )} — Dispos`,
          `${ICON.staffReports} ${fmtChannel(
            draft.staffReportsChannelId
          )} — Rapports staff`,
          `${ICON.pseudoScan} ${fmtChannel(
            draft.pseudoScanChannelId
          )} — Scan pseudos`,
          `${ICON.checkDispo} ${fmtChannel(
            draft.checkDispoChannelId
          )} — Messages de disponibilité`,
        ].join("\n"),
      },
      {
        name: "Rôles",
        value: [
          `${ICON.staff} ${fmtRoles(
            draft.staffRoleIds
          )} — Staff`,
          `${ICON.players} ${fmtRoles(
            draft.playerRoleIds
          )} — Joueurs`,
          `${ICON.postes} ${fmtRoles(
            draft.postRoleIds
          )} — Postes`,
        ].join("\n"),
      },
      {
        name: `${ICON.msg} IDs des messages`,
        value: fmtMessageIds(draft.dispoMessageIds),
      },
      {
        name: "Automations",
        value: [
          `Global : **${globalOn ? "ON" : "OFF"}**`,
          `Pseudo : **${pseudoOn ? "ON" : "OFF"}** — minute \`${pseudoMinute}\``,
          `CheckDispo : **${checkOn ? "ON" : "OFF"}** — ${fmtTimes(checkTimes)}`,
          `${ICON.rappel} Rappel : **${rappelOn ? "ON" : "OFF"}** — ${fmtTimes(rappelTimes)}`,
          `${ICON.warningRole} Avertissement : **${warningOn ? "ON" : "OFF"}** — rôle ${
            warningRoleId ? `<@&${warningRoleId}>` : "—"
          } — déclenchement ${
            lastCheckTime ? `\`${lastCheckTime}\`` : "non défini"
          }`,
        ].join("\n"),
      }
    )
    .setFooter({ text: "PROSYNC" });
}

const SETUP_SESSIONS = new Map();
let GLOBAL_SETUP_LISTENER_READY = false;

function ensureGlobalSetupListener(client) {
  if (GLOBAL_SETUP_LISTENER_READY || !client?.on) {
    return;
  }

  GLOBAL_SETUP_LISTENER_READY = true;

  client.on("interactionCreate", async (interaction) => {
    try {
      if (!interaction?.inGuild?.()) return;

      const isComponent =
        interaction.isButton?.() ||
        interaction.isStringSelectMenu?.() ||
        interaction.isRoleSelectMenu?.() ||
        interaction.isChannelSelectMenu?.();

      const isModal =
        typeof interaction.isModalSubmit === "function" &&
        interaction.isModalSubmit();

      if (!isComponent && !isModal) return;

      const customId = String(
        interaction.customId || ""
      );

      if (!customId.startsWith("setup:")) return;

      const scope = parseScopeFromCustomId(customId);

      if (!scope) return;

      const session = SETUP_SESSIONS.get(scope);

      if (!session) {
        if (
          isComponent &&
          !interaction.deferred &&
          !interaction.replied
        ) {
          await interaction.deferUpdate().catch(() => {});
        }

        await interaction
          .followUp({
            content:
              "⚠️ Session /setup expirée. Relance `/setup`.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});

        return;
      }

      if (
        String(interaction.user?.id) !==
          String(session.userId) ||
        String(interaction.guildId) !==
          String(session.guildId)
      ) {
        return;
      }

      if (
        isComponent &&
        !isModalOpenButtonCustomId(customId) &&
        !interaction.deferred &&
        !interaction.replied
      ) {
        await interaction.deferUpdate().catch(() => {});
      }

      await session.handle(interaction).catch(() => {});
    } catch {}
  });
}

function buildPseudoMinuteModal(customId, currentMinute) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Pseudo — minute d’exécution");

  const input = new TextInputBuilder()
    .setCustomId("minute")
    .setLabel("Minute entre 0 et 59")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("10")
    .setValue(
      String(
        clampInt(currentMinute, {
          fallback: 10,
        })
      )
    );

  modal.addComponents(
    new ActionRowBuilder().addComponents(input)
  );

  return modal;
}

function buildIdsModalA(customId, ids) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle("IDs Dispo — Lundi à Vendredi");

  const fields = ["Lun", "Mar", "Mer", "Jeu", "Ven"].map(
    (day) => {
      const index = DAY_INDEX[day];

      return new TextInputBuilder()
        .setCustomId(day)
        .setLabel(`${day} — ID du message`)
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder("ID Discord")
        .setValue(ids[index] ? String(ids[index]) : "");
    }
  );

  modal.addComponents(
    ...fields.map((field) =>
      new ActionRowBuilder().addComponents(field)
    )
  );

  return modal;
}

function buildIdsModalB(customId, ids) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle("IDs Dispo — Samedi et Dimanche");

  const fields = ["Sam", "Dim"].map((day) => {
    const index = DAY_INDEX[day];

    return new TextInputBuilder()
      .setCustomId(day)
      .setLabel(`${day} — ID du message`)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder("ID Discord")
      .setValue(ids[index] ? String(ids[index]) : "");
  });

  modal.addComponents(
    ...fields.map((field) =>
      new ActionRowBuilder().addComponents(field)
    )
  );

  return modal;
}

function buildConfirmSaveModal(customId) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Confirmation PROSYNC");

  const input = new TextInputBuilder()
    .setCustomId("confirm")
    .setLabel('Tape "CONFIRMER"')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("CONFIRMER");

  modal.addComponents(
    new ActionRowBuilder().addComponents(input)
  );

  return modal;
}

module.exports.ensureGlobalSetupListener =
  ensureGlobalSetupListener;

module.exports.data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription(
    "Configurer PROSYNC : salons, rôles, IDs et automations."
  )
  .setDefaultMemberPermissions(0n);

module.exports.execute = async function execute(interaction) {
  try {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: ICON.no,
        flags: MessageFlags.Ephemeral,
      });
    }

    ensureGlobalSetupListener(interaction.client);

    const guild = interaction.guild;
    const guildId = guild.id;

    const saved = getGuildConfig(guildId) || {};

    if (!isStaff(interaction.member, saved)) {
      return interaction.reply({
        content: `${ICON.no} Accès réservé au STAFF.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const legacyPostRoleIds = Array.isArray(saved.posts)
      ? saved.posts
          .map((post) => post?.roleId)
          .filter(Boolean)
      : [];

    const draft = {
      disposChannelId: saved.disposChannelId || null,
      staffReportsChannelId:
        saved.staffReportsChannelId || null,
      pseudoScanChannelId:
        saved.pseudoScanChannelId || null,
      checkDispoChannelId:
        saved.checkDispoChannelId || null,

      dispoMessageIds: normalizeDispoMessageIds(
        saved.dispoMessageIds
      ),

      staffRoleIds: uniqIds(
        Array.isArray(saved.staffRoleIds)
          ? saved.staffRoleIds
          : saved.staffRoleId
            ? [saved.staffRoleId]
            : []
      ),

      playerRoleIds: uniqIds(
        Array.isArray(saved.playerRoleIds)
          ? saved.playerRoleIds
          : []
      ),

      postRoleIds: uniqIds(
        Array.isArray(saved.postRoleIds)
          ? saved.postRoleIds
          : legacyPostRoleIds
      ),

      automations: {
        enabled: Boolean(saved.automations?.enabled),

        pseudo: {
          enabled:
            saved.automations?.pseudo?.enabled !== false,
          minute: clampInt(
            saved.automations?.pseudo?.minute,
            { fallback: 10 }
          ),
        },

        checkDispo: {
          enabled: Boolean(
            saved.automations?.checkDispo?.enabled
          ),
          times: normalizeTimes(
            saved.automations?.checkDispo?.times
          ),
        },

        rappel: {
          enabled: Boolean(
            saved.automations?.rappel?.enabled
          ),
          times: normalizeTimes(
            saved.automations?.rappel?.times
          ),
        },

        avertissement: {
          enabled: Boolean(
            saved.automations?.avertissement?.enabled
          ),
          roleId:
            saved.automations?.avertissement?.roleId ||
            null,
        },
      },
    };

    const userId = interaction.user.id;
    const scope = `${guildId}:${userId}`;

    const previousSession = SETUP_SESSIONS.get(scope);

    if (previousSession) {
      await previousSession.end("replaced").catch(() => {});
    }

    const CID = {
      page: `setup:page:${scope}`,

      dispos: `setup:ch:dispos:${scope}`,
      staffReports: `setup:ch:staff:${scope}`,
      pseudoScan: `setup:ch:pseudoScan:${scope}`,
      checkDispo: `setup:ch:checkDispo:${scope}`,

      staff: `setup:role:staff:${scope}`,
      players: `setup:role:players:${scope}`,
      posts: `setup:role:posts:${scope}`,
      warningRole: `setup:role:warning:${scope}`,

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
      autoWarning: `setup:btn:autoWarning:${scope}`,

      pseudoMinuteButton:
        `setup:btn:openMinute:${scope}`,
      pseudoMinuteModal:
        `setup:modal:pseudoMinute:${scope}`,

      checkTimes: `setup:sel:checkTimes:${scope}`,
      rappelTimes: `setup:sel:rappelTimes:${scope}`,

      clearCurrent: `setup:btn:clearCurrent:${scope}`,

      preview: `setup:btn:preview:${scope}`,
      confirmSaveButton:
        `setup:btn:confirmSave:${scope}`,
      confirmSaveModal:
        `setup:modal:confirmSave:${scope}`,
      reset: `setup:btn:reset:${scope}`,
      cancel: `setup:btn:cancel:${scope}`,
    };

    let page = "channels";
    let autoTab = "check";
    let dirty = false;

    const preset = PRESET_TIMES.map(
      normalizeTimeStr
    ).filter(Boolean);

    function markDirty() {
      dirty = true;
    }

    function rowPageSelect() {
      return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CID.page)
          .setPlaceholder("Choisir une page")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            {
              label: "Salons",
              value: "channels",
              default: page === "channels",
            },
            {
              label: "Rôles",
              value: "roles",
              default: page === "roles",
            },
            {
              label: "CheckDispo / IDs",
              value: "ids",
              default: page === "ids",
            },
            {
              label: "Automations",
              value: "automations",
              default: page === "automations",
            }
          )
      );
    }

    function rowActions() {
      if (page === "automations") {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(CID.pseudoMinuteButton)
            .setLabel(`${ICON.clock} Minute`)
            .setStyle(ButtonStyle.Primary),

          new ButtonBuilder()
            .setCustomId(CID.clearCurrent)
            .setLabel(`${ICON.broom} Effacer`)
            .setStyle(ButtonStyle.Secondary),

          new ButtonBuilder()
            .setCustomId(CID.confirmSaveButton)
            .setLabel(`${ICON.confirm} Sauvegarder`)
            .setStyle(ButtonStyle.Success),

          new ButtonBuilder()
            .setCustomId(CID.reset)
            .setLabel(`${ICON.reset} Reset`)
            .setStyle(ButtonStyle.Secondary),

          new ButtonBuilder()
            .setCustomId(CID.cancel)
            .setLabel(`${ICON.cancel} Annuler`)
            .setStyle(ButtonStyle.Danger)
        );
      }

      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.preview)
          .setLabel(`${ICON.preview} Aperçu`)
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId(CID.confirmSaveButton)
          .setLabel(`${ICON.confirm} Sauvegarder`)
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId(CID.reset)
          .setLabel(`${ICON.reset} Reset`)
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId(CID.cancel)
          .setLabel(`${ICON.cancel} Annuler`)
          .setStyle(ButtonStyle.Danger)
      );
    }

    function componentsForPage() {
      const rows = [rowPageSelect()];

      if (page === "channels") {
        rows.push(
          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(CID.dispos)
              .setPlaceholder(
                `${ICON.dispos} Salon Dispos`
              )
              .setMinValues(0)
              .setMaxValues(1)
              .addChannelTypes(ChannelType.GuildText)
          ),

          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(CID.staffReports)
              .setPlaceholder(
                `${ICON.staffReports} Salon Staff`
              )
              .setMinValues(0)
              .setMaxValues(1)
              .addChannelTypes(ChannelType.GuildText)
          ),

          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(CID.pseudoScan)
              .setPlaceholder(
                `${ICON.pseudoScan} Salon Pseudos`
              )
              .setMinValues(0)
              .setMaxValues(1)
              .addChannelTypes(ChannelType.GuildText)
          )
        );
      } else if (page === "roles") {
        rows.push(
          new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
              .setCustomId(CID.staff)
              .setPlaceholder(
                `${ICON.staff} Rôles Staff`
              )
              .setMinValues(0)
              .setMaxValues(25)
          ),

          new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
              .setCustomId(CID.players)
              .setPlaceholder(
                `${ICON.players} Rôles Joueurs`
              )
              .setMinValues(0)
              .setMaxValues(25)
          ),

          new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
              .setCustomId(CID.posts)
              .setPlaceholder(
                `${ICON.postes} Rôles Postes`
              )
              .setMinValues(0)
              .setMaxValues(25)
          )
        );
      } else if (page === "ids") {
        rows.push(
          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(CID.checkDispo)
              .setPlaceholder(
                `${ICON.checkDispo} Salon CheckDispo`
              )
              .setMinValues(0)
              .setMaxValues(1)
              .addChannelTypes(ChannelType.GuildText)
          ),

          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(CID.idsAButton)
              .setLabel(`${ICON.msg} IDs Lun → Ven`)
              .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
              .setCustomId(CID.idsBButton)
              .setLabel(`${ICON.msg} IDs Sam → Dim`)
              .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
              .setCustomId(CID.idsClear)
              .setLabel(`${ICON.broom} Effacer les IDs`)
              .setStyle(ButtonStyle.Secondary)
          )
        );
      } else if (page === "automations") {
        rows.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(CID.autoGlobal)
              .setLabel("Global")
              .setStyle(
                draft.automations.enabled
                  ? ButtonStyle.Success
                  : ButtonStyle.Secondary
              ),

            new ButtonBuilder()
              .setCustomId(CID.autoPseudo)
              .setLabel("Pseudo")
              .setStyle(
                draft.automations.pseudo.enabled
                  ? ButtonStyle.Success
                  : ButtonStyle.Secondary
              ),

            new ButtonBuilder()
              .setCustomId(CID.autoCheck)
              .setLabel("Check")
              .setStyle(
                draft.automations.checkDispo.enabled
                  ? ButtonStyle.Success
                  : ButtonStyle.Secondary
              ),

            new ButtonBuilder()
              .setCustomId(CID.autoRappel)
              .setLabel("Rappel")
              .setStyle(
                draft.automations.rappel.enabled
                  ? ButtonStyle.Success
                  : ButtonStyle.Secondary
              ),

            new ButtonBuilder()
              .setCustomId(CID.autoWarning)
              .setLabel("Avertissement")
              .setStyle(
                draft.automations.avertissement.enabled
                  ? ButtonStyle.Danger
                  : ButtonStyle.Secondary
              )
          ),

          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(CID.autoTab)
              .setPlaceholder(
                "Choisir une automation à configurer"
              )
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(
                {
                  label: "Horaires CheckDispo",
                  value: "check",
                  default: autoTab === "check",
                },
                {
                  label: "Horaires Rappel",
                  value: "rappel",
                  default: autoTab === "rappel",
                },
                {
                  label: "Rôle Avertissement",
                  value: "avertissement",
                  default:
                    autoTab === "avertissement",
                }
              )
          ),

          autoTab === "check"
            ? new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId(CID.checkTimes)
                  .setPlaceholder(
                    `${ICON.times} Horaires CheckDispo`
                  )
                  .setMinValues(0)
                  .setMaxValues(
                    Math.min(12, preset.length)
                  )
                  .addOptions(
                    preset.map((time) => ({
                      label: time,
                      value: time,
                      default:
                        draft.automations.checkDispo.times.includes(
                          time
                        ),
                    }))
                  )
              )
            : autoTab === "rappel"
              ? new ActionRowBuilder().addComponents(
                  new StringSelectMenuBuilder()
                    .setCustomId(CID.rappelTimes)
                    .setPlaceholder(
                      `${ICON.rappel} Horaires Rappel`
                    )
                    .setMinValues(0)
                    .setMaxValues(
                      Math.min(12, preset.length)
                    )
                    .addOptions(
                      preset.map((time) => ({
                        label: time,
                        value: time,
                        default:
                          draft.automations.rappel.times.includes(
                            time
                          ),
                      }))
                    )
                )
              : new ActionRowBuilder().addComponents(
                  new RoleSelectMenuBuilder()
                    .setCustomId(CID.warningRole)
                    .setPlaceholder(
                      `${ICON.warningRole} Rôle Avertissement`
                    )
                    .setMinValues(0)
                    .setMaxValues(1)
                )
        );
      }

      rows.push(rowActions());
      return rows;
    }

    function applyDefaultsToRows(rows) {
      try {
        for (const row of rows) {
          const component = row.components?.[0];

          if (!component) continue;

          if (
            component instanceof
            ChannelSelectMenuBuilder
          ) {
            if (
              component.data.custom_id === CID.dispos
            ) {
              component.setDefaultChannels(
                draft.disposChannelId
                  ? [draft.disposChannelId]
                  : []
              );
            }

            if (
              component.data.custom_id ===
              CID.staffReports
            ) {
              component.setDefaultChannels(
                draft.staffReportsChannelId
                  ? [draft.staffReportsChannelId]
                  : []
              );
            }

            if (
              component.data.custom_id ===
              CID.pseudoScan
            ) {
              component.setDefaultChannels(
                draft.pseudoScanChannelId
                  ? [draft.pseudoScanChannelId]
                  : []
              );
            }

            if (
              component.data.custom_id ===
              CID.checkDispo
            ) {
              component.setDefaultChannels(
                draft.checkDispoChannelId
                  ? [draft.checkDispoChannelId]
                  : []
              );
            }
          }

          if (
            component instanceof RoleSelectMenuBuilder
          ) {
            if (
              component.data.custom_id === CID.staff
            ) {
              component.setDefaultRoles(
                draft.staffRoleIds.slice(0, 25)
              );
            }

            if (
              component.data.custom_id === CID.players
            ) {
              component.setDefaultRoles(
                draft.playerRoleIds.slice(0, 25)
              );
            }

            if (
              component.data.custom_id === CID.posts
            ) {
              component.setDefaultRoles(
                draft.postRoleIds.slice(0, 25)
              );
            }

            if (
              component.data.custom_id ===
              CID.warningRole
            ) {
              component.setDefaultRoles(
                draft.automations.avertissement.roleId
                  ? [
                      draft.automations.avertissement
                        .roleId,
                    ]
                  : []
              );
            }
          }
        }
      } catch {}
    }

    await interaction.reply({
      embeds: [
        buildEmbed(guild, draft, { page, dirty }),
      ],
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

      await interaction
        .editReply({
          embeds: [
            buildEmbed(guild, draft, {
              page,
              dirty,
            }),
          ],
          components: rows,
        })
        .catch(() => {});
    };

    const refresh = createRefreshQueue(doRefresh);

    let ended = false;

    async function end() {
      if (ended) return;

      ended = true;
      SETUP_SESSIONS.delete(scope);

      await interaction
        .editReply({
          content: ICON.time,
          embeds: [
            buildEmbed(guild, draft, {
              page,
              dirty,
            }),
          ],
          components: [],
        })
        .catch(() => {});
    }

    const timeout = setTimeout(
      () => end().catch(() => {}),
      10 * 60 * 1000
    );

    timeout.unref?.();

    async function handle(componentInteraction) {
      if (componentInteraction.isModalSubmit?.()) {
        if (
          componentInteraction.customId ===
          CID.pseudoMinuteModal
        ) {
          const minute = clampInt(
            componentInteraction.fields.getTextInputValue(
              "minute"
            ),
            { fallback: 10 }
          );

          draft.automations.pseudo.minute = minute;
          markDirty();

          await componentInteraction
            .reply({
              content: `✅ Minute pseudo : \`${minute}\`.`,
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});

          return refresh();
        }

        if (
          componentInteraction.customId === CID.idsAModal
        ) {
          const next = normalizeDispoMessageIds(
            draft.dispoMessageIds
          );

          for (const day of [
            "Lun",
            "Mar",
            "Mer",
            "Jeu",
            "Ven",
          ]) {
            const raw = String(
              componentInteraction.fields.getTextInputValue(
                day
              ) || ""
            ).trim();

            next[DAY_INDEX[day]] = raw
              ? isSnowflake(raw)
                ? raw
                : null
              : null;
          }

          draft.dispoMessageIds = next;
          markDirty();

          await componentInteraction
            .reply({
              content: "✅ IDs Lun → Ven mis à jour.",
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});

          return refresh();
        }

        if (
          componentInteraction.customId === CID.idsBModal
        ) {
          const next = normalizeDispoMessageIds(
            draft.dispoMessageIds
          );

          for (const day of ["Sam", "Dim"]) {
            const raw = String(
              componentInteraction.fields.getTextInputValue(
                day
              ) || ""
            ).trim();

            next[DAY_INDEX[day]] = raw
              ? isSnowflake(raw)
                ? raw
                : null
              : null;
          }

          draft.dispoMessageIds = next;
          markDirty();

          await componentInteraction
            .reply({
              content: "✅ IDs Sam → Dim mis à jour.",
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});

          return refresh();
        }

        if (
          componentInteraction.customId ===
          CID.confirmSaveModal
        ) {
          const confirmation = String(
            componentInteraction.fields.getTextInputValue(
              "confirm"
            ) || ""
          )
            .trim()
            .toUpperCase();

          if (confirmation !== "CONFIRMER") {
            await componentInteraction
              .reply({
                content:
                  "⚠️ Tape exactement `CONFIRMER`.",
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});

            return;
          }

          const requiredOk =
            Boolean(draft.disposChannelId) &&
            Boolean(draft.staffReportsChannelId) &&
            draft.staffRoleIds.length > 0 &&
            draft.playerRoleIds.length > 0;

          if (!requiredOk) {
            await componentInteraction
              .reply({
                content:
                  "⚠️ Setup incomplet : salons ou rôles requis manquants.",
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});

            return;
          }

          if (
            draft.automations.avertissement.enabled &&
            !draft.automations.avertissement.roleId
          ) {
            await componentInteraction
              .reply({
                content:
                  "⚠️ Sélectionne un rôle Avertissement avant d’activer cette automation.",
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});

            return;
          }

          if (
            draft.automations.avertissement.enabled &&
            draft.automations.checkDispo.times.length === 0
          ) {
            await componentInteraction
              .reply({
                content:
                  "⚠️ L’automation Avertissement nécessite au moins un horaire CheckDispo.",
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});

            return;
          }

          const legacyPosts = draft.postRoleIds.map(
            (roleId) => ({
              roleId: String(roleId),
              label: "POSTE",
            })
          );

          upsertGuildConfig(guildId, {
            botLabel: "PROSYNC",

            disposChannelId: draft.disposChannelId,
            staffReportsChannelId:
              draft.staffReportsChannelId,
            pseudoScanChannelId:
              draft.pseudoScanChannelId,
            checkDispoChannelId:
              draft.checkDispoChannelId,

            dispoMessageIds:
              normalizeDispoMessageIds(
                draft.dispoMessageIds
              ),

            staffRoleIds: uniqIds(
              draft.staffRoleIds
            ),
            playerRoleIds: uniqIds(
              draft.playerRoleIds
            ),
            postRoleIds: uniqIds(
              draft.postRoleIds
            ),

            staffRoleId:
              draft.staffRoleIds[0] || null,
            posts: legacyPosts,

            automations: {
              enabled: Boolean(
                draft.automations.enabled
              ),

              pseudo: {
                enabled: Boolean(
                  draft.automations.pseudo.enabled
                ),
                minute: clampInt(
                  draft.automations.pseudo.minute,
                  { fallback: 10 }
                ),
              },

              checkDispo: {
                enabled: Boolean(
                  draft.automations.checkDispo.enabled
                ),
                times: normalizeTimes(
                  draft.automations.checkDispo.times
                ),
              },

              rappel: {
                enabled: Boolean(
                  draft.automations.rappel.enabled
                ),
                times: normalizeTimes(
                  draft.automations.rappel.times
                ),
              },

              avertissement: {
                enabled: Boolean(
                  draft.automations.avertissement
                    .enabled
                ),
                roleId:
                  draft.automations.avertissement
                    .roleId || null,
              },
            },

            setupBy: userId,
            setupAt: new Date().toISOString(),
          });

          dirty = false;

          await componentInteraction
            .reply({
              content: `${ICON.save} Configuration PROSYNC sauvegardée.`,
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});

          return end();
        }

        return;
      }

      if (
        componentInteraction.isStringSelectMenu?.() &&
        componentInteraction.customId === CID.page
      ) {
        const value =
          componentInteraction.values?.[0];

        if (
          [
            "channels",
            "roles",
            "ids",
            "automations",
          ].includes(value)
        ) {
          page = value;
          return refresh();
        }

        return;
      }

      if (
        componentInteraction.isChannelSelectMenu?.()
      ) {
        const value =
          componentInteraction.values?.[0] || null;

        if (
          componentInteraction.customId === CID.dispos
        ) {
          draft.disposChannelId = value;
        }

        if (
          componentInteraction.customId ===
          CID.staffReports
        ) {
          draft.staffReportsChannelId = value;
        }

        if (
          componentInteraction.customId ===
          CID.pseudoScan
        ) {
          draft.pseudoScanChannelId = value;
        }

        if (
          componentInteraction.customId ===
          CID.checkDispo
        ) {
          draft.checkDispoChannelId = value;
        }

        markDirty();
        return refresh();
      }

      if (componentInteraction.isRoleSelectMenu?.()) {
        if (
          componentInteraction.customId === CID.staff
        ) {
          draft.staffRoleIds = uniqIds(
            componentInteraction.values
          );
        }

        if (
          componentInteraction.customId === CID.players
        ) {
          draft.playerRoleIds = uniqIds(
            componentInteraction.values
          );
        }

        if (
          componentInteraction.customId === CID.posts
        ) {
          draft.postRoleIds = uniqIds(
            componentInteraction.values
          );
        }

        if (
          componentInteraction.customId ===
          CID.warningRole
        ) {
          draft.automations.avertissement.roleId =
            componentInteraction.values?.[0] || null;
        }

        markDirty();
        return refresh();
      }

      if (
        componentInteraction.isStringSelectMenu?.()
      ) {
        if (
          componentInteraction.customId === CID.autoTab
        ) {
          const value =
            componentInteraction.values?.[0];

          if (
            [
              "check",
              "rappel",
              "avertissement",
            ].includes(value)
          ) {
            autoTab = value;
          }

          return refresh();
        }

        if (
          componentInteraction.customId ===
          CID.checkTimes
        ) {
          draft.automations.checkDispo.times =
            normalizeTimes(
              componentInteraction.values
            );

          markDirty();
          return refresh();
        }

        if (
          componentInteraction.customId ===
          CID.rappelTimes
        ) {
          draft.automations.rappel.times =
            normalizeTimes(
              componentInteraction.values
            );

          markDirty();
          return refresh();
        }
      }

      if (!componentInteraction.isButton?.()) return;

      if (
        componentInteraction.customId === CID.preview
      ) {
        return refresh();
      }

      if (
        componentInteraction.customId ===
        CID.confirmSaveButton
      ) {
        return componentInteraction
          .showModal(
            buildConfirmSaveModal(
              CID.confirmSaveModal
            )
          )
          .catch(() => {});
      }

      if (
        componentInteraction.customId === CID.reset
      ) {
        draft.disposChannelId = null;
        draft.staffReportsChannelId = null;
        draft.pseudoScanChannelId = null;
        draft.checkDispoChannelId = null;

        draft.staffRoleIds = [];
        draft.playerRoleIds = [];
        draft.postRoleIds = [];

        draft.dispoMessageIds =
          new Array(7).fill(null);

        draft.automations = {
          enabled: false,
          pseudo: {
            enabled: true,
            minute: 10,
          },
          checkDispo: {
            enabled: false,
            times: [],
          },
          rappel: {
            enabled: false,
            times: [],
          },
          avertissement: {
            enabled: false,
            roleId: null,
          },
        };

        markDirty();
        return refresh();
      }

      if (
        componentInteraction.customId === CID.cancel
      ) {
        return end();
      }

      if (
        componentInteraction.customId ===
        CID.idsAButton
      ) {
        return componentInteraction
          .showModal(
            buildIdsModalA(
              CID.idsAModal,
              draft.dispoMessageIds
            )
          )
          .catch(() => {});
      }

      if (
        componentInteraction.customId ===
        CID.idsBButton
      ) {
        return componentInteraction
          .showModal(
            buildIdsModalB(
              CID.idsBModal,
              draft.dispoMessageIds
            )
          )
          .catch(() => {});
      }

      if (
        componentInteraction.customId ===
        CID.idsClear
      ) {
        draft.dispoMessageIds =
          new Array(7).fill(null);

        markDirty();
        return refresh();
      }

      if (
        componentInteraction.customId ===
        CID.autoGlobal
      ) {
        draft.automations.enabled =
          !draft.automations.enabled;

        markDirty();
        return refresh();
      }

      if (
        componentInteraction.customId ===
        CID.autoPseudo
      ) {
        draft.automations.pseudo.enabled =
          !draft.automations.pseudo.enabled;

        markDirty();
        return refresh();
      }

      if (
        componentInteraction.customId ===
        CID.autoCheck
      ) {
        draft.automations.checkDispo.enabled =
          !draft.automations.checkDispo.enabled;

        markDirty();
        return refresh();
      }

      if (
        componentInteraction.customId ===
        CID.autoRappel
      ) {
        draft.automations.rappel.enabled =
          !draft.automations.rappel.enabled;

        markDirty();
        return refresh();
      }

      if (
        componentInteraction.customId ===
        CID.autoWarning
      ) {
        draft.automations.avertissement.enabled =
          !draft.automations.avertissement.enabled;

        markDirty();
        return refresh();
      }

      if (
        componentInteraction.customId ===
        CID.pseudoMinuteButton
      ) {
        return componentInteraction
          .showModal(
            buildPseudoMinuteModal(
              CID.pseudoMinuteModal,
              draft.automations.pseudo.minute
            )
          )
          .catch(() => {});
      }

      if (
        componentInteraction.customId ===
        CID.clearCurrent
      ) {
        if (autoTab === "check") {
          draft.automations.checkDispo.times = [];
        } else if (autoTab === "rappel") {
          draft.automations.rappel.times = [];
        } else {
          draft.automations.avertissement.roleId =
            null;
        }

        markDirty();
        return refresh();
      }
    }

    SETUP_SESSIONS.set(scope, {
      guildId,
      userId,
      handle,
      end,
    });

    refresh().catch(() => {});
  } catch (error) {
    console.error("[PROSYNC][SETUP]", error);

    try {
      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction.reply({
          content: "⚠️ Erreur /setup.",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.followUp({
          content: "⚠️ Erreur /setup.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch {}
  }
};
