// src/core/disposWeekButtonsHandler.js
// Gestion boutons Dispo — ACK bouton via deferUpdate() (anti "Échec de l'interaction")
// Confirmations en followUp éphémère (✅ ❌ 🔔 📊 🔒 ♻️ ⚙️ 🛑 ⚠️)
// Rappel (🔔) envoyé dans le salon DISPO
// + ♻️ reopen (reset votes + rouvre + réutilise les mêmes messages)

const { PermissionFlagsBits } = require("discord.js");
const { getGuildConfig, upsertGuildConfig } = require("./guildConfig");
const { getSession, setVote, closeSession, reopenSession } = require("./disposWeekStore");
const { buildDayEmbed, buildStaffReportEmbed } = require("./disposWeekRenderer");
const { buildRows } = require("./disposWeekButtons");
const { warn } = require("./logger");

/**
 * ACK robuste pour boutons:
 * - deferUpdate() = le plus fiable (accuse réception sans "répondre")
 * - fallback deferReply() si nécessaire
 */
async function safeAck(interaction) {
  try {
    if (interaction.deferred || interaction.replied) return true;
    await interaction.deferUpdate(); // ✅ ACK instant bouton
    return true;
  } catch {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
        return true;
      }
    } catch {}
    return false;
  }
}

/**
 * Message éphémère après ACK:
 * - si deferUpdate() => followUp éphémère
 * - si deferReply() => editReply
 * - sinon reply éphémère
 */
async function safeEphemeral(interaction, content) {
  try {
    if (interaction.deferred && !interaction.replied) {
      // cas deferReply() -> edit
      // cas deferUpdate() -> followUp
      // Discord ne fournit pas un flag direct, on fait un essai followUp puis fallback editReply
      try {
        await interaction.followUp({ content, ephemeral: true });
        return;
      } catch {
        await interaction.editReply({ content });
        return;
      }
    }

    if (!interaction.replied) {
      await interaction.reply({ content, ephemeral: true });
      return;
    }

    await interaction.followUp({ content, ephemeral: true });
  } catch {}
}

/**
 * Supporte 2 formats:
 * - dispo:scope:action:sessionId:dayKey  (5)
 * - dispo:scope:action:sessionId        (4) => dayKey=null (actions semaine)
 */
function parseCustomId(customId) {
  const parts = String(customId || "").split(":");
  if (parts[0] !== "dispo") return null;

  if (parts.length === 5) {
    return { scope: parts[1], action: parts[2], sessionId: parts[3], dayKey: parts[4] };
  }

  if (parts.length === 4) {
    return { scope: parts[1], action: parts[2], sessionId: parts[3], dayKey: null };
  }

  return null;
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
    await safeEphemeral(interaction, res.reason === "CLOSED" ? "🔒" : "⚠️");
    return;
  }

  await safeEphemeral(interaction, status === "present" ? "✅" : "❌");

  const freshSession = getSession(interaction.guildId, session.sessionId);
  await refreshDayMessage(interaction.client, interaction.guild.name, cfg, freshSession, day);
}

async function handleStaffRemind(interaction, cfg, session, day) {
  const nonIds = await computeNonRespondingPlayers(interaction.guild, cfg, session, day.key);

  const dispoChannel = await fetchTextChannel(interaction.client, cfg.disposChannelId || session.channelId);
  if (!dispoChannel) {
    await safeEphemeral(interaction, "⚠️");
    return;
  }

  const mentions = nonIds.map((id) => `<@${id}>`);
  const content = `🔔 **${day.label}**\n` + (mentions.length ? mentions.join(" ") : "—");

  try {
    await dispoChannel.send({ content });
  } catch (e) {
    warn("[DISPO_REMIND_SEND_ERROR]", e);
    await safeEphemeral(interaction, "⚠️");
    return;
  }

  await safeEphemeral(interaction, "🔔");
}

async function sendOneDayReport(interaction, cfg, session, day) {
  const staffChannelId = cfg.staffReportsChannelId || null;
  if (!staffChannelId) return false;

  const staffChannel = await fetchTextChannel(interaction.client, staffChannelId);
  if (!staffChannel) return false;

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

  await staffChannel.send({ embeds: [embed] });
  return true;
}

