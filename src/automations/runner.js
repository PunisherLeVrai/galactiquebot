// src/automations/runner.js
// Runner des automations PROSYNC — CommonJS
//
// PSEUDO :
// - rescane obligatoirement le salon pseudo avant synchronisation
// - dernier pseudo valide par utilisateur
// - aucun pseudo trouvé => username Discord
// - listener temps réel conservé

const { EmbedBuilder } = require("discord.js");

const DAYS = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

let PSEUDO_LISTENER_READY = false;

function dayIndexFromDate(date = new Date()) {
  return date.getDay() === 0
    ? 6
    : date.getDay() - 1;
}

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function uniq(input) {
  return [...new Set((input || []).map(String))]
    .filter(Boolean);
}

function mentionList(
  ids,
  { empty = "—", max = 40 } = {}
) {
  const values = uniq(ids);

  if (!values.length) return empty;

  return (
    values
      .slice(0, max)
      .map((id) => `<@${id}>`)
      .join(" ") +
    (values.length > max
      ? `\n… +${values.length - max}`
      : "")
  );
}

// ======================================================
// PSEUDOS
// ======================================================

function cleanPseudoInput(content) {
  const raw = String(content || "").trim();

  if (!raw) return null;

  if (
    raw.includes("\n") ||
    raw.includes("\r")
  ) {
    return null;
  }

  if (
    raw.includes("|") ||
    raw.includes("/")
  ) {
    return null;
  }

  const value = raw
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    value.length < 2 ||
    value.length > 24
  ) {
    return null;
  }

  if (
    value.includes("@everyone") ||
    value.includes("@here")
  ) {
    return null;
  }

  return value;
}

async function scanPseudoChannel(
  channel,
  { scanLimit = 300 } = {}
) {
  if (!channel?.isTextBased?.()) {
    return {
      ok: false,
      reason: "invalid_pseudo_channel",
      pseudos: new Map(),
      scannedMessages: 0,
    };
  }

  const pseudos = new Map();

  let before;
  let scannedMessages = 0;

  while (scannedMessages < scanLimit) {
    const batchSize = Math.min(
      100,
      scanLimit - scannedMessages
    );

    const messages = await channel.messages
      .fetch({
        limit: batchSize,
        before,
      })
      .catch(() => null);

    if (!messages || messages.size === 0) break;

    for (const message of messages.values()) {
      scannedMessages++;

      if (
        !message?.author?.id ||
        message.author.bot
      ) {
        continue;
      }

      const userId = String(message.author.id);

      // Le salon est parcouru du plus récent au plus ancien.
      if (pseudos.has(userId)) {
        continue;
      }

      const pseudo = cleanPseudoInput(
        message.content
      );

      if (!pseudo) continue;

      pseudos.set(userId, {
        pseudo,
        messageId: String(message.id),
      });
    }

    before = messages.last()?.id;

    if (!before || messages.size < batchSize) {
      break;
    }
  }

  return {
    ok: true,
    pseudos,
    scannedMessages,
  };
}

async function syncPseudoStoreFromChannel(
  guild,
  config,
  {
    scanLimit = 300,
    requirePseudoChannel = true,
  } = {}
) {
  if (!guild) {
    return {
      ok: false,
      reason: "no_guild",
    };
  }

  const channelId = config?.pseudoScanChannelId
    ? String(config.pseudoScanChannelId)
    : null;

  if (!channelId) {
    return {
      ok: !requirePseudoChannel,
      reason: "no_pseudo_channel",
      pseudosFound: 0,
      pseudosCleared: 0,
      scannedMessages: 0,
    };
  }

  const channel = await guild.channels
    .fetch(channelId)
    .catch(() => null);

  if (!channel?.isTextBased?.()) {
    return {
      ok: false,
      reason: "invalid_pseudo_channel",
      pseudosFound: 0,
      pseudosCleared: 0,
      scannedMessages: 0,
    };
  }

  const scan = await scanPseudoChannel(
    channel,
    { scanLimit }
  );

  if (!scan.ok) {
    return {
      ...scan,
      reason: scan.reason || "scan_failed",
    };
  }

  const {
    syncGuildPseudoSnapshot,
  } = require("../core/pseudoStore");

  const storeResult =
    syncGuildPseudoSnapshot(
      guild.id,
      scan.pseudos,
      {
        clearMissing: true,
      }
    );

  return {
    ok: true,
    channelId,
    scannedMessages: scan.scannedMessages,
    pseudosFound: scan.pseudos.size,
    pseudosCleared: storeResult.cleared,
    pseudosStored: storeResult.stored,
  };
}

