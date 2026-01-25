// src/commands/pseudo.js
// /pseudo (STAFF ONLY) : scan salon pseudoScanChannelId + sync nickname de tout le monde
// Format final: "PSEUDO (ou USERNAME) | RÔLE | POSTE1/POSTE2/POSTE3"
//
// - Scan: lit les derniers messages du salon pseudoScanChannelId et récupère psn:/xbox:/ea:
// - Store: met à jour pseudos.json (par auteur du message)
// - Sync: applique le nickname à tous les membres (hors bots)
//   (garde-fous: permissions + throttling + skip si identique)
//
// Requis côté bot:
// - Intents: GuildMembers + GuildMessages + MessageContent (tu les as)
// - Permission: ManageNicknames (+ rôle du bot au-dessus des rôles ciblés)

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

/**
 * Extrait une plateforme + ID depuis un message.
 * Accepte:
 *  - "psn:/ID", "psn:ID"
 *  - "xbox:/ID", "xbox: ID"
 *  - "ea:/ID", "ea:ID"
 * Partout dans la phrase.
 */
function parsePlatformIdFromContent(content) {
  const txt = String(content || "");

  // 2..40 caractères pour l'ID (sans espace ni |)
  const re = /\b(psn|xbox|ea)\s*:\s*\/?\s*([^\s|]{2,40})/i;
  const m = txt.match(re);
  if (!m) return null;

  const platform = String(m[1]).toLowerCase();
  const value = cleanText(m[2], 40);
  if (!value) return null;

  // On stocke sans forcer le préfixe ici.
  // memberDisplay.js impose le format canonique (psn:/, xbox:/, ea:/) au rendu.
  return { platform, value };
}

async function scanPseudoChannel(channel, { limit = 300 } = {}) {
  // Retour: Map<userId, { psn?, xbox?, ea? }>
  // On conserve le plus récent trouvé par plateforme.
  const out = new Map();

  let lastId;
  let fetched = 0;

  while (fetched < limit) {
    const batchSize = Math.min(100, limit - fetched);
    const messages = await channel.messages.fetch({ limit: batchSize, before: lastId }).catch(() => null);
    if (!messages || messages.size === 0) break;

    // messages: du + récent au + ancien
    for (const msg of messages.values()) {
      if (!msg?.author?.id) continue;
      if (msg.author.bot) continue;

      const parsed = parsePlatformIdFromContent(msg.content);
      if (!parsed) continue;

      const userId = msg.author.id;
      const cur = out.get(userId) || {};

      // scan du récent vers ancien: ne pas écraser si déjà trouvé pour cette plateforme
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

function hasBotNicknamePerms(guild, me) {
  // me = GuildMember du bot
  if (!guild || !me) return false;
  return me.permissions?.has?.(PermissionFlagsBits.ManageNicknames) || false;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pseudo")
    .setDescription("STAFF: scan salon pseudos + sync nicknames (PSEUDO|RÔLE|POSTES).")
    // garde-fou supplémentaire (mais on applique aussi isStaff via roles staff)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: "⛔", ephemeral: true });

      const cfg = getGuildConfig(interaction.guildId) || {};
      const staffMember = interaction.member;

      // STAFF ONLY (ton requirement)
      if (!isStaff(staffMember, cfg)) return interaction.reply({ content: "⛔", ephemeral: true });

      const pseudoScanChannelId = cfg.pseudoScanChannelId;
      if (!pseudoScanChannelId) {
        return interaction.reply({
          content: "⚠️ Salon pseudos non configuré. Fais /setup et définis 🎮 pseudoScanChannelId.",
          ephemeral: true,
        });
      }

      const channel = await interaction.guild.channels.fetch(pseudoScanChannelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        return interaction.reply({
          content: "⚠️ Salon pseudos invalide (doit être un salon texte).",
          ephemeral: true,
        });
      }

      // Permission bot: Manage Nicknames (sinon, ça va fail pour tout le monde)
      const me = await interaction.guild.members.fetchMe().catch(() => null);
      if (!hasBotNicknamePerms(interaction.guild, me)) {
        return interaction.reply({
          content: "⚠️ Le bot n’a pas la permission **Gérer les pseudos** (Manage Nicknames).",
          ephemeral: true,
        });
      }

      await interaction.reply({ content: "⏳ Scan + Sync en cours...", ephemeral: true });

      // 1) SCAN
      const scanned = await scanPseudoChannel(channel, { limit: 300 }).catch(() => new Map());

      // 2) STORE
      let storedCount = 0;
      for (const [userId, patch] of scanned.entries()) {
        if (!patch || typeof patch !== "object") continue;
        setUserPseudos(interaction.guildId, userId, patch);
        storedCount++;
      }

      // 3) SYNC nicknames (tout le monde hors bots)
      await interaction.guild.members.fetch().catch(() => null);

      const members = interaction.guild.members.cache.filter((m) => m && !m.user.bot);

      let ok = 0;
      let fail = 0;
      let skipped = 0;
      let cannotEdit = 0;

      // Throttle léger (à ajuster selon taille serveur)
      // Note: Discord rate-limit diffère selon conditions; 700-1000ms est généralement stable.
      for (const m of members.values()) {
        const line = buildMemberLine(m, cfg);

        // si vide / invalide
        if (!line || line.length < 2) {
          skipped++;
          continue;
        }

        // déjà identique
        if ((m.nickname || "") === line) {
          skipped++;
          continue;
        }

        // cas non modifiable (rôle trop haut, owner, etc.)
        if (!m.manageable) {
          cannotEdit++;
          continue;
        }

        try {
          await m.setNickname(line, "PSEUDO_SYNC");
          ok++;
        } catch {
          fail++;
        }

        await sleep(850);
      }

      return interaction.editReply({
        content:
          `✅ Sync terminé.\n` +
          `- Scan store: **${storedCount}** membre(s)\n` +
          `- Nicknames: ✅ **${ok}** | ⚠️ **${fail}** | 🚫 **${cannotEdit}** | ⏭️ **${skipped}**`,
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
