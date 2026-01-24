// src/commands/admin/sync_pseudo.js
// Force une sync pseudo immédiate — Admin only
// ✅ Affichage: NOM [| RÔLE] [| POSTE1/POSTE2/POSTE3] (aucun bloc vide)
// ✅ Priorité pseudo: PSN > XBOX > EA > username clean
// ✅ Ne jamais afficher "Membre"
// ✅ Defer immédiat (réduit échecs interaction)
// CommonJS — discord.js v14

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getGuildConfig } = require("../../core/guildConfig");
const { getUserPseudos } = require("../../core/pseudoStore");
const { warn } = require("../../core/logger");

function normalizeValue(v, max = 40) {
  if (!v) return "";
  return String(v)
    .replace(/[`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Username fallback: supprime chiffres + caractères spéciaux, garde lettres, Maj au début
function normalizeUsername(username) {
  const raw = String(username || "");
  const noAccents = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const lettersOnly = noAccents.replace(/[^a-zA-Z]/g, ""); // lettres only
  if (!lettersOnly) return "User";
  return lettersOnly.charAt(0).toUpperCase() + lettersOnly.slice(1).toLowerCase();
}

// Priorité stricte: PSN > XBOX > EA > username clean
function pickPriorityPseudo(entry, fallbackUsername) {
  const psn = normalizeValue(entry?.psn, 40);
  const xbox = normalizeValue(entry?.xbox, 40);
  const ea = normalizeValue(entry?.ea, 40);
  if (psn) return psn;
  if (xbox) return xbox;
  if (ea) return ea;
  return normalizeUsername(fallbackUsername);
}

// Rôle affiché (mainRoles) — ignore hiérarchie Discord, ordre fixe
// Retourne null si aucun rôle match (et surtout PAS "Membre")
function pickRoleLabel(member, cfg) {
  const map = cfg?.mainRoles || {};
  const order = [
    { key: "president", label: "Président" },
    { key: "fondateur", label: "Fondateur" },
    { key: "gm", label: "GM" },
    { key: "cogm", label: "coGM" },
    { key: "staff", label: "STAFF" },
  ];

  for (const it of order) {
    const id = map?.[it.key]?.id;
    if (id && member.roles.cache.has(id)) return it.label;
  }
  return null;
}

// Postes : cfg.posts = [{ id, label }] (issus du setup)
// Retourne null si aucun poste détecté
function pickPostsLabel(member, cfg) {
  const posts = Array.isArray(cfg?.posts) ? cfg.posts : [];
  const found = [];

  for (const p of posts) {
    const roleId = p?.id;
    if (!roleId) continue;

    if (member.roles.cache.has(roleId)) {
      const label = String(p.label || "").trim();
      if (label) found.push(label);
      if (found.length >= 3) break;
    }
  }

  return found.length ? found.join("/") : null;
}

// Assemble sans blocs vides
function buildNick(name, roleLabel, postsLabel) {
  const parts = [];
  const n = String(name || "").trim() || "User";
  parts.push(n);

  const r = String(roleLabel || "").trim();
  if (r) parts.push(r);

  const p = String(postsLabel || "").trim();
  if (p) parts.push(p);

  return parts.join(" | ");
}

// Discord nickname max = 32
// On tronque intelligemment en gardant au moins le nom
function clampNick(nick) {
  const s = String(nick || "").trim();
  if (s.length <= 32) return s;

  // si format "A | B | C", on réduit d'abord C, puis B
  const parts = s.split(" | ").map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return "User";

  // Toujours garder un nom
  let name = parts[0].slice(0, 32);
  if (parts.length === 1) return name;

  let role = parts[1] || "";
  let posts = parts[2] || "";

  // Essai 3 parties
  let candidate = `${name} | ${role} | ${posts}`.trim();
  if (candidate.length <= 32) return candidate;

  // Réduire posts
  if (posts) {
    const maxPosts = Math.max(0, 32 - (`${name} | ${role} | `.length));
    posts = posts.slice(0, maxPosts);
    candidate = `${name} | ${role} | ${posts}`.trim().replace(/\s+\|$/, "");
    if (candidate.length <= 32 && posts) return candidate;
  }

  // Essai 2 parties
  candidate = `${name} | ${role}`.trim();
  if (candidate.length <= 32) return candidate;

  // Réduire role
  const maxRole = Math.max(0, 32 - (`${name} | `.length));
  role = role.slice(0, maxRole);
  candidate = `${name} | ${role}`.trim().replace(/\s+\|$/, "");
  if (candidate.length <= 32 && role) return candidate;

  return name.slice(0, 32);
}

async function runSyncNow(guild) {
  const cfg = getGuildConfig(guild.id) || {};
  const pseudoCfg = cfg.pseudo || {};

  if (pseudoCfg.syncEnabled === false) {
    return { processed: 0, changed: 0, failed: 0, skipped: "syncDisabled" };
  }

  const fetchMembers = pseudoCfg.syncFetchMembers !== false;
  if (fetchMembers) {
    try {
      await guild.members.fetch();
    } catch {
      return { processed: 0, changed: 0, failed: 0, skipped: "fetchFailed" };
    }
  }

  let processed = 0;
  let changed = 0;
  let failed = 0;

  let changedBurst = 0;

  for (const member of guild.members.cache.values()) {
    if (!member || member.user?.bot) continue;

    const entry = getUserPseudos(guild.id, member.user.id);
    const bestName = pickPriorityPseudo(entry, member.user.username);

    const roleLabel = pickRoleLabel(member, cfg);     // null si aucun
    const postsLabel = pickPostsLabel(member, cfg);   // null si aucun

    // Exemple attendu:
    // - Punisher | Président
    // - Mattlsm | MDC
    // - Chris
    const targetNick = clampNick(buildNick(bestName, roleLabel, postsLabel));

    const currentNick = member.nickname || null;

    if (currentNick !== targetNick) {
      try {
        await member.setNickname(targetNick, "SYNC_PSEUDO_MANUAL");
        changed++;
        changedBurst++;

        // micro-throttle pour éviter rate limits si gros serveur
        if (changedBurst >= 10) {
          changedBurst = 0;
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch {
        failed++;
      }
    }

    processed++;
    if (processed % 500 === 0) await new Promise((r) => setTimeout(r, 50));
  }

  return { processed, changed, failed, skipped: null };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sync_pseudo")
    .setDescription("Force une sync pseudo immédiate (silencieuse).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: "⛔", ephemeral: true });
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "⛔", ephemeral: true });
      }

      // ACK immédiat = moins d’échecs
      await interaction.deferReply({ ephemeral: true });

      const res = await runSyncNow(interaction.guild);

      if (res.skipped === "syncDisabled") return interaction.editReply({ content: "⏹️" });
      if (res.skipped === "fetchFailed") return interaction.editReply({ content: "⚠️" });

      // Emoji-only + stats compactes
      // ✅ changed/processed ❌ failed
      return interaction.editReply({ content: `✅ ${res.changed}/${res.processed} ❌ ${res.failed}` });
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
