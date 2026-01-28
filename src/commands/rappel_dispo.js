// src/commands/rappel_dispo.js
// /rappel_dispo — STAFF ONLY — rappel ceux qui n'ont pas répondu (✅/❌)
// Modes: salon | mp | les2
// Filtre : doit avoir ≥1 rôle dans cfg.playerRoleIds
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");

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

// Pagination safe (au cas où beaucoup de réactions)
async function collectReactionUserIds(message, emojiName) {
  const out = new Set();
  if (!message?.reactions?.cache) return out;

  const reaction =
    message.reactions.cache.find((r) => r?.emoji?.name === emojiName) ||
    message.reactions.cache.find((r) => r.emoji.toString?.() === emojiName);

  if (!reaction) return out;

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rappel_dispo")
    .setDescription("STAFF: Rappeler ceux qui n'ont pas répondu aux dispos (✅/❌).")
    .addIntegerOption((opt) =>
      opt
        .setName("jour")
        .setDescription("Jour à relancer")
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
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("Où envoyer le rappel")
        .setRequired(true)
        .addChoices(
          { name: "Salon", value: "salon" },
          { name: "MP", value: "mp" },
          { name: "Les deux", value: "les2" }
        )
    )
    .addChannelOption((opt) =>
      opt
        .setName("salon")
        .setDescription("Salon où poster le rappel (si mode=salon/les2).")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("message")
        .setDescription("Message personnalisé (optionnel)")
        .setRequired(false)
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

      const dayIndex = interaction.options.getInteger("jour", true);
      const dayLabel = DAYS[dayIndex] || `Jour ${dayIndex}`;
      const mode = interaction.options.getString("mode", true);
      const customMsg = interaction.options.getString("message") || null;

      // salon dispo (même logique que /check_dispo)
      const disposChannelId =
        cfg?.checkDispoChannelId && cfg.checkDispoChannelId !== "null"
          ? cfg.checkDispoChannelId
          : cfg?.disposChannelId;

      if (!disposChannelId) {
        return interaction.reply("⚠️ Aucun salon configuré dans /setup.");
      }

      const messageIds = getDispoMessageIds(cfg);
      const mid = messageIds[dayIndex];
      if (!mid) {
        return interaction.reply(`⚠️ Aucun ID de message Dispo configuré pour **${dayLabel}**.`);
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

      // joueurs
      const players = interaction.guild.members.cache
        .filter((m) => m && !m.user.bot)
        .filter((m) => hasAnyRoleId(m, playerRoleIds));

      const playerIds = new Set(players.map((m) => m.user.id));

      await interaction.reply("⏳ Analyse en cours...");

      const msg = await safeFetchMessage(channel, mid);
      if (!msg) {
        return interaction.editReply(`⚠️ Message introuvable (ID: \`${mid}\`).`);
      }

      // réactions => répondants
      const ok = await collectReactionUserIds(msg, "✅");
      const no = await collectReactionUserIds(msg, "❌");

      const okPlayers = Array.from(ok).filter((id) => playerIds.has(id));
      const noPlayers = Array.from(no).filter((id) => playerIds.has(id));

      const reacted = new Set([...okPlayers, ...noPlayers]);
      const missing = Array.from(playerIds).filter((id) => !reacted.has(id));

      if (!missing.length) {
        return interaction.editReply(`✅ Personne à relancer pour **${dayLabel}**.`);
      }

      // Message rappel
      const baseText =
        customMsg ||
        `📌 **Rappel Dispo — ${dayLabel}**\nMerci de répondre sur le message de dispo avec ✅ ou ❌.`;

      // Salon cible si besoin
      let outChannel = null;
      if (mode === "salon" || mode === "les2") {
        const chosen = interaction.options.getChannel("salon") || null;

        if (chosen) outChannel = chosen;
        else if (cfg.staffReportsChannelId) outChannel = await interaction.guild.channels.fetch(cfg.staffReportsChannelId).catch(() => null);
        else if (cfg.disposChannelId) outChannel = await interaction.guild.channels.fetch(cfg.disposChannelId).catch(() => null);

        if (!outChannel || !outChannel.isTextBased?.()) {
          return interaction.editReply("⚠️ Salon de rappel introuvable/invalide. Mets l’option `salon` ou configure Staff/Dispos.");
        }
      }

      // 1) En salon
      let salonSent = false;
      if (outChannel) {
        // ping users (évite @everyone / rôles)
        const mention = mentionList(missing, { max: 80, empty: "—" });
        await outChannel
          .send({
            content: `${mention}\n\n${baseText}`,
            allowedMentions: { users: missing, roles: [], repliedUser: false },
          })
          .catch(() => {});
        salonSent = true;
      }

      // 2) En MP
      let dmOk = 0;
      let dmFail = 0;
      if (mode === "mp" || mode === "les2") {
        for (const id of missing) {
          const member = interaction.guild.members.cache.get(id);
          if (!member) continue;
          const okSend = await member.send({ content: baseText }).then(() => true).catch(() => false);
          if (okSend) dmOk++;
          else dmFail++;
        }
      }

      const embed = new EmbedBuilder()
        .setTitle(`📣 Rappel Dispo — ${dayLabel}`)
        .setColor(0x5865f2)
        .setDescription(
          `Salon source : <#${disposChannelId}>\nMessage : \`${mid}\`\nJoueurs détectés : **${playerIds.size}**`
        )
        .addFields(
          { name: `🟦 Sans réaction (${missing.length})`, value: mentionList(missing) },
          { name: "Envoi", value: `Salon: **${salonSent ? "oui" : "non"}**\nMP: **${dmOk} ok / ${dmFail} échec**` }
        )
        .setFooter({ text: "XIG BLAUGRANA FC Staff" });

      return interaction.editReply({ content: "✅ Rappel envoyé.", embeds: [embed] });

    } catch {
      try {
        if (interaction.replied) await interaction.followUp("⚠️ Erreur inconnue.");
        else await interaction.reply("⚠️ Erreur inconnue.");
      } catch {}
    }
  },
};
