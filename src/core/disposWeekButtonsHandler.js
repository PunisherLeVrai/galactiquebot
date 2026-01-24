// src/core/disposWeekButtonsHandler.js
// Gestion boutons Dispo — ACK immédiat (fix "Échec de l'interaction")
// Rappel (🔔) envoyé dans le salon DISPO (cfg.disposChannelId)
// CommonJS — discord.js v14

const { PermissionFlagsBits } = require("discord.js");
const { getGuildConfig, upsertGuildConfig } = require("./guildConfig");
const { getSession, setVote, closeSession } = require("./disposWeekStore");
const { buildDayEmbed, buildStaffReportEmbed } = require("./disposWeekRenderer");
const { buildRows } = require("./disposWeekButtons");

async function safeDefer(interaction) {
  try {
    if (interaction.deferred || interaction.replied) return;
    await interaction.deferReply({ ephemeral: true }); // ✅ ACK instant
  } catch {}
}

async function safeReply(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  } catch {}
}

function parseCustomId(customId) {
  const parts = String(customId).split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== "dispo") return null;
  return { scope: parts[1], action: parts[2], sessionId: parts[3], dayKey: parts[4] };
}

function isStaffAllowed(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (cfg?.staffRoleId && member.roles?.cache?.has(cfg.staffRoleId)) return true;
  return false;
}

async function fetchTextChannel(client, channelId) {
  if (!channelId) return null;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || typeof ch.send !== "function") return null;
  return ch;
}

async function safeFetchMessage(channel, messageId) {
  if (!channel || !messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function refreshDayMessage(client, guildName, cfg, session, day) {
  const channel = await fetchTextChannel(client, session.channelId);
  if (!channel) return;

  const msg = await safeFetchMessage(channel, day.messageId);
  if (!msg) return;

  const embed = buildDayEmbed({ guildName, session, day });
  const rows = buildRows({
    sessionId: session.sessionId,
    dayKey: day.key,
    closed: session.closed,
    automationsEnabled: !!cfg?.automations?.enabled,
  });

  await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
}

async function refreshAllMessages(client, guildName, cfg, session) {
  for (const day of session.days || []) {
    if (!day.messageId) continue;
    await refreshDayMessage(client, guildName, cfg, session, day);
  }
}

async function computeNonRespondingPlayers(guild, cfg, session, dayKey) {
  if (!cfg?.playerRoleId) return [];

  // ⚠️ peut être long -> defer déjà fait
  try {
    await guild.members.fetch();
  } catch {}

  const dayVotes = session.votes?.[dayKey] || { present: [], absent: [] };
  const responded = new Set([...(dayVotes.present || []), ...(dayVotes.absent || [])]);

  const players = guild.members.cache.filter((m) => m.roles.cache.has(cfg.playerRoleId));
  const non = [];
  for (const m of players.values()) {
    if (!responded.has(m.user.id)) non.push(m.user.id);
  }
  return non;
}

async function handleVote(interaction, cfg, session, day, status) {
  const res = setVote(interaction.guildId, session.sessionId, day.key, interaction.user.id, status);

  if (!res.ok) {
    await safeReply(interaction, res.reason === "CLOSED" ? "🔒" : "⚠️");
    return;
  }

  await safeReply(interaction, status === "present" ? "✅" : "❌");

  const freshSession = getSession(interaction.guildId, session.sessionId);
  await refreshDayMessage(interaction.client, interaction.guild.name, cfg, freshSession, day);
}

async function handleStaffRemind(interaction, cfg, session, day) {
  const nonIds = await computeNonRespondingPlayers(interaction.guild, cfg, session, day.key);

  // ✅ rappel dans salon DISPO
  const dispoChannel = await fetchTextChannel(interaction.client, cfg.disposChannelId || session.channelId);
  if (!dispoChannel) {
    await safeReply(interaction, "⚠️");
    return;
  }

  const mentions = nonIds.map((id) => `<@${id}>`);
  const content =
    `🔔 **${day.label}**\n` +
    (mentions.length ? mentions.join(" ") : "—");

  await dispoChannel.send({ content }).catch(() => null);
  await safeReply(interaction, "🔔");
}

async function handleStaffReport(interaction, cfg, session, day) {
  const staffChannel = await fetchTextChannel(interaction.client, cfg.staffReportsChannelId);
  if (!staffChannel) {
    await safeReply(interaction, "📊");
    return;
  }

  const dayVotes = session.votes?.[day.key] || { present: [], absent: [] };
  const presentIds = dayVotes.present || [];
  const absentIds = dayVotes.absent || [];
  const nonIds = await computeNonRespondingPlayers(interaction.guild, cfg, session, day.key);

  const embed = buildStaffReportEmbed({
    guildName: interaction.guild.name,
    session,
    day,
    presentIds,
    absentIds,
    nonRespondingPlayerIds: nonIds,
  });

  await staffChannel.send({ embeds: [embed] }).catch(() => null);
  await safeReply(interaction, "📊");
}

async function handleStaffClose(interaction, cfg, session) {
  const closed = closeSession(interaction.guildId, session.sessionId, interaction.user.id);
  if (!closed) {
    await safeReply(interaction, "⚠️");
    return;
  }

  const fresh = getSession(interaction.guildId, session.sessionId);
  await refreshAllMessages(interaction.client, interaction.guild.name, cfg, fresh);
  await safeReply(interaction, "🔒");
}

async function handleStaffAutoToggle(interaction, cfg, session) {
  const current = !!cfg?.automations?.enabled;
  const next = !current;

  const patch = {
    automations: {
      ...(cfg.automations || {}),
      enabled: next,
    },
  };

  upsertGuildConfig(interaction.guildId, patch);

  const freshCfg = getGuildConfig(interaction.guildId) || {};
  const freshSession = getSession(interaction.guildId, session.sessionId);

  await refreshAllMessages(interaction.client, interaction.guild.name, freshCfg, freshSession);
  await safeReply(interaction, next ? "⚙️" : "🛑");
}

async function handleDispoButton(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  if (!interaction.inGuild()) {
    await safeReply(interaction, "⛔");
    return true;
  }

  // ✅ ACK immédiat
  await safeDefer(interaction);

  const cfg = getGuildConfig(interaction.guildId);
  if (!cfg) {
    await safeReply(interaction, "⚙️");
    return true;
  }

  const session = getSession(interaction.guildId, parsed.sessionId);
  if (!session) {
    await safeReply(interaction, "⚠️");
    return true;
  }

  const day = (session.days || []).find((d) => d.key === parsed.dayKey);
  if (!day) {
    await safeReply(interaction, "⚠️");
    return true;
  }

  if (parsed.scope === "vote") {
    if (parsed.action === "present" || parsed.action === "absent") {
      await handleVote(interaction, cfg, session, day, parsed.action);
      return true;
    }
    await safeReply(interaction, "⚠️");
    return true;
  }

  if (parsed.scope === "staff") {
    if (!isStaffAllowed(interaction.member, cfg)) {
      await safeReply(interaction, "⛔");
      return true;
    }

    if (parsed.action === "remind") return (await handleStaffRemind(interaction, cfg, session, day), true);
    if (parsed.action === "report") return (await handleStaffReport(interaction, cfg, session, day), true);
    if (parsed.action === "close") return (await handleStaffClose(interaction, cfg, session), true);
    if (parsed.action === "auto") return (await handleStaffAutoToggle(interaction, cfg, session), true);

    await safeReply(interaction, "⚠️");
    return true;
  }

  await safeReply(interaction, "⚠️");
  return true;
}

module.exports = { handleDispoButton };