async function applyPseudoMessage(message) {
  if (
    !message?.guild ||
    !message?.author ||
    message.author.bot
  ) {
    return;
  }

  const {
    getGuildConfig,
  } = require("../core/guildConfig");

  const config =
    getGuildConfig(message.guild.id) || {};

  const pseudoChannelId =
    config?.pseudoScanChannelId
      ? String(config.pseudoScanChannelId)
      : null;

  if (!pseudoChannelId) return;

  if (
    String(message.channelId) !==
    pseudoChannelId
  ) {
    return;
  }

  const pseudo = cleanPseudoInput(
    message.content
  );

  if (!pseudo) {
    await message.react("❌").catch(() => {});
    return;
  }

  const {
    setUserPseudo,
  } = require("../core/pseudoStore");

  const {
    buildMemberLine,
  } = require("../core/memberDisplay");

  let member = message.member || null;

  if (!member) {
    member = await message.guild.members
      .fetch(message.author.id)
      .catch(() => null);
  }

  if (!member) {
    await message.react("⚠️").catch(() => {});
    return;
  }

  setUserPseudo(
    message.guild.id,
    message.author.id,
    pseudo,
    {
      sourceMessageId: message.id,
    }
  );

  const nickname =
    buildMemberLine(member, config);

  let nicknameApplied = true;

  if (
    nickname &&
    (member.nickname || "") !== nickname
  ) {
    if (!member.manageable) {
      nicknameApplied = false;
    } else {
      try {
        await member.setNickname(
          nickname,
          "PROSYNC — pseudo validé"
        );
      } catch (error) {
        nicknameApplied = false;

        console.error(
          `[PROSYNC][PSEUDO_CHANNEL] Nickname impossible pour ${message.author.tag}:`,
          error?.message || error
        );
      }
    }
  }

  await message.react("✅").catch(() => {});

  if (!nicknameApplied) {
    await message.react("⚠️").catch(() => {});
  }
}

function ensurePseudoChannelListener(client) {
  if (
    PSEUDO_LISTENER_READY ||
    !client?.on
  ) {
    return;
  }

  PSEUDO_LISTENER_READY = true;

  client.on(
    "messageCreate",
    async (message) => {
      try {
        await applyPseudoMessage(message);
      } catch (error) {
        console.error(
          "[PROSYNC][PSEUDO_CHANNEL]",
          error
        );
      }
    }
  );
}

async function runPseudoForGuild(
  guild,
  config,
  {
    scanLimit = 300,
    throttleMs = 850,
    requirePseudoChannel = true,
  } = {}
) {
  if (!guild) {
    return {
      ok: false,
      reason: "no_guild",
    };
  }

  const scanResult =
    await syncPseudoStoreFromChannel(
      guild,
      config,
      {
        scanLimit,
        requirePseudoChannel,
      }
    );

  if (!scanResult.ok) {
    return {
      ok: false,
      ...scanResult,
    };
  }

  const {
    buildMemberLine,
  } = require("../core/memberDisplay");

  const {
    getUserPseudos,
  } = require("../core/pseudoStore");

  await guild.members
    .fetch()
    .catch(() => null);

  const members =
    guild.members.cache.filter(
      (member) =>
        member &&
        !member.user.bot
    );

  let okCount = 0;
  let fail = 0;
  let skipped = 0;
  let notManageable = 0;
  let usernameFallback = 0;

  for (const member of members.values()) {
    const stored =
      getUserPseudos(
        guild.id,
        member.id
      );

    if (!stored?.pseudo) {
      usernameFallback++;
    }

    const nickname =
      buildMemberLine(
        member,
        config
      );

    if (
      !nickname ||
      nickname.length < 2
    ) {
      skipped++;
      continue;
    }

    if (
      (member.nickname || "") ===
      nickname
    ) {
      skipped++;
      continue;
    }

    if (!member.manageable) {
      notManageable++;
      continue;
    }

    try {
      await member.setNickname(
        nickname,
        "PROSYNC — synchronisation pseudo"
      );

      okCount++;
    } catch (error) {
      console.error(
        `[PROSYNC][PSEUDO_AUTO] ${member.user?.tag || member.id}:`,
        error?.message || error
      );

      fail++;
    }

    if (throttleMs > 0) {
      await sleep(throttleMs);
    }
  }

  return {
    ok: true,

    scannedMessages:
      scanResult.scannedMessages || 0,

    pseudosFound:
      scanResult.pseudosFound || 0,

    pseudosCleared:
      scanResult.pseudosCleared || 0,

    pseudosStored:
      scanResult.pseudosStored || 0,

    usernameFallback,

    okCount,
    fail,
    skipped,
    notManageable,
  };
}

