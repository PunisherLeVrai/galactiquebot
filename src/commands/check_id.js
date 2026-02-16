// src/commands/check_id.js
// /check_id — STAFF ONLY — NON EPHEMERE — Embed
// Check 1 message par ID (✅/❌) avec filtre rôles custom + option rappel.
//
// ✅ Présents/Absents = réactions ✅/❌ (filtrées sur la cible)
// ✅ Sans réaction = membres "cibles" (rôles choisis) - (réactions ✅/❌)
//
// Cible (membres à contrôler) :
// - si option roles fournie => membres ayant ≥1 de ces rôles
// - sinon fallback => cfg.playerRoleIds (si dispo), sinon tous les membres (hors bots)
//
// Mode:
// - check (default): affiche embed
// - rappel: affiche embed + envoie rappel (salon / mp / les2)
//
// ✅ IMPORTANT (ta demande):
// - Si rappelMode inclut "salon" => la mention/rappel est FORCÉMENT envoyé dans le salon des disponibilités (sourceChannel)
//   (le salon où se trouve le message analysé). On ignore tout autre salon.
//
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
} = require("discord.js");

const { getGuildConfig } = require("../core/guildConfig");

// --------------------
// Helpers staff/roles
// --------------------
function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const staffRoleIds = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  return staffRoleIds.some((id) => id && member.roles?.cache?.has?.(String(id)));
}

function hasAnyRoleId(member, ids) {
  const arr = Array.isArray(ids) ? ids : [];
  return arr.some((id) => id && member.roles?.cache?.has?.(String(id)));
}

function uniq(arr) {
  return Array.from(new Set((arr || []).map(String))).filter(Boolean);
}

function mentionList(ids, { empty = "—", max = 60 } = {}) {
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

async function fetchAllReactionUserIds(reaction) {
  const out = new Set();
  if (!reaction) return out;

  // pagination safe
  let after;
  while (true) {
    const users = await reaction.users.fetch({ limit: 100, after }).catch(() => null);
    if (!users || users.size === 0) break;

    for (const u of users.values()) {
      if (!u?.id) continue;
      if (u.bot) continue;
      out.add(u.id);
    }

    after = users.last()?.id;
    if (!after || users.size < 100) break;
  }

  return out;
}

async function collectReactionUserIdsStrong(message, emojiName) {
  const empty = new Set();
  if (!message) return { ok: false, reason: "no_message", users: empty };

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
    if (finalCacheSize === 0) return { ok: false, reason: "reactions_unavailable", users: empty };
    return { ok: true, reason: "emoji_not_found", users: empty };
  }

  try {
    const users = await fetchAllReactionUserIds(reaction);
    return { ok: true, reason: "ok", users };
  } catch {
    return { ok: false, reason: "users_fetch_failed", users: empty };
  }
}

// --------------------
// Utils
// --------------------
function resolveDefaultChannelId(cfg) {
  // priorité: checkDispoChannelId puis disposChannelId
  const v =
    cfg?.checkDispoChannelId && String(cfg.checkDispoChannelId) !== "null"
      ? cfg.checkDispoChannelId
      : cfg?.disposChannelId;
  return v ? String(v) : null;
}

