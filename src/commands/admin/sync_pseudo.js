// src/commands/admin/sync_pseudo.js
// Force une sync pseudo immédiate (sans rappel, sans mention) — Admin only
// ✅ Utilise la même logique que la sync horaire (pseudoSync)
// ✅ Répond en éphémère
// ✅ Fonctionne multi-serveur (sur le serveur où tu lances la commande)
// CommonJS — discord.js v14

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getGuildConfig } = require("../../core/guildConfig");
const { getUserPseudos } = require("../../core/pseudoStore");
const { warn } = require("../../core/logger");

// --- helpers identiques à pseudoSync (copiés ici pour rester autonome) ---
function normalizeValue(v, max = 40) {
  if (!v) return "";
  return String(v)
    .replace(/[`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeUsername(username) {
  const raw = String(username || "");
  const noAccents = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const lettersOnly = noAccents
    .replace(/[^a-zA-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!lettersOnly) return "User";
  return lettersOnly.charAt(0).toUpperCase() + lettersOnly.slice(1).toLowerCase();
}

function pickPriorityPseudo(entry, fallbackUsername) {
  const psn = normalizeValue(entry?.psn, 40);
  const xbox = normalizeValue(entry?.xbox, 40);
  const ea = normalizeValue(entry?.ea, 40);

  if (psn) return psn;
  if (xbox) return xbox;
  if (ea) return ea;

  return normalizeUsername(fallbackUsername);
}

function pickRoleLabel(member, cfg) {
  const map = cfg?.mainRoles || {};
  const order = [
    { key: "president", label: "Président" },
    { key: "fondateur", label: "Fondateur" },
    { key: "gm", label: "GM" },
    { key: "cogm", label: "coGM" },
    { key: "staff", label: "Staff" },
  ];

  for (const it of order) {
    const id = map?.[it.key]?.id;
    if (id && member.roles.cache.has(id)) return it.label;
  }

  return "Membre";
}

function pickPostsLabel(member, cfg) {
  const posts = Array.isArray(cfg?.posts) ? cfg.posts : [];
  const found = [];

  for (const p of posts) {
    const roleId = p?.id;
    if (!roleId) continue;

    if (member.roles.cache.has(roleId)) {
      const label = String(p.label || "").trim() || "Poste";
      found.push(label);
      if (found.length >= 3) break;
    }
  }

  return found.length ? found.join("/") : "—";
}

function buildNick(pseudo, roleLabel, postsLabel) {
  const p = String(pseudo || "").trim() || "User";
  const r = String(roleLabel || "").trim() || "Membre";
  const po = String(postsLabel || "").trim() || "—";
  return `${p} | ${r} | ${po}`;
}
// ------------------------------------------------------------

async function runSyncNow(guild) {
  const cfg = getGuildConfig(guild.id) || {};
  const pseudoCfg = cfg.pseudo || {};

  if (!pseudoCfg.syncEnabled) {
    return { processed: 0, changed: 0, skipped: "syncDisabled" };
  }

  const fetchMembers = pseudoCfg.syncFetchMembers !== false;
  if (fetchMembers) {
    try {
      await guild.members.fetch();
    } catch {
      return { processed: 0, changed: 0, skipped: "fetchFailed" };
    }
  }

  let processed = 0;
  let changed = 0;

  for (const member of guild.members.cache.values()) {
    if (!member || member.user?.bot) continue;

    const entry = getUserPseudos(guild.id, member.user.id);
    const pseudo = pickPriorityPseudo(entry, member.user.username);
    const roleLabel = pickRoleLabel(member, cfg);
    const postsLabel = pickPostsLabel(member, cfg);
    const targetNick = buildNick(pseudo, roleLabel, postsLabel);

    const currentNick = member.nickname || null;
    if (currentNick !== targetNick) {
      try {
        await member.setNickname(targetNick, "SYNC_PSEUDO_MANUAL");
        changed++;
      } catch {
        // pas de permissions => ignore
      }
    }

    processed++;
    if (processed % 500 === 0) await new Promise((r) => setTimeout(r, 50));
  }

  return { processed, changed, skipped: null };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sync_pseudo")
    .setDescription("Force une sync pseudo immédiate (sans rappel).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: "⛔", ephemeral: true });

      // double sécurité
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "⛔", ephemeral: true });
      }

      await interaction.reply({ content: "🔁", ephemeral: true });

      const res = await runSyncNow(interaction.guild);

      if (res.skipped === "syncDisabled") {
        return interaction.editReply({ content: "⏹️" });
      }
      if (res.skipped === "fetchFailed") {
        return interaction.editReply({ content: "⚠️" });
      }

      // Retour compact (emoji-only demandé globalement)
      // ✅ = OK + chiffres en petit texte (sinon tu n'auras aucune info)
      return interaction.editReply({
        content: `✅ ${res.changed}/${res.processed}`,
      });
    } catch (e) {
      warn("[SYNC_PSEUDO_ERROR]", e);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: "⚠️", ephemeral: true });
        } else {
          await interaction.reply({ content: "⚠️", ephemeral: true });
        }
      } catch {}
    }
  },
};