// ======================================================
// DISPONIBILITÉS
// ======================================================

async function safeFetchMessage(channel, messageId) {
  if (!channel || !messageId) return null;

  return channel.messages
    .fetch(String(messageId))
    .catch(() => null);
}

async function ensureFreshMessage(message) {
  if (!message) return null;

  return message
    .fetch({ force: true })
    .catch(() =>
      message
        .fetch()
        .catch(() => message)
    );
}

function findReaction(message, emojiName) {
  return (
    message?.reactions?.cache?.find(
      (reaction) =>
        reaction?.emoji?.name === emojiName ||
        reaction?.emoji?.toString?.() === emojiName
    ) || null
  );
}

async function fetchAllReactionUsers(reaction) {
  const output = new Set();

  if (!reaction?.users?.fetch) {
    return output;
  }

  let after;

  for (let page = 0; page < 15; page++) {
    const users = await reaction.users
      .fetch({
        limit: 100,
        after,
      })
      .catch(() => null);

    if (!users?.size) break;

    for (const user of users.values()) {
      if (user?.id && !user.bot) {
        output.add(user.id);
      }
    }

    after = users.last()?.id;

    if (!after || users.size < 100) {
      break;
    }
  }

  return output;
}

async function collectReactionUserIdsStrong(
  message,
  emojiName
) {
  const empty = new Set();

  if (!message) {
    return {
      ok: false,
      reason: "no_message",
      users: empty,
    };
  }

  const fresh =
    await ensureFreshMessage(message);

  if (
    (fresh?.reactions?.cache?.size ?? 0) === 0 &&
    fresh?.reactions?.fetch
  ) {
    await fresh.reactions
      .fetch()
      .catch(() => null);
  }

  let reaction =
    findReaction(
      fresh,
      emojiName
    );

  if (
    !reaction &&
    fresh?.reactions?.fetch
  ) {
    await fresh.reactions
      .fetch()
      .catch(() => null);

    reaction =
      findReaction(
        fresh,
        emojiName
      );
  }

  if (!reaction) {
    return (
      fresh?.reactions?.cache?.size ?? 0
    ) === 0
      ? {
          ok: false,
          reason: "reactions_unavailable",
          users: empty,
        }
      : {
          ok: true,
          reason: "emoji_not_found",
          users: empty,
        };
  }

  if (
    reaction.partial &&
    reaction.fetch
  ) {
    reaction = await reaction
      .fetch()
      .catch(() => reaction);
  }

  const users =
    await fetchAllReactionUsers(
      reaction
    ).catch(() => null);

  return users
    ? {
        ok: true,
        reason: "ok",
        users,
      }
    : {
        ok: false,
        reason: "users_fetch_failed",
        users: empty,
      };
}

function hasAnyRoleId(member, roleIds) {
  return (
    Array.isArray(roleIds)
      ? roleIds
      : []
  ).some(
    (id) =>
      id &&
      member.roles.cache.has(
        String(id)
      )
  );
}

