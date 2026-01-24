// src/core/disposWeekButtonsHandler.js
// Gestion des boutons Dispo — CommonJS

const { PermissionFlagsBits } = require("discord.js");
const { getGuildConfig, upsertGuildConfig } = require("./guildConfig");
const { getSession, setVote, closeSession } = require("./disposWeekStore");
const { buildDayEmbed, buildStaffReportEmbed } = require("./disposWeekRenderer");
const { buildRows } = require("./disposWeekButtons");

const FLAGS_EPHEMERAL = 64;

function parseCustomId(customId) {
  const parts = String(customId).split(":");
  // dispo:<scope>:<action>:<sessionId>:<dayKey>
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

  const dayVotes = session.votes?.[dayKey] || { present: [], absent: [] };
  const responded = new Set([...(dayVotes.present || []), ...(dayVotes.absent || [])]);

  try {
    await guild.members.fetch();
  } catch {}

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
    const msg = res.reason === "CLOSED" ? "Ces dispos sont **fermées**." : "Impossible d’enregistrer ta réponse.";
    await interaction.reply({ content: msg, flags: FLAGS_EPHEMERAL }).catch(() => {});
    return;
  }

  await interaction.reply({
    content: `Réponse enregistrée : **${status === "present" ? "✅ Présent" : "❌ Absent"}** pour **${day.label}**.`,
    flags: FLAGS_EPHEMERAL,
  }).catch(() => {});

  const freshSession = getSession(interaction.guildId, session.sessionId);
  await refreshDayMessage(interaction.client, interaction.guild.name, cfg, freshSession, day);
}

async function handleStaffRemind(interaction, cfg, session, day) {
  const nonIds = await computeNonRespondingPlayers(interaction.guild, cfg, session, day.key);

  const disposChannelId = cfg.disposChannelId || session.channelId;
  const channel = await fetchTextChannel(interaction.client, disposChannelId);

  if (!channel) {
    await interaction.reply({ content: "Salon Dispos introuvable. Vérifie `/setup`.", flags: FLAGS_EPHEMERAL });
    return;
  }

  const mentions = nonIds.map((id) => `<@${id}>`);
  const content =
    `🔔 **Rappel disponibilités — ${day.label}**\n` +
    (mentions.length ? mentions.join(" ") : "Aucun non répondant (rôle Joueur).");

  await channel.send({ content }).catch(() => null);

  await interaction.reply({
    content: `Rappel envoyé dans ${channel}.`,
    flags: FLAGS_EPHEMERAL,
  }).catch(() => {});
}

async function handleStaffReport(interaction, cfg, session, day) {
  const staffChannel = await fetchTextChannel(interaction.client, cfg.staffReportsChannelId);
  if (!staffChannel) {
    await interaction.reply({
      content: "Salon Staff (rapports) non configuré. Fais `/setup`.",
      flags: FLAGS_EPHEMERAL,
    });
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

  await interaction.reply({
    content: `Rapport envoyé dans ${staffChannel}.`,
    flags: FLAGS_EPHEMERAL,
  }).catch(() => {});
}

async function handleStaffClose(interaction, cfg, session) {
  const closed = closeSession(interaction.guildId, session.sessionId, interaction.user.id);
  if (!closed) {
    await interaction.reply({ content: "Impossible de fermer la session.", flags: FLAGS_EPHEMERAL });
    return;
  }

  const fresh = getSession(interaction.guildId, session.sessionId);
  await refreshAllMessages(interaction.client, interaction.guild.name, cfg, fresh);

  await interaction.reply({
    content: "🔒 Dispos fermées. Plus personne ne peut répondre.",
    flags: FLAGS_EPHEMERAL,
  }).catch(() => {});
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

  await interaction.reply({
    content: `Automations : **${next ? "ON" : "OFF"}**.`,
    flags: FLAGS_EPHEMERAL,
  }).catch(() => {});
}

async function handleDispoButton(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Utilisable uniquement dans un serveur.", flags: FLAGS_EPHEMERAL }).catch(() => {});
    return true;
  }

  const cfg = getGuildConfig(interaction.guildId);
  if (!cfg) {
    await interaction.reply({ content: "Serveur non configuré. Lance `/setup`.", flags: FLAGS_EPHEMERAL }).catch(() => {});
    return true;
  }

  const session = getSession(interaction.guildId, parsed.sessionId);
  if (!session) {
    await interaction.reply({ content: "Session introuvable (ancienne ou supprimée).", flags: FLAGS_EPHEMERAL }).catch(() => {});
    return true;
  }

  const day = (session.days || []).find((d) => d.key === parsed.dayKey);
  if (!day) {
    await interaction.reply({ content: "Jour introuvable.", flags: FLAGS_EPHEMERAL }).catch(() => {});
    return true;
  }

  if (parsed.scope === "vote") {
    if (parsed.action === "present" || parsed.action === "absent") {
      await handleVote(interaction, cfg, session, day, parsed.action);
    }
    return true;
  }

  if (parsed.scope === "staff") {
    if (!isStaffAllowed(interaction.member, cfg)) {
      await interaction.reply({ content: "Action réservée au staff.", flags: FLAGS_EPHEMERAL }).catch(() => {});
      return true;
    }

    if (parsed.action === "remind") {
      await handleStaffRemind(interaction, cfg, session, day);
      return true;
    }
    if (parsed.action === "report") {
      await handleStaffReport(interaction, cfg, session, day);
      return true;
    }
    if (parsed.action === "close") {
      await handleStaffClose(interaction, cfg, session);
      return true;
    }
    if (parsed.action === "auto") {
      await handleStaffAutoToggle(interaction, cfg, session);
      return true;
    }
    return true;
  }

  return true;
}

module.exports = { handleDispoButton };