async function handleStaffReport(interaction, cfg, session, dayOrNull) {
  try {
    // jour
    if (dayOrNull) {
      const ok = await sendOneDayReport(interaction, cfg, session, dayOrNull).catch((e) => {
        warn("[DISPO_REPORT_SEND_DAY_ERROR]", e);
        return false;
      });
      await safeEphemeral(interaction, ok ? "📊" : "⚠️");
      return;
    }

    // semaine (tous les jours)
    const days = session.days || [];
    if (!days.length) {
      await safeEphemeral(interaction, "⚠️");
      return;
    }

    let sent = 0;
    for (const d of days) {
      try {
        const ok = await sendOneDayReport(interaction, cfg, session, d);
        if (ok) sent++;
      } catch (e) {
        warn("[DISPO_REPORT_SEND_ERROR]", e);
      }
    }

    await safeEphemeral(interaction, sent > 0 ? "📊" : "⚠️");
  } catch (e) {
    warn("[DISPO_REPORT_ERROR]", e);
    await safeEphemeral(interaction, "⚠️");
  }
}

async function handleStaffClose(interaction, cfg, session) {
  const closed = closeSession(interaction.guildId, session.sessionId, interaction.user.id);
  if (!closed) {
    await safeEphemeral(interaction, "⚠️");
    return;
  }

  const fresh = getSession(interaction.guildId, session.sessionId);
  await refreshAllMessages(interaction.client, interaction.guild.name, cfg, fresh);
  await safeEphemeral(interaction, "🔒");
}

async function handleStaffReopen(interaction, cfg, session) {
  const reopened = reopenSession(interaction.guildId, session.sessionId, interaction.user.id);
  if (!reopened) {
    await safeEphemeral(interaction, "⚠️");
    return;
  }

  const fresh = getSession(interaction.guildId, session.sessionId);
  await refreshAllMessages(interaction.client, interaction.guild.name, cfg, fresh);
  await safeEphemeral(interaction, "♻️");
}

async function handleStaffAutoToggle(interaction, cfg, session) {
  try {
    const current = !!cfg?.automations?.enabled;
    const next = !current;

    upsertGuildConfig(interaction.guildId, {
      automations: {
        ...(cfg.automations || {}),
        enabled: next,
      },
    });

    const freshCfg = getGuildConfig(interaction.guildId) || {};
    const freshSession = getSession(interaction.guildId, session.sessionId);

    await refreshAllMessages(interaction.client, interaction.guild.name, freshCfg, freshSession);
    await safeEphemeral(interaction, next ? "⚙️" : "🛑");
  } catch (e) {
    warn("[DISPO_AUTO_TOGGLE_ERROR]", e);
    await safeEphemeral(interaction, "⚠️");
  }
}

async function handleDispoButton(interaction) {
  // ✅ ACK avant tout
  await safeAck(interaction);

  try {
    const parsed = parseCustomId(interaction.customId);
    if (!parsed) {
      await safeEphemeral(interaction, "⚠️");
      return true;
    }

    if (!interaction.inGuild()) {
      await safeEphemeral(interaction, "⛔");
      return true;
    }

    const cfg = getGuildConfig(interaction.guildId);
    if (!cfg) {
      await safeEphemeral(interaction, "⚙️");
      return true;
    }

    const session = getSession(interaction.guildId, parsed.sessionId);
    if (!session) {
      // Ancien message après redeploy / session supprimée
      await safeEphemeral(interaction, "♻️");
      return true;
    }

    const day = parsed.dayKey ? (session.days || []).find((d) => d.key === parsed.dayKey) : null;

    if (parsed.scope === "vote") {
      if (!day) {
        await safeEphemeral(interaction, "⚠️");
        return true;
      }
      if (parsed.action === "present" || parsed.action === "absent") {
        await handleVote(interaction, cfg, session, day, parsed.action);
        return true;
      }
      await safeEphemeral(interaction, "⚠️");
      return true;
    }

    if (parsed.scope === "staff") {
      if (!isStaffAllowed(interaction.member, cfg)) {
        await safeEphemeral(interaction, "⛔");
        return true;
      }

      if (parsed.action === "remind") {
        if (!day) {
          await safeEphemeral(interaction, "⚠️");
          return true;
        }
        await handleStaffRemind(interaction, cfg, session, day);
        return true;
      }

      if (parsed.action === "report") {
        await handleStaffReport(interaction, cfg, session, day); // day null => semaine
        return true;
      }

      if (parsed.action === "close") {
        await handleStaffClose(interaction, cfg, session);
        return true;
      }

      if (parsed.action === "reopen") {
        await handleStaffReopen(interaction, cfg, session);
        return true;
      }

      if (parsed.action === "auto") {
        await handleStaffAutoToggle(interaction, cfg, session);
        return true;
      }

      await safeEphemeral(interaction, "⚠️");
      return true;
    }

    await safeEphemeral(interaction, "⚠️");
    return true;
  } catch (e) {
    warn("[DISPO_BUTTON_FATAL]", e);
    await safeEphemeral(interaction, "⚠️");
    return true;
  }
}

module.exports = { handleDispoButton };
