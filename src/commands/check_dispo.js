// src/commands/check_dispo.js
// /check_dispo — STAFF ONLY — NON EPHEMERE — Embed
// Vérifie réactions sur 1 jour choisi (obligatoire)
//
// ✅ Présents/Absents = TOUS ceux qui ont réagi ✅ / ❌ (sans filtre rôle)
// ✅ Sans réaction = UNIQUEMENT les membres avec ≥1 rôle dans cfg.playerRoleIds
//
// 🔒 Renforcement MAX des réactions / fetch (même logique que runner.js):
// - Fetch message via channel.messages.fetch(id)
// - Re-fetch du message via msg.fetch() avant lecture
// - Tentative message.reactions.fetch() si dispo (cache vide / incomplet)
// - Recherche réaction par emoji.name OU emoji.toString()
// - Fetch users via reaction.users.fetch() (source de vérité)
// - Si réactions indisponibles: embed explicite + hints permissions/intents

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

// --------------------
// 🔒 Message / Reactions hardening
// --------------------
async function safeFetchMessage(channel, messageId) {
  if (!channel || !messageId) return null;
  try {
    return await channel.messages.fetch(String(messageId));
  } catch {
    return null;
  }
}

async function ensureFreshMessage(msg) {
  if (!msg) return null;
  try {
    const fresh = await msg.fetch().catch(() => null);
    return fresh || msg;
  } catch {
    return msg;
  }
}

function findReactionInCache(message, emojiName) {
  if (!message?.reactions?.cache) return null;

  return (
    message.reactions.cache.find((r) => r?.emoji?.name === emojiName) ||
    message.reactions.cache.find((r) => r?.emoji?.toString?.() === emojiName)
  );
}

async function tryFetchReactions(message) {
  try {
    if (message?.reactions?.fetch) {
      await message.reactions.fetch().catch(() => null);
    }
  } catch {}
}

async function collectReactionUserIdsStrong(message, emojiName) {
  const out = new Set();

  if (!message) return { ok: false, reason: "no_message", users: out };

  const fresh = await ensureFreshMessage(message);

  const cacheSize = fresh?.reactions?.cache?.size ?? 0;
  if (cacheSize === 0) await tryFetchReactions(fresh);

  let reaction = findReactionInCache(fresh, emojiName);

  if (!reaction) {
    await tryFetchReactions(fresh);
    reaction = findReactionInCache(fresh, emojiName);
  }

  if (!reaction) {
    const finalCacheSize = fresh?.reactions?.cache?.size ?? 0;
    if (finalCacheSize === 0) return { ok: false, reason: "reactions_unavailable", users: out };
    return { ok: true, reason: "emoji_not_found", users: out };
  }

  try {
    const users = await reaction.users.fetch().catch(() => null);
    if (!users) return { ok: false, reason: "users_fetch_failed", users: out };

    for (const u of users.values()) {
      if (!u?.id) continue;
      if (u.bot) continue;
      out.add(u.id);
    }
  } catch {
    return { ok: false, reason: "users_fetch_threw", users: out };
  }

  return { ok: true, reason: "ok", users: out };
}

// --------------------
// Config helpers
// --------------------
function getDispoMessageIds(cfg) {
  if (Array.isArray(cfg?.dispoMessageIds)) {
    const a = cfg.dispoMessageIds.slice(0, 7).map((v) => (v ? String(v) : null));
    while (a.length < 7) a.push(null);
    return a;
  }

  const legacy = [];
  for (let i = 0; i < 7; i++) legacy.push(cfg?.[`dispoMessageId_${i}`] ? String(cfg[`dispoMessageId_${i}`]) : null);
  while (legacy.length < 7) legacy.push(null);
  return legacy.slice(0, 7);
}