function getDispoMessageIds(config) {
  const ids =
    Array.isArray(config?.dispoMessageIds)
      ? config.dispoMessageIds.slice(0, 7)
      : [];

  while (ids.length < 7) {
    ids.push(null);
  }

  return ids.map(
    (id) => (id ? String(id) : null)
  );
}

function resolveDispoChannelId(config) {
  const id =
    config?.checkDispoChannelId &&
    String(config.checkDispoChannelId) !== "null"
      ? config.checkDispoChannelId
      : config?.disposChannelId;

  return id ? String(id) : null;
}

async function getPlayersAndReactions(
  guild,
  config
) {
  const dispoChannelId =
    resolveDispoChannelId(config);

  if (!dispoChannelId) {
    return {
      ok: false,
      reason: "no_dispo_channel",
    };
  }

  const channel =
    await guild.channels
      .fetch(dispoChannelId)
      .catch(() => null);

  if (!channel?.isTextBased?.()) {
    return {
      ok: false,
      reason: "invalid_dispo_channel",
    };
  }

  const playerRoleIds =
    Array.isArray(config?.playerRoleIds)
      ? config.playerRoleIds
      : [];

  if (!playerRoleIds.length) {
    return {
      ok: false,
      reason: "no_player_roles",
    };
  }

  const dayIndex =
    dayIndexFromDate();

  const dayLabel =
    DAYS[dayIndex];

  const messageId =
    getDispoMessageIds(
      config
    )[dayIndex];

  if (!messageId) {
    return {
      ok: false,
      reason: "no_dispo_message",
      dayIndex,
      dayLabel,
      dispoChannelId,
    };
  }

  const message =
    await safeFetchMessage(
      channel,
      messageId
    );

  if (!message) {
    return {
      ok: false,
      reason: "dispo_message_not_found",
      dayIndex,
      dayLabel,
      messageId,
      dispoChannelId,
    };
  }

  const yes =
    await collectReactionUserIdsStrong(
      message,
      "✅"
    );

  const no =
    await collectReactionUserIdsStrong(
      message,
      "❌"
    );

  if (
    !yes.ok &&
    yes.reason === "reactions_unavailable" &&
    !no.ok &&
    no.reason === "reactions_unavailable"
  ) {
    return {
      ok: false,
      reason: "reactions_unavailable",
      dayIndex,
      dayLabel,
      messageId,
      dispoChannelId,
    };
  }

  await guild.members
    .fetch()
    .catch(() => null);

  const players =
    guild.members.cache.filter(
      (member) =>
        member &&
        !member.user.bot &&
        hasAnyRoleId(
          member,
          playerRoleIds
        )
    );

  return {
    ok: true,
    channel,
    players,

    reactedIds: new Set([
      ...yes.users,
      ...no.users,
    ]),

    yesIds: [...yes.users],
    noIds: [...no.users],

    dayIndex,
    dayLabel,
    messageId,
    dispoChannelId,
  };
}

async function runCheckDispoForGuild(
  guild,
  config
) {
  const reportChannel =
    config?.staffReportsChannelId
      ? await guild.channels
          .fetch(
            String(
              config.staffReportsChannelId
            )
          )
          .catch(() => null)
      : null;

  if (!reportChannel?.isTextBased?.()) {
    return {
      ok: false,
      reason: "invalid_report_channel",
    };
  }

  const result =
    await getPlayersAndReactions(
      guild,
      config
    );

  const embed =
    new EmbedBuilder()
      .setTitle(
        `📊 Check Dispo — ${
          result.dayLabel ||
          DAYS[dayIndexFromDate()]
        }`
      )
      .setColor(0xed4245)
      .setFooter({
        text: "PROSYNC",
      });

  if (!result.ok) {
    embed.setDescription(
      `Erreur : **${result.reason}**`
    );
  } else {
    const playerIds =
      new Set(
        result.players.map(
          (member) => member.id
        )
      );

    const missing =
      [...playerIds].filter(
        (id) =>
          !result.reactedIds.has(id)
      );

    embed
      .setDescription(
        `Salon : <#${result.dispoChannelId}>\n` +
          `Joueurs détectés : **${playerIds.size}**`
      )
      .addFields(
        {
          name: `🟩 Présents (${result.yesIds.length})`,
          value: mentionList(result.yesIds),
        },
        {
          name: `🟥 Absents (${result.noIds.length})`,
          value: mentionList(result.noIds),
        },
        {
          name: `🟦 Sans réaction (${missing.length})`,
          value: mentionList(missing),
        }
      );
  }

  await reportChannel
    .send({
      embeds: [embed],
    })
    .catch(() => null);

  return result;
}

