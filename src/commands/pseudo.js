// src/commands/pseudo.js
// /pseudo (STAFF ONLY) : scan salon pseudoScanChannelId + sync nickname de tout le monde
// Format final: "PSEUDO (ou USERNAME) | RÔLE | POSTE1/POSTE2/POSTE3"
// - Scan: lit les derniers messages du salon pseudoScanChannelId et récupère psn:/xbox:/ea:
// - Store: merge en 1 seule écriture (batch) via importAllPseudos()
// - Sync: applique le nickname à tous les membres (hors bots), throttle + checks "manageable"

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { getGuildConfig } = require("../core/guildConfig");
const { importAllPseudos } = require("../core/pseudoStore");
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

  // capture: psn|xbox|ea : /? ID (jusqu'à espace | ou fin)
  const re = /\b(psn|xbox|ea)\s*:\s*\/?\s*([^\s|]{2,64})/i;
  const m = txt.match(re);
  if (!m) return null;

  const platform = String(m[1]).toLowerCase();
  const value = cleanText(m[2], 40);
  if (!value) return null;

  return { platform, value };
}

async function scanPseudoChannel(channel, { limit = 300 } = {}) {
  // Retour: Map<userId, { psn?, xbox?, ea? }> avec la valeur la + récente trouvée par plateforme
  const out = new Map();

  let lastId = undefined;
  let fetched = 0;

  while (fetched < limit) {
    const batchSize = Math.min(100, limit - fetched);
    const messages = await channel.messages.fetch({ limit: batchSize, before: lastId }).catch(() => null);
    if (!messages || messages.size === 0) break;

    for (const msg of messages.values()) {
      if (!msg?.author?.id) continue;
      if (msg.author.bot) continue;

      const parsed = parsePlatformIdFromContent(msg.content);
      if (!parsed) continue;

      const userId = msg.author.id;
      const cur = out.get(userId) || {};

      // On parcourt du + récent au + ancien => on ne remplace pas si déjà trouvé pour cette plateforme
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
    .setDescription("STAFF: scan salon pseudos + sync nicknames (PSEUDO | RÔLE | POSTES).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: "⛔", ephemeral: true });

      const cfg = getGuildConfig(interaction.guildId) || {};
      if (!isStaff(interaction.member, cfg)) {
        return interaction.reply({ content: "⛔", ephemeral: true });
      }

      const pseudoScanChannelId = cfg.pseudoScanChannelId;
      if (!pseudoScanChannelId) {
        return interaction.reply({
          content: "⚠️ Salon pseudos non configuré. Fais /setup puis choisis 🎮 Pseudos (opt).",
          ephemeral: true,
        });
      }

      const channel = await interaction.guild.channels.fetch(pseudoScanChannelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        return interaction.reply({ content: "⚠️ Salon pseudos invalide (doit être un salon texte).", ephemeral: true });
      }

      await interaction.reply({ content: "⏳ Scan + Sync en cours...", ephemeral: true });

      // 1) SCAN
      const scanned = await scanPseudoChannel(channel, { limit: 300 }).catch(() => new Map());

      // 2) STORE (batch) — on construit un payload compatible importAllPseudos()
      //    On MERGE uniquement les champs trouvés (psn/xbox/ea) pour ce guildId.
      let storedCount = 0;
      const usersPayload = {};

      for (const [userId, patch] of scanned.entries()) {
        if (!patch || typeof patch !== "object") continue;

        // On ne met que les champs présents (sinon on risque d'écraser)
        const u = {};
        if (patch.psn) u.psn = patch.psn;
        if (patch.xbox) u.xbox = patch.xbox;
        if (patch.ea) u.ea = patch.ea;

        if (Object.keys(u).length) {
          usersPayload[String(userId)] = u;
          storedCount++;
        }
      }

      if (storedCount > 0) {
        importAllPseudos(
          {
            version: 1,
            guilds: {
              [String(interaction.guildId)]: { users: usersPayload },
            },
          },
          { replace: false }
        );
      }

      // 3) SYNC nicknames (tout le monde hors bots)
      //    Important: nécessite "Manage Nicknames" + rôle bot au-dessus des rôles ciblés.
      await interaction.guild.members.fetch().catch(() => null);

      const members = interaction.guild.members.cache.filter((m) => m && !m.user.bot);

      let ok = 0;
      let fail = 0;
      let skipped = 0;
      let notManageable = 0;

      for (const m of members.values()) {
        // Ne pas tenter si Discord interdit (rôle au-dessus / owner / permissions)
        if (!m.manageable) {
          notManageable++;
          continue;
        }

        const line = buildMemberLine(m, cfg);
        if (!line || line.length < 2) {
          skipped++;
          continue;
        }

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

        // throttle léger
        await sleep(850);
      }

      return interaction.editReply({
        content:
          `✅ Sync terminé.\n` +
          `- Scan store (merge): **${storedCount}** membre(s)\n` +
          `- Nicknames: ✅ **${ok}** | ⚠️ **${fail}** | ⏭️ **${skipped}** | 🚫 **${notManageable}** (non manageable)`,
      });
    } catch {
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
