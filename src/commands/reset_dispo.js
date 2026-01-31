// src/commands/reset_dispo.js
// /reset_dispo — remet les réactions ✅❌ sur les messages de dispo (IDs déjà enregistrés)
// - multi-serveur via getGuildConfig
// - STAFF ONLY
// - option jour: all | Lun..Dim
// - tente removeAll (Manage Messages), sinon fallback supprime seulement les réactions du bot
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
} = require("discord.js");

const { getGuildConfig } = require("../core/guildConfig");

const ICON = {
  no: "⛔",
  warn: "⚠️",
  ok: "✅",
  broom: "🧹",
};

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const ids = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  return ids.some((id) => id && member.roles?.cache?.has?.(String(id)));
}

function pickDays(dayOpt) {
  const d = String(dayOpt || "all");
  if (d === "all") return DAYS.map((name, idx) => ({ name, idx }));
  const idx = DAYS.indexOf(d);
  if (idx === -1) return DAYS.map((name, i) => ({ name, idx: i }));
  return [{ name: d, idx }];
}

async function fetchTextChannel(guild, channelId) {
  if (!channelId) return null;
  try {
    const ch = await guild.channels.fetch(String(channelId));
    if (!ch) return null;

    // TextBased OK (GuildText/Thread etc). Ici on vise surtout GuildText.
    const okType =
      ch.type === ChannelType.GuildText ||
      ch.isTextBased?.();

    return okType ? ch : null;
  } catch {
    return null;
  }
}

async function tryRemoveAllReactions(message) {
  try {
    // nécessite "Manage Messages" en général
    await message.reactions.removeAll();
    return { ok: true, mode: "removeAll" };
  } catch (e) {
    return { ok: false, mode: "removeAll", err: e };
  }
}

async function tryRemoveBotReactions(message, botUserId) {
  // fallback : retirer uniquement les réactions du bot (✅/❌) si présentes
  try {
    const emojis = ["✅", "❌"];

    // On refresh la cache des réactions
    try {
      await message.fetch(true);
    } catch {}

    for (const em of emojis) {
      const react = message.reactions.cache.find((r) => r.emoji?.name === em);
      if (!react) continue;

      // retirer la réaction du bot (ne nécessite pas forcément Manage Messages)
      try {
        await react.users.remove(botUserId);
      } catch {}
    }

    return { ok: true, mode: "removeBotOnly" };
  } catch (e) {
    return { ok: false, mode: "removeBotOnly", err: e };
  }
}

async function ensureReacts(message) {
  // ré-applique dans l’ordre
  // NOTE: react peut échouer si le bot n’a pas Add Reactions ou accès au salon
  await message.react("✅");
  await message.react("❌");
}

module.exports.data = new SlashCommandBuilder()
  .setName("reset_dispo")
  .setDescription("Remet les réactions ✅❌ sur les messages de dispo (IDs /setup).")
  .addStringOption((opt) =>
    opt
      .setName("jour")
      .setDescription("Quel jour reset ?")
      .setRequired(false)
      .addChoices(
        { name: "Tous", value: "all" },
        { name: "Lun", value: "Lun" },
        { name: "Mar", value: "Mar" },
        { name: "Mer", value: "Mer" },
        { name: "Jeu", value: "Jeu" },
        { name: "Ven", value: "Ven" },
        { name: "Sam", value: "Sam" },
        { name: "Dim", value: "Dim" }
      )
  )
  .setDefaultMemberPermissions(0n);

module.exports.execute = async function execute(interaction) {
  try {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: ICON.no, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const guild = interaction.guild;
    const cfg = getGuildConfig(guild.id) || {};

    if (!isStaff(interaction.member, cfg)) {
      return interaction
        .reply({ content: `${ICON.no} Accès réservé au STAFF.`, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    const ids = Array.isArray(cfg.dispoMessageIds) ? cfg.dispoMessageIds : [];
    const anyId = ids.some(Boolean);

    if (!anyId) {
      return interaction
        .reply({
          content: `${ICON.warn} Aucun ID dispo enregistré (va sur /setup → CheckDispo / IDs).`,
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }

    // salon principal où sont censés être les messages
    const primaryChannelId = cfg.checkDispoChannelId || cfg.disposChannelId;
    const fallbackChannelId = cfg.disposChannelId && cfg.disposChannelId !== primaryChannelId ? cfg.disposChannelId : null;

    const primaryCh = await fetchTextChannel(guild, primaryChannelId);
    const fallbackCh = fallbackChannelId ? await fetchTextChannel(guild, fallbackChannelId) : null;

    if (!primaryCh && !fallbackCh) {
      return interaction
        .reply({
          content: `${ICON.warn} Salon introuvable (checkDispoChannelId / disposChannelId non configuré ou inaccessible).`,
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }

    const dayOpt = interaction.options.getString("jour") || "all";
    const targets = pickDays(dayOpt);

    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const botId = interaction.client.user.id;

    const lines = [];
    let okCount = 0;

    for (const { name, idx } of targets) {
      const msgId = ids[idx] ? String(ids[idx]) : null;
      if (!msgId) {
        lines.push(`- **${name}**: ${ICON.warn} ID manquant`);
        continue;
      }

      // 1) fetch message (primary puis fallback)
      let message = null;

      if (primaryCh?.messages?.fetch) {
        try {
          message = await primaryCh.messages.fetch(msgId);
        } catch {}
      }
      if (!message && fallbackCh?.messages?.fetch) {
        try {
          message = await fallbackCh.messages.fetch(msgId);
        } catch {}
      }

      if (!message) {
        lines.push(`- **${name}**: ${ICON.warn} message introuvable (\`${msgId}\`)`);
        continue;
      }

      // 2) remove reactions (best effort)
      const r1 = await tryRemoveAllReactions(message);
      if (!r1.ok) {
        await tryRemoveBotReactions(message, botId);
      }

      // 3) re-add ✅❌
      try {
        await ensureReacts(message);
        okCount++;
        lines.push(`- **${name}**: ${ICON.ok} reset ✅❌`);
      } catch (e) {
        lines.push(`- **${name}**: ${ICON.warn} impossible d’ajouter réactions (droits manquants ?)`);
      }
    }

    const header = `${ICON.broom} Reset Dispo — **${okCount}/${targets.length}** OK`;
    const infoPerms =
      "⚠️ Pour un reset complet (supprimer toutes les réactions), le bot doit avoir **Manage Messages**. Sinon il ne retire que ses propres réactions avant de ré-ajouter ✅❌.";

    await interaction
      .editReply({
        content: [header, "", lines.join("\n"), "", infoPerms].join("\n"),
      })
      .catch(() => {});
  } catch (e) {
    try {
      if (interaction.deferred) {
        await interaction.editReply({ content: "⚠️ Erreur /reset_dispo." }).catch(() => {});
      } else if (!interaction.replied) {
        await interaction.reply({ content: "⚠️ Erreur /reset_dispo.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    } catch {}
  }
};