function buildMessageLink(
  guildId,
  channelId,
  messageId
) {
  return guildId &&
    channelId &&
    messageId
    ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
    : null;
}

async function runRappelDispoForGuild(
  guild,
  config
) {
  const result =
    await getPlayersAndReactions(
      guild,
      config
    );

  if (!result.ok) {
    return result;
  }

  const playerIds =
    new Set(
      result.players.map(
        (member) => member.id
      )
    );

  const missing =
    [...playerIds].filter(
      (id) =>
        !result.reactedIds.has(id)
    );

  if (!missing.length) {
    return {
      ...result,
      nothingToDo: true,
    };
  }

  const link =
    buildMessageLink(
      guild.id,
      result.dispoChannelId,
      result.messageId
    );

  await result.channel
    .send({
      content:
        `⏰ **Rappel Dispo — ${result.dayLabel}**\n` +
        `Merci de répondre avec ✅ ou ❌.` +
        (link ? `\n➡️ ${link}` : "") +
        `\n\n${mentionList(missing, {
          max: 60,
        })}`,

      allowedMentions: {
        users: missing.slice(0, 100),
        roles: [],
        repliedUser: false,
      },
    })
    .catch(() => null);

  return {
    ...result,
    missing,
    sent: true,
  };
}

function normalizeWarningRoleIds(config) {
  const warning =
    config?.automations?.avertissement || {};

  const source =
    Array.isArray(warning.roleIds)
      ? warning.roleIds
      : [
          warning.roleId,
          null,
          null,
        ];

  return uniq(
    source
      .slice(0, 3)
      .filter(Boolean)
  );
}