function resolveDispoChannelId(cfg) {
  const v =
    cfg?.checkDispoChannelId && String(cfg.checkDispoChannelId) !== "null"
      ? cfg.checkDispoChannelId
      : cfg?.disposChannelId;
  return v ? String(v) : null;
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

      if (!isStaff(interaction.member, cfg)) {
        return interaction.reply("⛔ Accès réservé au STAFF.");
      }

      const disposChannelId = resolveDispoChannelId(cfg);
      if (!disposChannelId) return interaction.reply("⚠️ Aucun salon configuré dans /setup.");

      const messageIds = getDispoMessageIds(cfg);
      if (!messageIds.some((x) => x)) return interaction.reply("⚠️ Aucun ID de message Dispo configuré (Lun→Dim).");

      const channel = await interaction.guild.channels.fetch(disposChannelId).catch(() => null);
      if (!channel || !channel.isTextBased?.()) {
        return interaction.reply("⚠️ Le salon Dispo/Check Dispo doit être un salon texte.");
      }

      // ✅ fetch membres (nécessaire pour calculer "sans réaction" côté rôles joueurs)
      await interaction.guild.members.fetch().catch(() => null);

      const playerRoleIds = Array.isArray(cfg?.playerRoleIds) ? cfg.playerRoleIds : [];
      if (!playerRoleIds.length) {
        return interaction.reply("⚠️ Aucun rôle Joueur configuré dans /setup (requis pour 'Sans réaction').");
      }

      // ✅ uniquement pour "Sans réaction"
      const players = interaction.guild.members.cache
        .filter((m) => m && !m.user.bot)
        .filter((m) => hasAnyRoleId(m, playerRoleIds));
      const playerIds = new Set(players.map((m) => m.user.id));

      const dayIndex = interaction.options.getInteger("jour");
      const dayLabel = DAYS[dayIndex];
      const mid = messageIds[dayIndex];

      await interaction.reply("⏳ Analyse en cours...");

      if (!mid) {
        const embed = new EmbedBuilder()
          .setTitle(`📊 Check Dispo — ${dayLabel}`)
          .setColor(0x5865f2)
          .setDescription(
            `Salon : <#${disposChannelId}>\n` +
            `Joueurs (pour 'Sans réaction') : **${playerIds.size}**\n\n` +
            `⚠️ ID du message non configuré pour ce jour.`
          )
          .setFooter({ text: "PROSYNC" });

        return interaction.editReply({ content: "✅ Terminé.", embeds: [embed] });
      }

      const msg = await safeFetchMessage(channel, mid);
      if (!msg) {
        const embed = new EmbedBuilder()
          .setTitle(`📊 Check Dispo — ${dayLabel}`)
          .setColor(0x5865f2)
          .setDescription(
            `Salon : <#${disposChannelId}>\n` +
            `Message : \`${mid}\`\n` +
            `Joueurs (pour 'Sans réaction') : **${playerIds.size}**\n\n` +
            `⚠️ Message introuvable.`
          )
          .setFooter({ text: "PROSYNC" });

        return interaction.editReply({ content: "✅ Terminé.", embeds: [embed] });
      }

      const okRes = await collectReactionUserIdsStrong(msg, "✅");
      const noRes = await collectReactionUserIdsStrong(msg, "❌");

      if (
        !okRes.ok && okRes.reason === "reactions_unavailable" &&
        !noRes.ok && noRes.reason === "reactions_unavailable"
      ) {
        const embed = new EmbedBuilder()
          .setTitle(`📊 Check Dispo — ${dayLabel}`)
          .setColor(0x5865f2)
          .setDescription(
            `Salon : <#${disposChannelId}>\n` +
            `Message : \`${mid}\`\n\n` +
            `🚫 **Impossible de lire les réactions.**\n` +
            `Vérifie: **ViewChannel + ReadMessageHistory** sur ce salon, et l’intent **GuildMessageReactions**.`
          )
          .setFooter({ text: "PROSYNC" });

        return interaction.editReply({ content: "⚠️ Terminé (réactions indisponibles).", embeds: [embed] });
      }

      // ✅ Présents/Absents = tous les users qui ont réagi
      const okAll = Array.from(okRes.users);
      const noAll = Array.from(noRes.users);

      const reactedAll = new Set([...okAll, ...noAll]);

      // ✅ Sans réaction = seulement les joueurs
      const missingPlayers = Array.from(playerIds).filter((id) => !reactedAll.has(id));

      const warn =
        (!okRes.ok && okRes.reason !== "emoji_not_found") || (!noRes.ok && noRes.reason !== "emoji_not_found")
          ? `\n\n⚠️ Lecture réactions partielle: ✅(${okRes.ok ? "ok" : okRes.reason}) / ❌(${noRes.ok ? "ok" : noRes.reason})`
          : "";

      const embed = new EmbedBuilder()
        .setTitle(`📊 Check Dispo — ${dayLabel}`)
        .setColor(0x5865f2)
        .setDescription(
          `Salon : <#${disposChannelId}>\n` +
          `Message : \`${mid}\`\n` +
          `Sans réaction (filtré Joueurs 👟) : **${playerIds.size}**` +
          warn
        )
        .addFields(
          { name: `🟩 ✅ Présents (tous) (${okAll.length})`, value: mentionList(okAll, { max: 60 }) },
          { name: `🟥 ❌ Absents (tous) (${noAll.length})`, value: mentionList(noAll, { max: 60 }) },
          { name: `🟦 ⏳ Sans réaction (Joueurs) (${missingPlayers.length})`, value: mentionList(missingPlayers, { max: 60 }) }
        )
        .setFooter({ text: "PROSYNC" });

      return interaction.editReply({ content: "✅ Terminé.", embeds: [embed] });
    } catch {
      try {
        if (interaction.replied) await interaction.followUp("⚠️ Erreur inconnue.");
        else await interaction.reply("⚠️ Erreur inconnue.");
      } catch {}
    }
  },
};
