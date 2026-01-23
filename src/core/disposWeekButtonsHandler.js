// src/core/disposWeekButtonsHandler.js
// Handler des boutons Dispos (vote + staff actions)
// CommonJS — discord.js v14

const { PermissionFlagsBits } = require("discord.js");

const { getGuildConfig, setGuildConfig, isStaff } = require("./guildConfig");
const { getSession, setVote, closeSession } = require("./disposWeekStore");
const { buildDayEmbed, buildStaffReportEmbed } = require("./disposWeekRenderer");
const { buildRows } = require("./disposWeekButtons");

const FLAGS_EPHEMERAL = 64;

function parseCustomId(customId) {
  // dispo:<scope>:<action>:<sessionId>:<dayKey>
  const parts = String(customId).split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== "dispo") return null;

  const scope = parts[1];   // vote | staff
  const action = parts[2];  // present|absent|remind|report|close|auto
  const sessionId = parts[3];
  const dayKey = parts[4];

  return { scope, action, sessionId, dayKey };
}

async function fetchTextChannel(client, channelId) {
  if (!channelId) return null;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) return null;
  // GuildText / Thread etc. : on se contente d'un .send + messages.fetch
  if (typeof ch.send !== "function") return null;
  return ch;
}

async function safeFetchMessage(channel, messageId) {
  if (!channel || !messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function refreshDayMessage(client, guildName, cfg, session, day) {
  if (!day?.messageId) return;

  const channel = await fetchTextChannel(client, session.channelId);
  if (!channel) return;

  const msg = await safeFetchMessage(channel, day.messageId);
  if (!msg) return;

  const embed = buildDayEmbed({
    guildName: guildName || "Serveur",
    session,
    day,
    brandTitle: "Disponibilités",
  });

  const rows = buildRows({
    sessionId: session.sessionId,
    dayKey: day.key,
    closed: session.closed,
    automationsEnabled: cfg.automationsEnabled,
  });

  await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
}

async function refreshAllMessages(client, guildName, cfg, session) {
  for (const day of session.days || []) {
    await refreshDayMessage(client, guildName, cfg, session, day);
  }
}

/**
 * Calcule les non répondants (rôle Joueur uniquement) pour un dayKey
 */
async function computeNonRespondingPlayers(interaction, cfg, session, dayKey) {
  if (!cfg.playerRoleId) return [];

  const dayVotes = session.votes?.[dayKey] || { present: [], absent: [] };
  const responded = new Set([...(dayVotes.present || []), ...(dayVotes.absent || [])]);

  // Pour être sûr d'avoir le cache membres
  try {
    await interaction.guild.members.fetch();
  } catch {}

  const players = interaction.guild.members.cache.filter((m) => m.roles.cache.has(cfg.playerRoleId));
  const non = [];
  for (const m of players.values()) {
    if (!responded.has(m.user.id)) non.push(m.user.id);
  }
  return non; // array userId
}

function isStaffAllowed(interaction, cfg) {
  return (
    isStaff(interaction.member, cfg) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    false
  );
}

async function handleVote(interaction, cfg, session, day, status) {
  const res = setVote(interaction.guildId, session.sessionId, day.key, interaction.user.id, status);

  if (!res.ok) {
    const msg =
      res.reason === "CLOSED"
        ? "Ces disponibilités sont **fermées**."
        : "Impossible d’enregistrer ta réponse.";
    await interaction.reply({ content: msg, flags: FLAGS_EPHEMERAL }).catch(() => {});
    return;
  }

  // Confirmation éphémère pour la personne
  const label = status === "present" ? "✅ Présent" : "❌ Absent";
  await interaction.reply({
    content: `Réponse enregistrée : **${label}** pour **${day.label}**.`,
    flags: FLAGS_EPHEMERAL,
  }).catch(() => {});

  // Rafraîchit l'embed (compteurs)
  const freshSession = getSession(interaction.guildId, session.sessionId);
  await refreshDayMessage(interaction.client, interaction.guild?.name, cfg, freshSession, day);
}

async function handleStaffRemind(interaction, cfg, session, day) {
  const nonIds = await computeNonRespondingPlayers(interaction, cfg, session, day.key);

  // Mention dans le salon dispos (comme tu l'as demandé)
  const disposChannel = await fetchTextChannel(interaction.client, cfg.disposChannelId || session.channelId);
  if (!disposChannel) {
    await interaction.reply({
      content: "Salon Dispos introuvable. Vérifie `/setup`.",
      flags: FLAGS_EPHEMERAL,
    });
    return;
  }

  const mentions = nonIds.map((id) => `<@${id}>`);
  const content =
    `🔔 **Rappel disponibilités — ${day.label}**\n` +
    (mentions.length ? mentions.join(" ") : "Aucun non répondant (rôle Joueur).");

  // Envoi dans dispos
  await disposChannel.send({ content }).catch(() => null);

  await interaction.reply({
    content: `Rappel envoyé dans ${disposChannel}.`,
    flags: FLAGS_EPHEMERAL,
  }).catch(() => {});
}

async function handleStaffReport(interaction, cfg, session, day) {
  // Rapport staff dans le salon reportChannelId
  const reportChannel = await fetchTextChannel(interaction.client, cfg.reportChannelId);
  if (!reportChannel) {
    await interaction.reply({
      content: "Salon Staff (reportChannelId) non configuré. Fais `/setup` et définis-le.",
      flags: FLAGS_EPHEMERAL,
    });
    return;
  }

  const dayVotes = session.votes?.[day.key] || { present: [], absent: [] };
  const presentIds = dayVotes.present || [];
  const absentIds = dayVotes.absent || [];
  const nonIds = await computeNonRespondingPlayers(interaction, cfg, session, day.key);

  const embed = buildStaffReportEmbed({
    guildName: interaction.guild.name,
    session,
    day,
    presentIds,
    absentIds,
    nonRespondingPlayerIds: nonIds,
  });

  await reportChannel.send({ embeds: [embed] }).catch(() => null);

  await interaction.reply({
    content: `Rapport envoyé dans ${reportChannel}.`,
    flags: FLAGS_EPHEMERAL,
  }).catch(() => {});
}

async function handleStaffClose(interaction, cfg, session) {
  const closed = closeSession(interaction.guildId, session.sessionId, interaction.user.id);
  if (!closed) {
    await interaction.reply({ content: "Impossible de fermer la session.", flags: FLAGS_EPHEMERAL }).catch(() => {});
    return;
  }

  // refresh tous les messages (désactive les votes)
  const fresh = getSession(interaction.guildId, session.sessionId);
  await refreshAllMessages(interaction.client, interaction.guild?.name, cfg, fresh);

  await interaction.reply({
    content: "🔒 Dispos fermées. Plus personne ne peut répondre.",
    flags: FLAGS_EPHEMERAL,
  }).catch(() => {});
}

async function handleStaffAutoToggle(interaction, cfg, session) {
  const newValue = !cfg.automationsEnabled;

  setGuildConfig(interaction.guildId, { automationsEnabled: newValue });

  // refresh boutons
  const freshCfg = getGuildConfig(interaction.guildId);
  const freshSession = getSession(interaction.guildId, session.sessionId);
  await refreshAllMessages(interaction.client, interaction.guild?.name, freshCfg, freshSession);

  await interaction.reply({
    content: `Automations : **${newValue ? "ON" : "OFF"}**.`,
    flags: FLAGS_EPHEMERAL,
  }).catch(() => {});
}

async function handleDispoButton(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Commande utilisable uniquement dans un serveur.", flags: FLAGS_EPHEMERAL }).catch(() => {});
    return true;
  }

  const cfg = getGuildConfig(interaction.guildId);
  if (!cfg) {
    await interaction.reply({ content: "Serveur non configuré. Lance `/setup`.", flags: FLAGS_EPHEMERAL }).catch(() => {});
    return true;
  }

  const session = getSession(interaction.guildId, parsed.sessionId);
  if (!session) {
    await interaction.reply({ content: "Session introuvable (probablement ancienne).", flags: FLAGS_EPHEMERAL }).catch(() => {});
    return true;
  }

  const day = session.days.find((d) => d.key === parsed.dayKey);
  if (!day) {
    await interaction.reply({ content: "Jour introuvable.", flags: FLAGS_EPHEMERAL }).catch(() => {});
    return true;
  }

  // Votes (public)
  if (parsed.scope === "vote") {
    if (parsed.action === "present" || parsed.action === "absent") {
      await handleVote(interaction, cfg, session, day, parsed.action);
      return true;
    }
    return true;
  }

  // Staff actions
  if (parsed.scope === "staff") {
    if (!isStaffAllowed(interaction, cfg)) {
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

module.exports = {
  handleDispoButton,
};
