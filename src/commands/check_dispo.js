// src/commands/check_dispo.js
// /check_dispo — STAFF ONLY — NON EPHEMERE — Embed
// Vérifie réactions ✅ / ❌ / sans réaction sur UN jour choisi (obligatoire)
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
  return Array.from(new Set((arr || []).map(String))).filter(Boolean);
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

  // fallback legacy
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
    .setDescription("STAFF: Vérifier les réactions pour un jour (obligatoire).")
    .addStringOption((opt) =>
      opt
        .setName("jour")
        .setDescription("Choisir le jour à analyser.")
        .setRequired(true)
        .addChoices(
          { name: "Lundi", value: "0" },
          { name: "Mardi", value: "1" },
          { name: "Mercredi", value: "2" },
          { name: "Jeudi", value: "3" },
          { name: "Vendredi", value: "4" },
          { name: "Samedi", value: "5" },
          { name: "Dimanche", value: "6" }
        )
    )
    .setDefaultMemberPermissions(0n),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: "⛔" });

      const cfg = getGuildConfig(interaction.guildId) || {};

      // STAFF ONLY
      if (!isStaff(interaction.member, cfg)) {
        return interaction.reply({ content: "⛔ Accès réservé au STAFF." });
      }

      // Salon : checkDispoChannelId prioritaire
      const disposChannelId =
        cfg?.checkDispoChannelId && cfg.checkDispoChannelId !== "null"
          ? cfg.checkDispoChannelId
          : cfg?.disposChannelId;

      if (!disposChannelId) {
        return interaction.reply({ content: "⚠️ Aucun salon Dispo/Check Dispo configuré. Fais /setup." });
      }

      const messageIds = getDispoMessageIds(cfg);
      const anyId = messageIds.some((x) => x);
      if (!anyId) {
        return interaction.reply({ content: "⚠️ Aucun ID de message Dispo configuré (Lun→Dim)." });
      }

      const channel = await interaction.guild.channels.fetch(disposChannelId).catch(() => null);
      if (!channel || !channel.isTextBased?.()) {
        return interaction.reply({ content: "⚠️ Le salon Dispo/Check Dispo doit être un salon texte." });
      }

      // Fetch membres
      await interaction.guild.members.fetch().catch(() => null);

      const playerRoleIds = Array.isArray(cfg?.playerRoleIds) ? cfg.playerRoleIds : [];
      if (!playerRoleIds.length) {
        return interaction.reply({ content: "⚠️ Aucun rôle Joueur configuré (👟) dans /setup." });
      }

      const players = interaction.guild.members.cache
        .filter((m) => m && !m.user.bot)
        .filter((m) => hasAnyRoleId(m, playerRoleIds));

      const playerIds = new Set(players.map((m) => m.user.id));

      const dayIndex = Number(interaction.options.getString("jour"));
      if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
        return interaction.reply({ content: "⚠️ Jour invalide." });
      }

      const dayLabel = DAYS[dayIndex];
      const mid = messageIds[dayIndex];

      // NON EPHEMERE
      await interaction.reply({ content: "⏳ Analyse en cours..." });

      if (!mid) {
        const embed = new EmbedBuilder()
          .setTitle(`📊 Check Dispo — ${dayLabel}`)
          .setColor(0x5865f2)
          .setDescription(
            `Salon : <#${disposChannelId}>\n` +
              `Filtre : rôles Joueurs (👟)\n` +
              `Joueurs détectés : **${playerIds.size}**\n\n` +
              `⚠️ ID du message non configuré pour ce jour.`
          )
          .setFooter({ text: "XIG BLAUGRANA FC Staff" });

        return interaction.editReply({ content: "✅ Terminé.", embeds: [embed] });
      }

      const msg = await safeFetchMessage(channel, mid);
      if (!msg) {
        const embed = new EmbedBuilder()
          .setTitle(`📊 Check Dispo — ${dayLabel}`)
          .setColor(0x5865f2)
          .setDescription(
            `Salon : <#${disposChannelId}>\n` +
              `Filtre : rôles Joueurs (👟)\n` +
              `Joueurs détectés : **${playerIds.size}**\n\n` +
              `⚠️ Message introuvable (ID: \`${mid}\`).`
          )
          .setFooter({ text: "XIG BLAUGRANA FC Staff" });

        return interaction.editReply({ content: "✅ Terminé.", embeds: [embed] });
      }

      const okSet = await collectReactionUserIds(msg, "✅");
      const noSet = await collectReactionUserIds(msg, "❌");

      const okPlayers = Array.from(okSet).filter((id) => playerIds.has(id));
      const noPlayers = Array.from(noSet).filter((id) => playerIds.has(id));

      const reacted = new Set([...okPlayers, ...noPlayers]);
      const missing = Array.from(playerIds).filter((id) => !reacted.has(id));

      const embed = new EmbedBuilder()
        .setTitle(`📊 Check Dispo — ${dayLabel}`)
        .setColor(0x5865f2)
        .setDescription(
          `Salon : <#${disposChannelId}>\n` +
            `Message : \`${mid}\`\n` +
            `Filtre : rôles Joueurs (👟)\n` +
            `Joueurs détectés : **${playerIds.size}**`
        )
        .addFields(
          { name: `🟩 ✅ Présents (${okPlayers.length})`, value: mentionList(okPlayers), inline: false },
          { name: `🟥 ❌ Absents (${noPlayers.length})`, value: mentionList(noPlayers), inline: false },
          { name: `🟦 ⏳ Sans réaction (${missing.length})`, value: mentionList(missing), inline: false }
        )
        .setFooter({ text: "XIG BLAUGRANA FC Staff" });

      return interaction.editReply({ content: "✅ Terminé.", embeds: [embed] });
    } catch {
      try {
        if (interaction.deferred) {
          await interaction.editReply({ content: "⚠️" }).catch(() => {});
        } else if (!interaction.replied) {
          await interaction.reply({ content: "⚠️" }).catch(() => {});
        } else {
          await interaction.followUp({ content: "⚠️" }).catch(() => {});
        }
      } catch {}
    }
  },
};
