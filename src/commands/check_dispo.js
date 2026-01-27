// src/commands/check_dispo.js
// /check_dispo — STAFF ONLY — NON EPHEMERE — Embed
// Vérifie réactions sur 1 jour choisi (obligatoire)
// Filtre : doit avoir ≥1 rôle dans cfg.playerRoleIds

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { getGuildConfig } = require("../core/guildConfig");

// Index -> Jour
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

async function collectReactionUserIds(message, emojiName) {
  const out = new Set();
  if (!message?.reactions?.cache) return out;

  // recherche unicode ou custom
  const reaction =
    message.reactions.cache.find((r) => r?.emoji?.name === emojiName) ||
    message.reactions.cache.find((r) => r.emoji.toString?.() === emojiName);

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

  // fallback (ancien format)
  const legacy = [];
  for (let i = 0; i < 7; i++) {
    legacy.push(cfg?.[`dispoMessageId_${i}`] ? String(cfg[`dispoMessageId_${i}`]) : null);
  }
  return legacy;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("check_dispo")
    .setDescription("STAFF: Vérifier les réactions sur 1 jour (obligatoire).")
    .addIntegerOption((opt) =>
      opt
        .setName("jour")
        .setDescription("Jour à analyser")
        .setRequired(true)
        .addChoices(
          { name: "Lundi", value: 0 },
          { name: "Mardi", value: 1 },
          { name: "Mercredi", value: 2 },
          { name: "Jeudi", value: 3 },
          { name: "Vendredi", value: 4 },
          { name: "Samedi", value: 5 },
          { name: "Dimanche", value: 6 }
        )
    )
    .setDefaultMemberPermissions(0n),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply("⛔");

      const cfg = getGuildConfig(interaction.guildId) || {};

      // STAFF ONLY
      if (!isStaff(interaction.member, cfg)) {
        return interaction.reply("⛔ Accès réservé au STAFF.");
      }

      // salon dispo
      const disposChannelId =
        cfg?.checkDispoChannelId && cfg.checkDispoChannelId !== "null"
          ? cfg.checkDispoChannelId
          : cfg?.disposChannelId;

      if (!disposChannelId) {
        return interaction.reply("⚠️ Aucun salon configuré dans /setup.");
      }

      const messageIds = getDispoMessageIds(cfg);
      const anyId = messageIds.some((x) => x);
      if (!anyId) {
        return interaction.reply("⚠️ Aucun ID de message Dispo configuré (Lun→Dim).");
      }

      const channel = await interaction.guild.channels.fetch(disposChannelId).catch(() => null);
      if (!channel || !channel.isTextBased?.()) {
        return interaction.reply("⚠️ Le salon Dispo/Check Dispo doit être un salon texte.");
      }

      // fetch membres
      await interaction.guild.members.fetch().catch(() => null);

      const playerRoleIds = Array.isArray(cfg?.playerRoleIds) ? cfg.playerRoleIds : [];
      if (!playerRoleIds.length) {
        return interaction.reply("⚠️ Aucun rôle Joueur configuré dans /setup.");
      }

      const players = interaction.guild.members.cache
        .filter((m) => m && !m.user.bot)
        .filter((m) => hasAnyRoleId(m, playerRoleIds));

      const playerIds = new Set(players.map((m) => m.user.id));

      const dayIndex = interaction.options.getInteger("jour");
      const dayLabel = DAYS[dayIndex];
      const mid = messageIds[dayIndex];

      await interaction.reply("⏳ Analyse en cours...");

      // message manquant
      if (!mid) {
        const embed = new EmbedBuilder()
          .setTitle(`📊 Check Dispo — ${dayLabel}`)
          .setColor(0x5865f2)
          .setDescription(
            `Salon : <#${disposChannelId}>\n` +
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
            `Joueurs détectés : **${playerIds.size}**\n\n` +
            `⚠️ Message introuvable (ID: \`${mid}\`).`
          )
          .setFooter({ text: "XIG BLAUGRANA FC Staff" });

        return interaction.editReply({ content: "✅ Terminé.", embeds: [embed] });
      }

      // réactions
      const ok = await collectReactionUserIds(msg, "✅");
      const no = await collectReactionUserIds(msg, "❌");

      const okPlayers = Array.from(ok).filter((id) => playerIds.has(id));
      const noPlayers = Array.from(no).filter((id) => playerIds.has(id));

      const reacted = new Set([...okPlayers, ...noPlayers]);
      const missing = Array.from(playerIds).filter((id) => !reacted.has(id));

      // embed final
      const embed = new EmbedBuilder()
        .setTitle(`📊 Check Dispo — ${dayLabel}`)
        .setColor(0x5865f2)
        .setDescription(
          `Salon : <#${disposChannelId}>\n` +
          `Message : \`${mid}\`\n` +
          `Joueurs détectés : **${playerIds.size}**`
        )
        .addFields(
          { name: `🟩 Présents (${okPlayers.length})`, value: mentionList(okPlayers) },
          { name: `🟥 Absents (${noPlayers.length})`, value: mentionList(noPlayers) },
          { name: `🟦 Sans réaction (${missing.length})`, value: mentionList(missing) }
        )
        .setFooter({ text: "XIG BLAUGRANA FC Staff" });

      return interaction.editReply({ content: "✅ Terminé.", embeds: [embed] });

    } catch (e) {
      try {
        if (interaction.replied) {
          await interaction.followUp("⚠️ Erreur inconnue.");
        } else {
          await interaction.reply("⚠️ Erreur inconnue.");
        }
      } catch {}
    }
  },
};
