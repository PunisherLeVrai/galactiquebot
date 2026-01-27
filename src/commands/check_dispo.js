// src/commands/check_dispo.js
// /check_dispo — STAFF ONLY — Embed
// Vérifie réactions ✅ / ❌ / sans réaction sur les messages Lun→Dim
// Filtre : doit avoir ≥1 rôle dans cfg.playerRoleIds

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { getGuildConfig } = require("../core/guildConfig");

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;

  const staffRoleIds = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  return staffRoleIds.some((id) => id && member.roles.cache.has(String(id)));
}

function hasAnyRoleId(member, ids) {
  const arr = Array.isArray(ids) ? ids : [];
  return arr.some((id) => id && member.roles.cache.has(String(id)));
}

function uniq(arr) {
  return Array.from(new Set(arr.map(String))).filter(Boolean);
}

function mentionList(ids, { empty = "—", max = 40 } = {}) {
  const u = uniq(ids);
  if (!u.length) return empty;

  const sliced = u.slice(0, max).map((id) => `<@${id}>`);
  const more = u.length > max ? `\n… +${u.length - max}` : "";
  return sliced.join(" ") + more;
}

async function safeFetchMessage(channel, messageId) {
  if (!channel || !messageId) return null;
  try {
    return await channel.messages.fetch(String(messageId));
  } catch {
    return null;
  }
}

async function collectReactionUserIds(message, emoji) {
  const out = new Set();
  if (!message?.reactions?.cache) return out;

  const reaction =
    message.reactions.cache.find((r) => r?.emoji?.name === emoji) ||
    message.reactions.cache.find((r) => String(r?.emoji?.toString?.()) === emoji);

  if (!reaction) return out;

  try {
    const users = await reaction.users.fetch();
    for (const u of users.values()) {
      if (!u?.id) continue;
      if (u.bot) continue;
      out.add(u.id);
    }
  } catch {}

  return out;
}

function getDispoMessageIds(cfg) {
  if (Array.isArray(cfg?.dispoMessageIds)) {
    return cfg.dispoMessageIds.slice(0, 7).map((v) => (v ? String(v) : null));
  }

  const legacy = [];
  for (let i = 0; i < 7; i++) {
    const key = `dispoMessageId_${i}`;
    legacy.push(cfg?.[key] ? String(cfg[key]) : null);
  }
  return legacy;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("check_dispo")
    .setDescription("STAFF: Vérifier les réactions (Lundi → Dimanche).")
    .setDefaultMemberPermissions(0n),

  async execute(interaction) {
    try {
      if (!interaction.inGuild())
        return interaction.reply({ content: "⛔", ephemeral: true });

      const cfg = getGuildConfig(interaction.guildId) || {};

      // STAFF ONLY
      if (!isStaff(interaction.member, cfg)) {
        return interaction.reply({ content: "⛔ Accès réservé au STAFF.", ephemeral: true });
      }

      // 🔥 NOUVEAU : checkDispoChannelId prioritaire
      const disposChannelId =
        cfg?.checkDispoChannelId && cfg.checkDispoChannelId !== "null"
          ? cfg.checkDispoChannelId
          : cfg?.disposChannelId;

      if (!disposChannelId) {
        return interaction.reply({
          content: "⚠️ Aucun salon Dispo/Check Dispo configuré. Fais /setup.",
          ephemeral: true,
        });
      }

      const messageIds = getDispoMessageIds(cfg);
      const anyId = messageIds.some((x) => x);
      if (!anyId) {
        return interaction.reply({
          content: "⚠️ Aucun ID de message Dispo configuré (Lun→Dim).",
          ephemeral: true,
        });
      }

      const channel = await interaction.guild.channels.fetch(disposChannelId).catch(() => null);
      if (!channel || !channel.isTextBased?.()) {
        return interaction.reply({
          content: "⚠️ Le salon Dispo/Check Dispo doit être un salon texte.",
          ephemeral: true,
        });
      }

      // Fetch membres
      await interaction.guild.members.fetch().catch(() => null);

      const playerRoleIds = Array.isArray(cfg?.playerRoleIds) ? cfg.playerRoleIds : [];
      if (!playerRoleIds.length) {
        return interaction.reply({
          content: "⚠️ Aucun rôle Joueur configuré dans /setup.",
          ephemeral: true,
        });
      }

      const players = interaction.guild.members.cache
        .filter((m) => m && !m.user.bot)
        .filter((m) => hasAnyRoleId(m, playerRoleIds));

      const playerIds = new Set(players.map((m) => m.user.id));

      await interaction.reply({ content: "⏳ Analyse en cours...", ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle("📊 Check Dispo (Lun → Dim)")
        .setColor(0x5865f2)
        .setDescription(
          `Salon : <#${disposChannelId}>\n` +
          `Filtre : rôles Joueurs (👟)\n` +
          `Joueurs détectés : **${playerIds.size}**`
        )
        .setFooter({ text: "XIG BLAUGRANA FC Staff" });

      // ---- Parcours semaine ----
      for (let i = 0; i < 7; i++) {
        const mid = messageIds[i];
        const dayLabel = DAYS[i];

        if (!mid) {
          embed.addFields({
            name: `📅 ${dayLabel}`,
            value: "⚠️ ID non configuré.",
            inline: false,
          });
          continue;
        }

        const msg = await safeFetchMessage(channel, mid);

        if (!msg) {
          embed.addFields({
            name: `📅 ${dayLabel}`,
            value: `⚠️ Message introuvable (ID: \`${mid}\`)`,
            inline: false,
          });
          continue;
        }

        const okSet = await collectReactionUserIds(msg, "✅");
        const noSet = await collectReactionUserIds(msg, "❌");

        const okPlayers = Array.from(okSet).filter((id) => playerIds.has(id));
        const noPlayers = Array.from(noSet).filter((id) => playerIds.has(id));

        const reacted = new Set([...okPlayers, ...noPlayers]);
        const missing = Array.from(playerIds).filter((id) => !reacted.has(id));

        const value = [
          `🟩 **Présents** (${okPlayers.length})\n${mentionList(okPlayers)}`,
          `🟥 **Absents** (${noPlayers.length})\n${mentionList(noPlayers)}`,
          `🟦 **Sans réaction** (${missing.length})\n${mentionList(missing)}`,
        ].join("\n\n");

        embed.addFields({ name: `📅 ${dayLabel}`, value, inline: false });
      }

      return interaction.editReply({ content: "✅ Terminé.", embeds: [embed] });
    } catch (e) {
      try {
        if (interaction.deferred) {
          await interaction.editReply({ content: "⚠️" });
        } else if (!interaction.replied) {
          await interaction.reply({ content: "⚠️", ephemeral: true });
        } else {
          await interaction.followUp({ content: "⚠️", ephemeral: true });
        }
      } catch {}
    }
  },
};
