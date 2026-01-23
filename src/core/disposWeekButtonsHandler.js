// src/core/disposWeekButtonsHandler.js
const { PermissionFlagsBits } = require("discord.js");
const { getGuildConfig, isStaff } = require("./guildConfig");
const { getSession, setVote, closeSession } = require("./disposWeekStore");
const { buildDayEmbed, buildStaffReportEmbed } = require("./disposWeekRenderer");
const { buildRows } = require("./disposWeekButtons");
const { setGuildConfig } = require("./guildConfig");

const FLAGS_EPHEMERAL = 64;

async function computeNonRespondingPlayers(interaction, cfg, session, dayKey) {
  if (!cfg.playerRoleId) return [];

  const guild = interaction.guild;
  try { await guild.members.fetch(); } catch {}

  const dayVotes = session.votes?.[dayKey] || { present: [], absent: [] };
  const responded = new Set([...(dayVotes.present || []), ...(dayVotes.absent || [])]);

  const players = guild.members.cache.filter((m) => m.roles.cache.has(cfg.playerRoleId));
  const non = [];
  for (const m of players.values()) {
    if (!responded.has(m.user.id)) non.push(m);
  }
  return non;
}

function parseCustomId(customId) {
  // dispo:<type>:<action>:<sessionId>:<dayKey>
  const parts = customId.split(":");
  if (parts.length < 5) return null;
  if (parts[0] !== "dispo") return null;
  return {
    scope: parts[1],   // vote | staff
    action: parts[2],  // present|absent|remind|report|close|auto
    sessionId: parts[3],
    dayKey: parts[4],
  };
}

async function refreshDayMessage(client, guildId, cfg, session, day) {
  if (!day.messageId) return;
  const channel = await client.channels.fetch(session.channelId).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(day.messageId).catch(() => null);
  if (!msg) return;

  const embed = buildDayEmbed({
    guildName: msg.guild?.name || "Serveur",
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

async function handleDispoButton(interaction) {
  const data = parseCustomId(interaction.customId);
  if (!data) return false;

  const cfg = getGuildConfig(interaction.guildId);
  if (!cfg) {
    await interaction.reply({ content: "Serveur non configuré. Lance `/setup`.", flags: FLAGS_EPHEMERAL }).catch(() => {});
    return true;
  }

  const session = getSession(interaction.guildId, data.sessionId);
  if (!session) {
    await interaction.reply({ content: "Session introuvable (probablement ancienne).", flags: FLAGS_EPHEMERAL }).catch(() => {});
    return true;
  }

  const day = session.days.find((d) => d.key === data.dayKey);
  if (!day) {
    await interaction.reply({ content: "Jour introuvable.", flags: FLAGS_EPHEMERAL }).catch(() => {});
    return true;
  }

  // VOTE
  if (data.scope === "vote") {
    const status = data.action; // present | absent
    const res = setVote(interaction.guildId, session.sessionId, day.key, interaction.user.id, status);
    if (!res.ok) {
      const msg = res.reason === "CLOSED" ? "Ces dispos sont fermées." : "Impossible d’enregistrer ta réponse.";
      await interaction.reply({ content: msg, flags: FLAGS_EPHEMERAL }).catch(() => {});
      return true;
    }

    // Confirmation éphémère (pour la personne)
    const label = status === "present" ? "✅ Présent" : "❌ Absent";
    await interaction.reply({ content: `Réponse enregistrée : **${label}** pour **${day.label}**.`, flags: FLAGS_EPHEMERAL }).catch(() => {});

    // Refresh le message pour mettre à jour les compteurs
    const fresh = getSession(interaction.guildId, session.sessionId);
    await refreshDayMessage(interaction.client, interaction.guildId, cfg, fresh, day);
    return true;
  }

  // STAFF ACTIONS
  if (data.scope === "staff") {
    const staffOk =
      isStaff(interaction.member, cfg) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

    if (!staffOk) {
      await interaction.reply({ content: "Action réservée au staff.", flags: FLAGS_EPHEMERAL }).catch(() => {});
      return true;
    }

    // Rappel (liste non répondants joueurs) — staff-only
    if (data.action === "remind") {
      const non = await computeNonRespondingPlayers(interaction, cfg, session, day.key);
      const mentions = non.map((m) => `<@${m.user.id}>`);
      await interaction.reply({
        content:
          `Rappel (non répondants **Joueurs**) — **${day.label}** :\n` +
          (mentions.length ? mentions.join(" ") : "—"),
        flags: FLAGS_EPHEMERAL,
      });
      return true;
    }

    // Rapport — staff-only (éphémère)
    if (data.action === "report") {
      const non = await computeNonRespondingPlayers(interaction, cfg, session, day.key);
      const nonMentions = non.map((m) => `<@${m.user.id}>`);

      const embed = buildStaffReportEmbed({
        guildName: interaction.guild.name,
        session,
        day,
        playersNonRespondingMentions: nonMentions,
      });

      await interaction.reply({ embeds: [embed], flags: FLAGS_EPHEMERAL }).catch(() => {});
      return true;
    }

    // Fermer — staff-only
    if (data.action === "close") {
      closeSession(interaction.guildId, session.sessionId, interaction.user.id);

      // refresh tous les jours/messages
      const fresh = getSession(interaction.guildId, session.sessionId);
      for (const d of fresh.days) {
        await refreshDayMessage(interaction.client, interaction.guildId, cfg, fresh, d);
      }

      await interaction.reply({ content: "Dispos fermées. Plus personne ne peut répondre.", flags: FLAGS_EPHEMERAL }).catch(() => {});
      return true;
    }

    // Automations toggle — staff-only
    if (data.action === "auto") {
      const newValue = !cfg.automationsEnabled;
      setGuildConfig(interaction.guildId, { automationsEnabled: newValue });

      // refresh tous les messages pour mettre à jour le label ON/OFF
      const freshCfg = getGuildConfig(interaction.guildId);
      const fresh = getSession(interaction.guildId, session.sessionId);
      for (const d of fresh.days) {
        await refreshDayMessage(interaction.client, interaction.guildId, freshCfg, fresh, d);
      }

      await interaction.reply({
        content: `Automations : **${newValue ? "ON" : "OFF"}**.\n` +
          (newValue && !freshCfg.reportChannelId
            ? "Note : définis un **reportChannelId** (salon staff) si tu veux des rapports automatiques staff-only."
            : ""),
        flags: FLAGS_EPHEMERAL,
      }).catch(() => {});
      return true;
    }
  }

  return true;
}

module.exports = { handleDispoButton };