async function runAvertissementForGuild(
  guild,
  config,
  { throttleMs = 250 } = {}
) {
  if (!guild) {
    return {
      ok: false,
      reason: "no_guild",
    };
  }

  const warningRoleIds =
    normalizeWarningRoleIds(config);

  if (!warningRoleIds.length) {
    return {
      ok: false,
      reason: "no_warning_roles",
    };
  }

  const today = dateKey();

  if (
    config?.automations?.avertissement?.lastProcessedDate ===
    today
  ) {
    return {
      ok: true,
      reason: "already_processed_today",
      skipped: true,
    };
  }

  for (const roleId of warningRoleIds) {
    const role =
      await guild.roles
        .fetch(roleId)
        .catch(() => null);

    if (!role) {
      return {
        ok: false,
        reason: "warning_role_not_found",
        roleId,
      };
    }

    if (!role.editable) {
      return {
        ok: false,
        reason: "warning_role_not_editable",
        roleId,
      };
    }
  }

  const result =
    await getPlayersAndReactions(
      guild,
      config
    );

  if (!result.ok) {
    return result;
  }

  const levelAddedIds =
    warningRoleIds.map(() => []);

  const regularizedIds = [];
  const maxLevelIds = [];
  const unchangedIds = [];
  const failedIds = [];

  for (const member of result.players.values()) {
    const hasReacted =
      result.reactedIds.has(member.id);

    const currentIndexes =
      warningRoleIds
        .map(
          (roleId, index) =>
            member.roles.cache.has(roleId)
              ? index
              : -1
        )
        .filter(
          (index) => index >= 0
        );

    try {
      if (hasReacted) {
        if (currentIndexes.length) {
          await member.roles.remove(
            currentIndexes.map(
              (index) =>
                warningRoleIds[index]
            ),
            `PROSYNC — disponibilité renseignée (${result.dayLabel})`
          );

          regularizedIds.push(member.id);
        } else {
          unchangedIds.push(member.id);
        }
      } else {
        const currentLevel =
          currentIndexes.length
            ? Math.max(...currentIndexes)
            : -1;

        const targetLevel =
          Math.min(
            currentLevel + 1,
            warningRoleIds.length - 1
          );

        if (
          currentLevel ===
          warningRoleIds.length - 1
        ) {
          const lowerRoles =
            currentIndexes
              .filter(
                (index) =>
                  index !== currentLevel
              )
              .map(
                (index) =>
                  warningRoleIds[index]
              );

          if (lowerRoles.length) {
            await member.roles.remove(
              lowerRoles,
              "PROSYNC — nettoyage anciens niveaux"
            );
          }

          maxLevelIds.push(member.id);
        } else {
          if (currentIndexes.length) {
            await member.roles.remove(
              currentIndexes.map(
                (index) =>
                  warningRoleIds[index]
              ),
              `PROSYNC — montée niveau ${targetLevel + 1}`
            );
          }

          await member.roles.add(
            warningRoleIds[targetLevel],
            `PROSYNC — disponibilité non renseignée (${result.dayLabel})`
          );

          levelAddedIds[targetLevel].push(
            member.id
          );
        }
      }
    } catch {
      failedIds.push(member.id);
    }

    if (throttleMs > 0) {
      await sleep(throttleMs);
    }
  }

  const {
    upsertGuildConfig,
  } = require("../core/guildConfig");

  upsertGuildConfig(
    guild.id,
    {
      automations: {
        avertissement: {
          lastProcessedDate: today,
        },
      },
    }
  );

  const reportChannel =
    config?.staffReportsChannelId
      ? await guild.channels
          .fetch(
            String(
              config.staffReportsChannelId
            )
          )
          .catch(() => null)
      : null;

  if (reportChannel?.isTextBased?.()) {
    const embed =
      new EmbedBuilder()
        .setTitle(
          `⚠️ Rapport Avertissements — ${result.dayLabel}`
        )
        .setColor(0xed4245)
        .setDescription(
          `Message : \`${result.messageId}\`\n` +
            `Joueurs contrôlés : **${result.players.size}**\n\n` +
            warningRoleIds
              .map(
                (roleId, index) =>
                  `${index + 1}. <@&${roleId}>`
              )
              .join("\n")
        );

    warningRoleIds.forEach(
      (roleId, index) => {
        embed.addFields({
          name:
            `Niveau ${index + 1} attribué (` +
            `${levelAddedIds[index].length})`,

          value: mentionList(
            levelAddedIds[index]
          ),
        });
      }
    );

    embed
      .addFields(
        {
          name:
            `Régularisés — rôles retirés (` +
            `${regularizedIds.length})`,

          value: mentionList(
            regularizedIds
          ),
        },
        {
          name:
            `Déjà au niveau maximum (` +
            `${maxLevelIds.length})`,

          value: mentionList(
            maxLevelIds
          ),
        },
        {
          name: "Résultat",

          value:
            `Inchangés : **${unchangedIds.length}**\n` +
            `Échecs : **${failedIds.length}**` +
            (failedIds.length
              ? `\n${mentionList(
                  failedIds,
                  { max: 30 }
                )}`
              : ""),
        }
      )
      .setFooter({
        text: "PROSYNC",
      });

    await reportChannel
      .send({
        embeds: [embed],
      })
      .catch(() => null);
  }

  return {
    ok: true,

    dayIndex: result.dayIndex,
    dayLabel: result.dayLabel,
    messageId: result.messageId,

    levelsAdded:
      levelAddedIds.map(
        (ids) => ids.length
      ),

    regularized:
      regularizedIds.length,

    maxLevel:
      maxLevelIds.length,

    unchanged:
      unchangedIds.length,

    failed:
      failedIds.length,
  };
}

// ======================================================
// RUNNER
// ======================================================

function parseHHMM(value) {
  const match =
    String(value || "")
      .trim()
      .match(
        /^([01]?\d|2[0-3]):([0-5]\d)$/
      );

  return match
    ? {
        hours: Number(match[1]),
        minutes: Number(match[2]),
      }
    : null;
}

function minuteKey(date = new Date()) {
  return (
    `${dateKey(date).replaceAll("-", "")}` +
    `${String(date.getHours()).padStart(2, "0")}` +
    `${String(date.getMinutes()).padStart(2, "0")}`
  );
}

