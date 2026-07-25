// src/automations/runner.js
// Runner des automations PROSYNC
// CommonJS — discord.js v14

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

function dayIndexFromDate(date = new Date()) {
  const jsDay = date.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function sleep(milliseconds) {
  return new Promise((resolve) =>
    setTimeout(resolve, milliseconds)
  );
}

function cleanText(value, max = 64) {
  return String(value || "")
    .replace(/[`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function uniq(input) {
  return Array.from(
    new Set(
      (input || []).map((value) => String(value))
    )
  ).filter(Boolean);
}

function mentionList(
  ids,
  { empty = "—", max = 40 } = {}
) {
  const values = uniq(ids);

  if (!values.length) return empty;

  const mentions = values
    .slice(0, max)
    .map((id) => `<@${id}>`);

  const more =
    values.length > max
      ? `\n… +${values.length - max}`
      : "";

  return mentions.join(" ") + more;
}

async function safeFetchMessage(channel, messageId) {
  if (!channel || !messageId) return null;

  try {
    return await channel.messages.fetch(
      String(messageId)
    );
  } catch {
    return null;
  }
}

async function ensureFreshMessage(message) {
  if (!message) return null;

  try {
    if (message.partial) {
      const fetched = await message
        .fetch()
        .catch(() => null);

      return fetched || message;
    }

    const fetched = await message
      .fetch({ force: true })
      .catch(() => null);

    return fetched || message;
  } catch {
    try {
      const fetched = await message
        .fetch()
        .catch(() => null);

      return fetched || message;
    } catch {
      return message;
    }
  }
}

function findReactionInCache(message, emojiName) {
  if (!message?.reactions?.cache) return null;

  return (
    message.reactions.cache.find(
      (reaction) =>
        reaction?.emoji?.name === emojiName
    ) ||
    message.reactions.cache.find(
      (reaction) =>
        reaction?.emoji?.toString?.() === emojiName
    )
  );
}

async function tryFetchReactions(message) {
  try {
    if (message?.reactions?.fetch) {
      await message.reactions
        .fetch()
        .catch(() => null);
    }
  } catch {}
}

async function ensureFreshReaction(reaction) {
  if (!reaction) return null;

  try {
    if (
      reaction.partial &&
      typeof reaction.fetch === "function"
    ) {
      const fetched = await reaction
        .fetch()
        .catch(() => null);

      return fetched || reaction;
    }

    return reaction;
  } catch {
    return reaction;
  }
}

async function fetchAllReactionUsers(
  reaction,
  { maxPages = 15 } = {}
) {
  const output = new Set();

  if (!reaction?.users?.fetch) return output;

  let after;
  let pages = 0;

  while (pages < maxPages) {
    pages++;

    const users = await reaction.users
      .fetch({
        limit: 100,
        after,
      })
      .catch(() => null);

    if (!users || users.size === 0) break;

    for (const user of users.values()) {
      if (!user?.id || user.bot) continue;
      output.add(user.id);
    }

    after = users.last()?.id;

    if (!after || users.size < 100) break;
  }

  return output;
}

async function collectReactionUserIdsStrong(
  message,
  emojiName
) {
  const output = new Set();

  if (!message) {
    return {
      ok: false,
      reason: "no_message",
      users: output,
    };
  }

  const freshMessage =
    await ensureFreshMessage(message);

  if (
    (freshMessage?.reactions?.cache?.size ?? 0) === 0
  ) {
    await tryFetchReactions(freshMessage);
  }

  let reaction = findReactionInCache(
    freshMessage,
    emojiName
  );

  if (!reaction) {
    await tryFetchReactions(freshMessage);

    reaction = findReactionInCache(
      freshMessage,
      emojiName
    );
  }

  if (!reaction) {
    const cacheSize =
      freshMessage?.reactions?.cache?.size ?? 0;

    if (cacheSize === 0) {
      return {
        ok: false,
        reason: "reactions_unavailable",
        users: output,
      };
    }

    return {
      ok: true,
      reason: "emoji_not_found",
      users: output,
    };
  }

  reaction = await ensureFreshReaction(reaction);

  try {
    const users =
      await fetchAllReactionUsers(reaction);

    for (const id of users) {
      output.add(id);
    }
  } catch {
    return {
      ok: false,
      reason: "users_fetch_failed",
      users: output,
    };
  }

  return {
    ok: true,
    reason: "ok",
    users: output,
  };
}

function parsePlatformIdFromContent(content) {
  const match = String(content || "").match(
    /\b(psn|xbox|ea)\s*:\s*\/?\s*([^\s|]{2,64})/i
  );

  if (!match) return null;

  const platform = String(match[1]).toLowerCase();
  const value = cleanText(match[2], 40);

  return value
    ? {
        platform,
        value,
      }
    : null;
}

async function scanPseudoChannel(
  channel,
  { limit = 300 } = {}
) {
  const output = new Map();

  let lastId;
  let fetchedCount = 0;

  while (fetchedCount < limit) {
    const batchSize = Math.min(
      100,
      limit - fetchedCount
    );

    const messages = await channel.messages
      .fetch({
        limit: batchSize,
        before: lastId,
      })
      .catch(() => null);

    if (!messages || messages.size === 0) break;

    for (const message of messages.values()) {
      if (!message?.author?.id || message.author.bot) {
        continue;
      }

      const parsed = parsePlatformIdFromContent(
        message.content
      );

      if (!parsed) continue;

      const current =
        output.get(message.author.id) || {};

      if (!current[parsed.platform]) {
        current[parsed.platform] = parsed.value;
        output.set(message.author.id, current);
      }
    }

    fetchedCount += messages.size;
    lastId = messages.last()?.id;

    if (!lastId) break;
  }

  return output;
}

async function runPseudoForGuild(
  guild,
  config,
  { scanLimit = 300, throttleMs = 850 } = {}
) {
  if (!guild) {
    return {
      storedCount: 0,
      ok: 0,
      fail: 0,
      skipped: 0,
      notManageable: 0,
      scanned: false,
    };
  }

  const { importAllPseudos } = require(
    "../core/pseudoStore"
  );

  const { buildMemberLine } = require(
    "../core/memberDisplay"
  );

  let storedCount = 0;
  let scanned = false;

  if (config?.pseudoScanChannelId) {
    const channel = await guild.channels
      .fetch(config.pseudoScanChannelId)
      .catch(() => null);

    if (channel?.isTextBased?.()) {
      const scannedMap = await scanPseudoChannel(
        channel,
        { limit: scanLimit }
      ).catch(() => new Map());

      const usersPayload = {};

      for (const [userId, patch] of scannedMap) {
        const user = {};

        if (patch.psn) user.psn = patch.psn;
        if (patch.xbox) user.xbox = patch.xbox;
        if (patch.ea) user.ea = patch.ea;

        if (Object.keys(user).length > 0) {
          usersPayload[String(userId)] = user;
          storedCount++;
        }
      }

      if (storedCount > 0) {
        importAllPseudos(
          {
            version: 1,
            guilds: {
              [String(guild.id)]: {
                users: usersPayload,
              },
            },
          },
          { replace: false }
        );
      }

      scanned = true;
    }
  }

  await guild.members.fetch().catch(() => null);

  const members = guild.members.cache.filter(
    (member) => member && !member.user.bot
  );

  let ok = 0;
  let fail = 0;
  let skipped = 0;
  let notManageable = 0;

  for (const member of members.values()) {
    if (!member.manageable) {
      notManageable++;
      continue;
    }

    const nickname = buildMemberLine(
      member,
      config
    );

    if (!nickname || nickname.length < 2) {
      skipped++;
      continue;
    }

    if ((member.nickname || "") === nickname) {
      skipped++;
      continue;
    }

    try {
      await member.setNickname(
        nickname,
        "PROSYNC — synchronisation automatique"
      );

      ok++;
    } catch {
      fail++;
    }

    if (throttleMs > 0) {
      await sleep(throttleMs);
    }
  }

  return {
    storedCount,
    ok,
    fail,
    skipped,
    notManageable,
    scanned,
  };
}

function hasAnyRoleId(member, roleIds) {
  return (Array.isArray(roleIds) ? roleIds : []).some(
    (roleId) =>
      roleId &&
      member.roles.cache.has(String(roleId))
  );
}

function getDispoMessageIds(config) {
  if (Array.isArray(config?.dispoMessageIds)) {
    const values = config.dispoMessageIds
      .slice(0, 7)
      .map((value) =>
        value ? String(value) : null
      );

    while (values.length < 7) {
      values.push(null);
    }

    return values;
  }

  const legacy = [];

  for (let index = 0; index < 7; index++) {
    legacy.push(
      config?.[`dispoMessageId_${index}`]
        ? String(
            config[`dispoMessageId_${index}`]
          )
        : null
    );
  }

  return legacy.slice(0, 7);
}

function resolveDispoChannelId(config) {
  const value =
    config?.checkDispoChannelId &&
    String(config.checkDispoChannelId) !== "null"
      ? config.checkDispoChannelId
      : config?.disposChannelId;

  return value ? String(value) : null;
}

async function runCheckDispoForGuild(
  guild,
  config,
  { throttleMs = 0 } = {}
) {
  if (!guild) {
    return { ok: false, reason: "no_guild" };
  }

  const reportChannelId =
    config?.staffReportsChannelId
      ? String(config.staffReportsChannelId)
      : null;

  const dispoChannelId =
    resolveDispoChannelId(config);

  if (!reportChannelId) {
    return {
      ok: false,
      reason: "no_staff_reports_channel",
    };
  }

  if (!dispoChannelId) {
    return {
      ok: false,
      reason: "no_dispo_channel",
    };
  }

  const dayIndex = dayIndexFromDate(new Date());
  const dayLabel = DAYS[dayIndex];
  const messageId =
    getDispoMessageIds(config)[dayIndex];

  const reportChannel = await guild.channels
    .fetch(reportChannelId)
    .catch(() => null);

  const dispoChannel = await guild.channels
    .fetch(dispoChannelId)
    .catch(() => null);

  if (!reportChannel?.isTextBased?.()) {
    return {
      ok: false,
      reason: "invalid_report_channel",
    };
  }

  if (!dispoChannel?.isTextBased?.()) {
    return {
      ok: false,
      reason: "invalid_dispo_channel",
    };
  }

  await guild.members.fetch().catch(() => null);

  const playerRoleIds = Array.isArray(
    config?.playerRoleIds
  )
    ? config.playerRoleIds
    : [];

  if (!playerRoleIds.length) {
    return {
      ok: false,
      reason: "no_player_roles",
    };
  }

  const players = guild.members.cache
    .filter(
      (member) => member && !member.user.bot
    )
    .filter((member) =>
      hasAnyRoleId(member, playerRoleIds)
    );

  const playerIds = new Set(
    players.map((member) => member.id)
  );

  const embed = new EmbedBuilder()
    .setTitle(`📊 Check Dispo — ${dayLabel}`)
    .setColor(0xed4245)
    .setDescription(
      `Salon : <#${dispoChannelId}>\n` +
        `Joueurs détectés : **${playerIds.size}**`
    )
    .setFooter({ text: "PROSYNC" });

  if (!messageId) {
    embed.addFields({
      name: "⚠️ Message",
      value:
        "Aucun ID configuré pour ce jour.",
    });

    await reportChannel
      .send({ embeds: [embed] })
      .catch(() => null);

    return {
      ok: true,
      dayIndex,
      dayLabel,
      messageId: null,
    };
  }

  const message = await safeFetchMessage(
    dispoChannel,
    messageId
  );

  if (!message) {
    embed.addFields({
      name: "⚠️ Message",
      value: `Message introuvable : \`${messageId}\`.`,
    });

    await reportChannel
      .send({ embeds: [embed] })
      .catch(() => null);

    return {
      ok: true,
      dayIndex,
      dayLabel,
      messageId,
      missingMessage: true,
    };
  }

  const yesResult =
    await collectReactionUserIdsStrong(
      message,
      "✅"
    );

  const noResult =
    await collectReactionUserIdsStrong(
      message,
      "❌"
    );

  const bothUnavailable =
    !yesResult.ok &&
    yesResult.reason === "reactions_unavailable" &&
    !noResult.ok &&
    noResult.reason === "reactions_unavailable";

  if (bothUnavailable) {
    embed.addFields({
      name: "🚫 Réactions indisponibles",
      value:
        "Vérifie les permissions View Channel, Read Message History et l’intent GuildMessageReactions.",
    });

    await reportChannel
      .send({ embeds: [embed] })
      .catch(() => null);

    return {
      ok: true,
      dayIndex,
      dayLabel,
      messageId,
      reactionsUnavailable: true,
    };
  }

  const yesIds = Array.from(yesResult.users);
  const noIds = Array.from(noResult.users);
  const reacted = new Set([...yesIds, ...noIds]);

  const missingPlayers = Array.from(
    playerIds
  ).filter((id) => !reacted.has(id));

  embed.addFields(
    {
      name: `🟩 Présents (${yesIds.length})`,
      value: mentionList(yesIds),
    },
    {
      name: `🟥 Absents (${noIds.length})`,
      value: mentionList(noIds),
    },
    {
      name: `🟦 Sans réaction (${missingPlayers.length})`,
      value: mentionList(missingPlayers),
    }
  );

  await reportChannel
    .send({ embeds: [embed] })
    .catch(() => null);

  if (throttleMs > 0) {
    await sleep(throttleMs);
  }

  return {
    ok: true,
    dayIndex,
    dayLabel,
    messageId,
  };
}

function buildMessageLink(
  guildId,
  channelId,
  messageId
) {
  if (!guildId || !channelId || !messageId) {
    return null;
  }

  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

async function runRappelDispoForGuild(
  guild,
  config,
  { throttleMs = 0 } = {}
) {
  if (!guild) {
    return { ok: false, reason: "no_guild" };
  }

  const dispoChannelId =
    resolveDispoChannelId(config);

  if (!dispoChannelId) {
    return {
      ok: false,
      reason: "no_dispo_channel",
    };
  }

  const dayIndex = dayIndexFromDate(new Date());
  const dayLabel = DAYS[dayIndex];
  const messageId =
    getDispoMessageIds(config)[dayIndex];

  const channel = await guild.channels
    .fetch(dispoChannelId)
    .catch(() => null);

  if (!channel?.isTextBased?.()) {
    return {
      ok: false,
      reason: "invalid_dispo_channel",
    };
  }

  if (!messageId) {
    return {
      ok: true,
      dayIndex,
      dayLabel,
      messageId: null,
      nothingToDo: true,
    };
  }

  await guild.members.fetch().catch(() => null);

  const playerRoleIds = Array.isArray(
    config?.playerRoleIds
  )
    ? config.playerRoleIds
    : [];

  if (!playerRoleIds.length) {
    return {
      ok: false,
      reason: "no_player_roles",
    };
  }

  const players = guild.members.cache
    .filter(
      (member) => member && !member.user.bot
    )
    .filter((member) =>
      hasAnyRoleId(member, playerRoleIds)
    );

  const playerIds = new Set(
    players.map((member) => member.id)
  );

  const message = await safeFetchMessage(
    channel,
    messageId
  );

  if (!message) {
    return {
      ok: false,
      reason: "message_not_found",
    };
  }

  const yesResult =
    await collectReactionUserIdsStrong(
      message,
      "✅"
    );

  const noResult =
    await collectReactionUserIdsStrong(
      message,
      "❌"
    );

  const reacted = new Set([
    ...yesResult.users,
    ...noResult.users,
  ]);

  const missing = Array.from(playerIds).filter(
    (id) => !reacted.has(id)
  );

  if (!missing.length) {
    return {
      ok: true,
      dayIndex,
      dayLabel,
      messageId,
      nothingToDo: true,
    };
  }

  const link = buildMessageLink(
    guild.id,
    dispoChannelId,
    messageId
  );

  await channel
    .send({
      content:
        `⏰ **Rappel Dispo — ${dayLabel}**\n` +
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

  if (throttleMs > 0) {
    await sleep(throttleMs);
  }

  return {
    ok: true,
    dayIndex,
    dayLabel,
    messageId,
    missing,
    sent: true,
  };
}

// Ajoute le rôle aux joueurs sans réaction.
// Retire le rôle aux joueurs ayant répondu.
// Le rôle peut donc être régularisé automatiquement tant que
// l'automation repasse au dernier horaire configuré.
async function runAvertissementForGuild(
  guild,
  config,
  { throttleMs = 250 } = {}
) {
  if (!guild) {
    return { ok: false, reason: "no_guild" };
  }

  const warningRoleId =
    config?.automations?.avertissement?.roleId
      ? String(
          config.automations.avertissement.roleId
        )
      : null;

  if (!warningRoleId) {
    return {
      ok: false,
      reason: "no_warning_role",
    };
  }

  const warningRole = await guild.roles
    .fetch(warningRoleId)
    .catch(() => null);

  if (!warningRole) {
    return {
      ok: false,
      reason: "warning_role_not_found",
    };
  }

  if (!warningRole.editable) {
    return {
      ok: false,
      reason: "warning_role_not_editable",
    };
  }

  const dispoChannelId =
    resolveDispoChannelId(config);

  if (!dispoChannelId) {
    return {
      ok: false,
      reason: "no_dispo_channel",
    };
  }

  const channel = await guild.channels
    .fetch(dispoChannelId)
    .catch(() => null);

  if (!channel?.isTextBased?.()) {
    return {
      ok: false,
      reason: "invalid_dispo_channel",
    };
  }

  const playerRoleIds = Array.isArray(
    config?.playerRoleIds
  )
    ? config.playerRoleIds
    : [];

  if (!playerRoleIds.length) {
    return {
      ok: false,
      reason: "no_player_roles",
    };
  }

  const dayIndex = dayIndexFromDate(new Date());
  const dayLabel = DAYS[dayIndex];
  const messageId =
    getDispoMessageIds(config)[dayIndex];

  if (!messageId) {
    return {
      ok: false,
      reason: "no_dispo_message",
      dayIndex,
      dayLabel,
    };
  }

  const message = await safeFetchMessage(
    channel,
    messageId
  );

  if (!message) {
    return {
      ok: false,
      reason: "dispo_message_not_found",
      dayIndex,
      dayLabel,
    };
  }

  const yesResult =
    await collectReactionUserIdsStrong(
      message,
      "✅"
    );

  const noResult =
    await collectReactionUserIdsStrong(
      message,
      "❌"
    );

  const bothUnavailable =
    !yesResult.ok &&
    yesResult.reason === "reactions_unavailable" &&
    !noResult.ok &&
    noResult.reason === "reactions_unavailable";

  if (bothUnavailable) {
    return {
      ok: false,
      reason: "reactions_unavailable",
      dayIndex,
      dayLabel,
    };
  }

  await guild.members.fetch().catch(() => null);

  const players = guild.members.cache
    .filter(
      (member) => member && !member.user.bot
    )
    .filter((member) =>
      hasAnyRoleId(member, playerRoleIds)
    );

  const reactedIds = new Set([
    ...yesResult.users,
    ...noResult.users,
  ]);

  let added = 0;
  let removed = 0;
  let unchanged = 0;
  let failed = 0;

  const addedIds = [];
  const removedIds = [];

  for (const member of players.values()) {
    const hasReacted = reactedIds.has(member.id);
    const hasWarningRole =
      member.roles.cache.has(warningRoleId);

    try {
      if (!hasReacted && !hasWarningRole) {
        await member.roles.add(
          warningRoleId,
          `PROSYNC — disponibilité non renseignée (${dayLabel})`
        );

        added++;
        addedIds.push(member.id);
      } else if (hasReacted && hasWarningRole) {
        await member.roles.remove(
          warningRoleId,
          `PROSYNC — disponibilité renseignée (${dayLabel})`
        );

        removed++;
        removedIds.push(member.id);
      } else {
        unchanged++;
      }
    } catch {
      failed++;
    }

    if (throttleMs > 0) {
      await sleep(throttleMs);
    }
  }

  const reportChannelId =
    config?.staffReportsChannelId
      ? String(config.staffReportsChannelId)
      : null;

  if (reportChannelId) {
    const reportChannel = await guild.channels
      .fetch(reportChannelId)
      .catch(() => null);

    if (reportChannel?.isTextBased?.()) {
      const embed = new EmbedBuilder()
        .setTitle(
          `⚠️ Avertissements Dispo — ${dayLabel}`
        )
        .setColor(0xed4245)
        .setDescription(
          `Rôle : <@&${warningRoleId}>\n` +
            `Message : \`${messageId}\`\n` +
            `Joueurs contrôlés : **${players.size}**`
        )
        .addFields(
          {
            name: `Rôle ajouté (${added})`,
            value: mentionList(addedIds),
          },
          {
            name: `Rôle retiré (${removed})`,
            value: mentionList(removedIds),
          },
          {
            name: "Résultat",
            value:
              `Inchangés : **${unchanged}**\n` +
              `Échecs : **${failed}**`,
          }
        )
        .setFooter({ text: "PROSYNC" });

      await reportChannel
        .send({ embeds: [embed] })
        .catch(() => null);
    }
  }

  return {
    ok: true,
    dayIndex,
    dayLabel,
    messageId,
    added,
    removed,
    unchanged,
    failed,
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function minuteKey(date = new Date()) {
  return (
    `${date.getFullYear()}` +
    `${pad2(date.getMonth() + 1)}` +
    `${pad2(date.getDate())}` +
    `${pad2(date.getHours())}` +
    `${pad2(date.getMinutes())}`
  );
}

function parseHHMM(value) {
  const match = String(value || "")
    .trim()
    .match(/^([01]?\d|2[0-3]):([0-5]\d)$/);

  if (!match) return null;

  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
  };
}

function startAutomationRunner(client, options = {}) {
  const scanLimit =
    typeof options.scanLimit === "number"
      ? options.scanLimit
      : 300;

  const throttleMsPseudo =
    typeof options.throttleMsPseudo === "number"
      ? options.throttleMsPseudo
      : 850;

  const throttleMsCheck =
    typeof options.throttleMsCheck === "number"
      ? options.throttleMsCheck
      : 0;

  const throttleMsRappel =
    typeof options.throttleMsRappel === "number"
      ? options.throttleMsRappel
      : 0;

  const throttleMsAvertissement =
    typeof options.throttleMsAvertissement ===
    "number"
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
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const currentMinuteKey = minuteKey(now);

      const { getGuildConfig } = require(
        "../core/guildConfig"
      );

      for (const guild of client.guilds.cache.values()) {
        const config = getGuildConfig(guild.id);

        if (!config) continue;

        if (config.automations?.enabled !== true) {
          continue;
        }

        if (
          config.automations?.pseudo?.enabled === true
        ) {
          const pseudoMinute = Number.isInteger(
            config.automations.pseudo.minute
          )
            ? config.automations.pseudo.minute
            : 10;

          if (minutes === pseudoMinute) {
            const key = `${guild.id}:pseudo`;

            if (
              lastRun.get(key) !== currentMinuteKey
            ) {
              lastRun.set(key, currentMinuteKey);

              await runPseudoForGuild(guild, config, {
                scanLimit,
                throttleMs: throttleMsPseudo,
              });
            }
          }
        }

        if (
          config.automations?.checkDispo?.enabled ===
          true
        ) {
          const times = Array.isArray(
            config.automations.checkDispo.times
          )
            ? config.automations.checkDispo.times
            : [];

          for (const time of times) {
            const parsed = parseHHMM(time);

            if (!parsed) continue;

            if (
              hours === parsed.hours &&
              minutes === parsed.minutes
            ) {
              const key =
                `${guild.id}:check_dispo:${time}`;

              if (
                lastRun.get(key) !==
                currentMinuteKey
              ) {
                lastRun.set(
                  key,
                  currentMinuteKey
                );

                await runCheckDispoForGuild(
                  guild,
                  config,
                  {
                    throttleMs: throttleMsCheck,
                  }
                );
              }
            }
          }
        }

        if (
          config.automations?.rappel?.enabled === true
        ) {
          const times = Array.isArray(
            config.automations.rappel.times
          )
            ? config.automations.rappel.times
            : [];

          for (const time of times) {
            const parsed = parseHHMM(time);

            if (!parsed) continue;

            if (
              hours === parsed.hours &&
              minutes === parsed.minutes
            ) {
              const key =
                `${guild.id}:rappel_dispo:${time}`;

              if (
                lastRun.get(key) !==
                currentMinuteKey
              ) {
                lastRun.set(
                  key,
                  currentMinuteKey
                );

                await runRappelDispoForGuild(
                  guild,
                  config,
                  {
                    throttleMs:
                      throttleMsRappel,
                  }
                );
              }
            }
          }
        }

        if (
          config.automations?.avertissement
            ?.enabled === true
        ) {
          const checkTimes = Array.isArray(
            config.automations?.checkDispo?.times
          )
            ? [...config.automations.checkDispo.times]
                .map(String)
                .sort((a, b) => a.localeCompare(b))
            : [];

          const lastCheckTime =
            checkTimes.length > 0
              ? checkTimes[checkTimes.length - 1]
              : null;

          const parsed = parseHHMM(lastCheckTime);

          if (
            parsed &&
            hours === parsed.hours &&
            minutes === parsed.minutes
          ) {
            const key =
              `${guild.id}:avertissement:${lastCheckTime}`;

            if (
              lastRun.get(key) !== currentMinuteKey
            ) {
              lastRun.set(key, currentMinuteKey);

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

  const timer = setInterval(tick, loopMs);
  timer.unref?.();

  if (options.runOnStart === true) {
    tick().catch(() => {});
  }

  return () => clearInterval(timer);
}

module.exports = {
  startAutomationRunner,
  runAvertissementForGuild,
};
