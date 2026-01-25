// src/commands/pseudo.js
// /pseudo (STAFF ONLY) : scan salon pseudoScanChannelId + sync nickname de tout le monde
// Format final: "PSEUDO (ou USERNAME) | RÔLE | POSTE1/POSTE2/POSTE3"
// - Scan: lit les derniers messages du salon pseudoScanChannelId et récupère psn:/xbox:/ea:
// - Sync: applique le nickname à tous les membres (hors bots), avec un petit throttle anti rate-limit

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { getGuildConfig } = require("../core/guildConfig");
const { setUserPseudos } = require("../core/pseudoStore");
const { buildMemberLine } = require("../core/memberDisplay");

function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;

  const staffRoleIds = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  return staffRoleIds.some((id) => id && member.roles.cache.has(String(id)));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanText(s, max = 64) {
  return String(s || "")
    .replace(/[`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Extrait un pseudo depuis un message
// Accepte: "psn:ID", "psn:/ID", "xbox: ID", "ea:ID", même au milieu d'une phrase.
function parsePlatformIdFromContent(content) {
  const txt = String(content || "");

  // capture: psn:.... (jusqu'à espace / fin)
  const re = /\b(psn|xbox|ea)\s*:\s*\/?\s*([^\s|]{2,64})/i;
  const m = txt.match(re);
  if (!m) return null;

  const platform = String(m[1]).toLowerCase();
  const value = cleanText(m[2], 40);
  if (!value) return null;

  // On stocke la valeur brute, memberDisplay se charge d'imposer le préfixe au rendu
  return { platform, value };
}

async function scanPseudoChannel(channel, { limit = 200 } = {}) {
  // Retour: Map<userId, { psn?, xbox?, ea? }> avec la valeur la plus récente trouvée
  const out = new Map();

  let lastId = undefined;
  let fetched = 0;

  while (fetched < limit) {
    const batchSize = Math.min(100, limit - fetched);
    const messages = await channel.messages.fetch({ limit: batchSize, before: lastId }).catch(() => null);
    if (!messages || messages.size === 0) break;

    // messages est trié du + récent au + ancien
    for (const msg of messages.values()) {
      if (!msg?.author?.id) continue;
      if (msg.author.bot) continue;

      const parsed = parsePlatformIdFromContent(msg.content);
      if (!parsed) continue;

      const userId = msg.author.id;
      const cur = out.get(userId) || {};
      // Le scan parcourt du récent vers ancien: on n’écrase pas si déjà trouvé pour cette plateforme
      if (!cur[parsed.platform]) {
        cur[parsed.platform] = parsed.value;
        out.set(userId, cur);
      }
    }

    fetched += messages.size;
    lastId = messages.last()?.id;
    if (!lastId) break;
  }

  return out;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pseudo")
    .setDescription("STAFF: scan salon pseudos + sync nicknames (PSEUDO|RÔLE|POSTES).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // garde-fou; toi tu gères aussi via roles staff

  async execute(interaction, client) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: "⛔", ephemeral: true });

      const cfg = getGuildConfig(interaction.guildId) || {};
      const member = interaction.member;

      // STAFF ONLY
      if (!isStaff(member, cfg)) return interaction.reply({ content: "⛔", ephemeral: true });

      const pseudoScanChannelId = cfg.pseudoScanChannelId;
      if (!pseudoScanChannelId) {
        return interaction.reply({ content: "⚠️ Salon pseudoScanChannelId non configuré dans /setup.", ephemeral: true });
      }

      const channel = await interaction.guild.channels.fetch(pseudoScanChannelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        return interaction.reply({ content: "⚠️ Salon pseudos invalide (doit être un salon texte).", ephemeral: true });
      }

      await interaction.reply({ content: "⏳ Scan + Sync en cours...", ephemeral: true });

      // 1) SCAN salon pseudos
      const scanned = await scanPseudoChannel(channel, { limit: 300 }).catch(() => new Map());

      // 2) Ecrit dans le store (pseudos.json)
      let storedCount = 0;
      for (const [userId, patch] of scanned.entries()) {
        if (!patch || typeof patch !== "object") continue;
        setUserPseudos(interaction.guildId, userId, patch);
        storedCount++;
      }

      // 3) SYNC nicknames (tout le monde hors bots)
      //    Important: nécessite que le bot ait "Manage Nicknames" + rôle au-dessus des rôles ciblés.
      await interaction.guild.members.fetch().catch(() => null);

      const members = interaction.guild.members.cache
        .filter((m) => m && !m.user.bot);

      let ok = 0;
      let fail = 0;
      let skipped = 0;

      // Throttle léger pour éviter les rate limits
      // (discord gère, mais c'est plus stable)
      for (const m of members.values()) {
        // Option: on évite de toucher le propriétaire si restriction
        const line = buildMemberLine(m, cfg);

        // Si rien de calculable, on skip
        if (!line || line.length < 2) {
          skipped++;
          continue;
        }

        // Si déjà identique, skip (réduit spam/rate limit)
        if ((m.nickname || "") === line) {
          skipped++;
          continue;
        }

        try {
          await m.setNickname(line, "PSEUDO_SYNC");
          ok++;
        } catch {
          fail++;
        }

        await sleep(900);
      }

      return interaction.editReply({
        content: `✅ Sync terminé.\n- Scan store: **${storedCount}** membre(s)\n- Nicknames: ✅ **${ok}** | ⚠️ **${fail}** | ⏭️ **${skipped}**`,
      });
    } catch (e) {
      try {
        if (interaction.deferred) {
          await interaction.editReply({ content: "⚠️" }).catch(() => {});
        } else if (!interaction.replied) {
          await interaction.reply({ content: "⚠️", ephemeral: true }).catch(() => {});
        } else {
          await interaction.followUp({ content: "⚠️", ephemeral: true }).catch(() => {});
        }
      } catch {}
    }
  },
};