function startAutomationRunner(
  client,
  options = {}
) {
  ensurePseudoChannelListener(client);

  const scanLimit =
    typeof options.scanLimit === "number"
      ? options.scanLimit
      : 300;

  const throttleMsPseudo =
    typeof options.throttleMsPseudo === "number"
      ? options.throttleMsPseudo
      : 850;

  const throttleMsAvertissement =
    typeof options.throttleMsAvertissement === "number"
      ? options.throttleMsAvertissement
      : 250;

  const loopMs =
    typeof options.loopMs === "number"
      ? options.loopMs
      : 20_000;

  const lastRun = new Map();

  async function tick() {
    try {
      if (!client?.guilds?.cache) return;

      const now = new Date();
      const keyNow = minuteKey(now);

      const {
        getGuildConfig,
      } = require("../core/guildConfig");

      for (const guild of client.guilds.cache.values()) {
        const config =
          getGuildConfig(guild.id);

        if (!config?.automations?.enabled) {
          continue;
        }

        if (
          config.automations.pseudo?.enabled &&
          now.getMinutes() ===
            (Number.isInteger(
              config.automations.pseudo.minute
            )
              ? config.automations.pseudo.minute
              : 10)
        ) {
          const key = `${guild.id}:pseudo`;

          if (
            lastRun.get(key) !==
            keyNow
          ) {
            lastRun.set(
              key,
              keyNow
            );

            await runPseudoForGuild(
              guild,
              config,
              {
                scanLimit,
                throttleMs: throttleMsPseudo,
                requirePseudoChannel: true,
              }
            );
          }
        }

        for (const [
          name,
          enabled,
          times,
          runner,
        ] of [
          [
            "check",
            config.automations.checkDispo?.enabled,
            config.automations.checkDispo?.times,
            runCheckDispoForGuild,
          ],
          [
            "rappel",
            config.automations.rappel?.enabled,
            config.automations.rappel?.times,
            runRappelDispoForGuild,
          ],
        ]) {
          if (!enabled) continue;

          for (const time of Array.isArray(times) ? times : []) {
            const parsed =
              parseHHMM(time);

            if (
              !parsed ||
              parsed.hours !== now.getHours() ||
              parsed.minutes !== now.getMinutes()
            ) {
              continue;
            }

            const key =
              `${guild.id}:${name}:${time}`;

            if (
              lastRun.get(key) !==
              keyNow
            ) {
              lastRun.set(
                key,
                keyNow
              );

              await runner(
                guild,
                config
              );
            }
          }
        }

        if (
          config.automations.avertissement?.enabled
        ) {
          const times =
            Array.isArray(
              config.automations.checkDispo?.times
            )
              ? [
                  ...config.automations.checkDispo.times,
                ].sort(
                  (a, b) =>
                    String(a).localeCompare(
                      String(b)
                    )
                )
              : [];

          const lastTime =
            times.at(-1);

          const parsed =
            parseHHMM(lastTime);

          if (
            parsed &&
            parsed.hours === now.getHours() &&
            parsed.minutes === now.getMinutes()
          ) {
            const key =
              `${guild.id}:avertissement:${lastTime}`;

            if (
              lastRun.get(key) !==
              keyNow
            ) {
              lastRun.set(
                key,
                keyNow
              );

              await runAvertissementForGuild(
                guild,
                config,
                {
                  throttleMs:
                    throttleMsAvertissement,
                }
              );
            }
          }
        }
      }
    } catch (error) {
      console.error(
        "[PROSYNC][AUTOMATION_TICK]",
        error
      );
    }
  }

  const timer =
    setInterval(
      tick,
      loopMs
    );

  timer.unref?.();

  if (options.runOnStart === true) {
    tick().catch(() => {});
  }

  return () =>
    clearInterval(timer);
}

module.exports = {
  startAutomationRunner,

  runPseudoForGuild,
  scanPseudoChannel,
  syncPseudoStoreFromChannel,

  runAvertissementForGuild,

  ensurePseudoChannelListener,
};