function buildMessageLink(guildId, channelId, messageId) {
  if (!guildId || !channelId || !messageId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("check_id")
    .setDescription("STAFF: Check un message par ID (✅/❌) avec filtre rôles + rappel optionnel.")
    .addStringOption((opt) =>
      opt
        .setName("message_id")
        .setDescription("ID du message à analyser")
        .setRequired(true)
    )
    .addChannelOption((opt) =>
      opt
        .setName("salon")
        .setDescription("Salon contenant le message (si non fourni => salon configuré)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addRoleOption((opt) =>
      opt
        .setName("role_1")
        .setDescription("Rôle à inclure dans le filtre (optionnel)")
        .setRequired(false)
    )
    .addRoleOption((opt) =>
      opt
        .setName("role_2")
        .setDescription("Rôle à inclure dans le filtre (optionnel)")
        .setRequired(false)
    )
    .addRoleOption((opt) =>
      opt
        .setName("role_3")
        .setDescription("Rôle à inclure dans le filtre (optionnel)")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("check = embed uniquement | rappel = embed + rappel")
        .setRequired(false)
        .addChoices(
          { name: "Check", value: "check" },
          { name: "Rappel", value: "rappel" }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("rappel_mode")
        .setDescription("Où envoyer le rappel (si mode=rappel)")
        .setRequired(false)
        .addChoices(
          { name: "Salon", value: "salon" },
          { name: "MP", value: "mp" },
          { name: "Les deux", value: "les2" }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("message")
        .setDescription("Message de rappel personnalisé (optionnel)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(0n),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply("⛔");

      const cfg = getGuildConfig(interaction.guildId) || {};
      if (!isStaff(interaction.member, cfg)) {
        return interaction.reply("⛔ Accès réservé au STAFF.");
      }

      const messageId = interaction.options.getString("message_id", true).trim();
      const mode = interaction.options.getString("mode") || "check";
      const rappelMode = interaction.options.getString("rappel_mode") || "salon";
      const customMsg = interaction.options.getString("message") || null;

      // salon source
      let sourceChannel = interaction.options.getChannel("salon") || null;
      if (!sourceChannel) {
        const defId = resolveDefaultChannelId(cfg);
        if (defId) sourceChannel = await interaction.guild.channels.fetch(defId).catch(() => null);
      }

      if (!sourceChannel || !sourceChannel.isTextBased?.()) {
        return interaction.reply("⚠️ Salon source introuvable/invalide (donne l’option `salon` ou configure /setup).");
      }

      // rôles filtre (0..3)
      const r1 = interaction.options.getRole("role_1");
      const r2 = interaction.options.getRole("role_2");
      const r3 = interaction.options.getRole("role_3");
      const filterRoleIds = [r1?.id, r2?.id, r3?.id].filter(Boolean);

      // fetch membres (pour construire la cible)
      await interaction.guild.members.fetch().catch(() => null);

      // Construire la cible
      let targetMembers = interaction.guild.members.cache.filter((m) => m && !m.user.bot);

      if (filterRoleIds.length) {
        targetMembers = targetMembers.filter((m) => hasAnyRoleId(m, filterRoleIds));
      } else {
        // fallback cfg.playerRoleIds si dispo
        const playerRoleIds = Array.isArray(cfg?.playerRoleIds) ? cfg.playerRoleIds : [];
        if (playerRoleIds.length) targetMembers = targetMembers.filter((m) => hasAnyRoleId(m, playerRoleIds));
      }

      const targetIds = new Set(targetMembers.map((m) => m.user.id));

      await interaction.reply("⏳ Analyse en cours...");

      const msg = await safeFetchMessage(sourceChannel, messageId);
      if (!msg) {
        const embed = new EmbedBuilder()
          .setTitle("📊 Check ID")
          .setColor(0x5865f2)
          .setDescription(
            `Salon : <#${sourceChannel.id}>\n` +
              `Message : \`${messageId}\`\n\n` +
              `⚠️ Message introuvable.`
          )
          .setFooter({ text: "XIG BLAUGRANA FC Staff" });

        return interaction.editReply({ content: "✅ Terminé.", embeds: [embed] });
      }

      const okRes = await collectReactionUserIdsStrong(msg, "✅");
      const noRes = await collectReactionUserIdsStrong(msg, "❌");

      if (
        !okRes.ok && okRes.reason === "reactions_unavailable" &&
        !noRes.ok && noRes.reason === "reactions_unavailable"
      ) {
        const embed = new EmbedBuilder()
          .setTitle("📊 Check ID")
          .setColor(0x5865f2)
          .setDescription(
            `Salon : <#${sourceChannel.id}>\n` +
              `Message : \`${messageId}\`\n\n` +
              `🚫 **Impossible de lire les réactions.**\n` +
              `Vérifie: **ViewChannel + ReadMessageHistory**, et l’intent **GuildMessageReactions**.`
          )
          .setFooter({ text: "XIG BLAUGRANA FC Staff" });

        return interaction.editReply({ content: "⚠️ Terminé (réactions indisponibles).", embeds: [embed] });
      }

      // réactions filtrées sur la cible
      const ok = Array.from(okRes.users).filter((id) => targetIds.has(id));
      const no = Array.from(noRes.users).filter((id) => targetIds.has(id));

      const reacted = new Set([...ok, ...no]);
      const missing = Array.from(targetIds).filter((id) => !reacted.has(id));

      const warn =
        (!okRes.ok && okRes.reason !== "emoji_not_found") || (!noRes.ok && noRes.reason !== "emoji_not_found")
          ? `\n\n⚠️ Lecture réactions partielle: ✅(${okRes.ok ? "ok" : okRes.reason}) / ❌(${noRes.ok ? "ok" : noRes.reason})`
          : "";

      const roleLine = filterRoleIds.length
        ? filterRoleIds.map((id) => `<@&${id}>`).join(" ")
        : (Array.isArray(cfg?.playerRoleIds) && cfg.playerRoleIds.length ? "cfg.playerRoleIds" : "Tous (hors bots)");

      const embed = new EmbedBuilder()
        .setTitle("📊 Check ID")
        .setColor(0x5865f2)
        .setDescription(
          `Salon : <#${sourceChannel.id}>\n` +
            `Message : \`${messageId}\`\n` +
            `Filtre : **${roleLine}**\n` +
            `Cibles : **${targetIds.size}**` +
            warn
        )
        .addFields(
          { name: `🟩 ✅ Présents (${ok.length})`, value: mentionList(ok, { max: 60 }) },
          { name: `🟥 ❌ Absents (${no.length})`, value: mentionList(no, { max: 60 }) },
          { name: `🟦 ⏳ Sans réaction (${missing.length})`, value: mentionList(missing, { max: 60 }) }
        )
        .setFooter({ text: "XIG BLAUGRANA FC Staff" });

      // --------------------
      // Rappel optionnel
      // --------------------
      if (mode === "rappel") {
        if (!missing.length) {
          return interaction.editReply({ content: "✅ Terminé (personne à relancer).", embeds: [embed] });
        }

        const link = buildMessageLink(interaction.guildId, sourceChannel.id, messageId);
        const baseText =
          customMsg ||
          `📌 **Rappel**\nMerci de répondre sur le message (✅ / ❌).` + (link ? `\n➡️ ${link}` : "");

        // ✅ Salon FORCÉ = salon des dispos (sourceChannel)
        let salonSent = false;
        if (rappelMode === "salon" || rappelMode === "les2") {
          const mention = mentionList(missing, { max: 80, empty: "—" });
          await sourceChannel
            .send({
              content: `${mention}\n\n${baseText}`,
              allowedMentions: { users: missing.slice(0, 100), roles: [], repliedUser: false },
            })
            .catch(() => {});
          salonSent = true;
        }

        // MP
        let dmOk = 0;
        let dmFail = 0;
        if (rappelMode === "mp" || rappelMode === "les2") {
          for (const id of missing) {
            const member = interaction.guild.members.cache.get(id);
            if (!member) continue;
            const okSend = await member.send({ content: baseText }).then(() => true).catch(() => false);
            if (okSend) dmOk++;
            else dmFail++;
          }
        }

        embed.addFields({
          name: "📣 Rappel",
          value: `Salon (dispos): **${salonSent ? "oui" : "non"}**\nMP: **${dmOk} ok / ${dmFail} échec**`,
        });

        return interaction.editReply({ content: "✅ Terminé + rappel envoyé.", embeds: [embed] });
      }

      return interaction.editReply({ content: "✅ Terminé.", embeds: [embed] });
    } catch {
      try {
        if (interaction.replied) await interaction.followUp("⚠️ Erreur inconnue.");
        else await interaction.reply("⚠️ Erreur inconnue.");
      } catch {}
    }
  },
};
