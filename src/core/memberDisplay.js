// src/core/memberDisplay.js
// Format: "PSEUDO | RÔLE | POSTE1/POSTE2/POSTE3"
//
// PSEUDO priorité: PSN > XBOX > EA > username Discord
// ✅ Préfixe obligatoire: psn:/xbox:/ea:
// RÔLE priorité: Président > Fondateur > GM > coGM > STAFF
// ✅ Rôle: détection par NOM des rôles (Président, Fondateur, GM, coGM, Staff)
// ✅ Staff fallback: si membre a un des cfg.staffRoleIds (setup) -> "STAFF" (ou admin)
// POSTES: max 3, ordre cfg.postRoleIds (0..25)
// ✅ Postes: libellé = nom du rôle Discord (pas de label poste)

const { PermissionFlagsBits } = require("discord.js");
const { getUserPseudos } = require("./pseudoStore");

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

function cleanValue(v, max = 40) {
  return String(v || "")
    .replace(/[`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function ensurePrefix(platform, value) {
  const v = cleanValue(value);
  if (!v) return "";

  const p = String(platform || "").toLowerCase();
  const wanted = `${p}:`;
  const lowered = v.toLowerCase();

  // déjà OK: "psn:xxxx" ou "psn:/xxxx"
  if (lowered.startsWith(wanted)) {
    const rest = v.slice(wanted.length).trim().replace(/^\/+/, "");
    return `${wanted}${rest}`.trim();
  }

  // tolère "/xxxx" -> on ajoute le préfixe
  if (lowered.startsWith("/")) {
    const rest = v.replace(/^\/+/, "").trim();
    return `${wanted}${rest}`.trim();
  }

  // tolère "psn / xxxx" (espaces) -> on normalise
  if (lowered.startsWith(`${p} `) || lowered.startsWith(`${p}/`)) {
    const rest = v.slice(p.length).replace(/^[:\s/]+/, "").trim();
    return `${wanted}${rest}`.trim();
  }

  return `${wanted}${v}`.trim();
}

function pickBestPseudo(member) {
  const entry = getUserPseudos(member.guild.id, member.user.id) || {};

  const psn = cleanValue(entry.psn);
  const xbox = cleanValue(entry.xbox);
  const ea = cleanValue(entry.ea);

  // priorité PSN > XBOX > EA
  if (psn) return ensurePrefix("psn", psn);
  if (xbox) return ensurePrefix("xbox", xbox);
  if (ea) return ensurePrefix("ea", ea);

  return normalizeUsername(member.user?.username);
}

function hasAnyRoleId(member, roleIds) {
  const ids = Array.isArray(roleIds) ? roleIds : [];
  return ids.some((id) => id && member.roles.cache.has(String(id)));
}

function roleNameMatches(roleName, keyword) {
  const a = String(roleName || "").toLowerCase();
  const k = String(keyword || "").toLowerCase();
  return a === k || a.includes(k);
}

function resolveMainRole(member, cfg) {
  if (!member) return null;

  const isAdmin = member.permissions?.has?.(PermissionFlagsBits.Administrator);

  // Priorité demandée (par NOM de rôle Discord)
  const order = [
    { keywords: ["président", "president"], label: "Président" },
    { keywords: ["fondateur", "founder"], label: "Fondateur" },
    { keywords: ["gm"], label: "GM" },
    { keywords: ["cogm", "co gm", "co-gm", "co_gm"], label: "coGM" },
    { keywords: ["staff"], label: "STAFF" },
  ];

  const roles = member.roles?.cache;
  if (roles) {
    for (const it of order) {
      for (const kw of it.keywords) {
        const found = roles.find((r) => roleNameMatches(r?.name, kw));
        if (found) return it.label;
      }
    }
  }

  // Fallback STAFF si rôle staff configuré (setup) ou admin
  const staffRoleIds = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  if (isAdmin || hasAnyRoleId(member, staffRoleIds)) return "STAFF";

  return null;
}

function resolvePosts(member, cfg) {
  if (!member) return [];

  // Source de vérité: cfg.postRoleIds (0..25)
  // Compat: cfg.posts legacy [{roleId,label}] -> roleId
  const ids = Array.isArray(cfg?.postRoleIds)
    ? cfg.postRoleIds
    : Array.isArray(cfg?.posts)
      ? cfg.posts.map((p) => p?.roleId).filter(Boolean)
      : [];

  const ordered = ids.map(String).filter(Boolean);
  const out = [];

  for (const roleId of ordered) {
    if (!member.roles.cache.has(roleId)) continue;

    // On récupère le nom du rôle depuis le cache du serveur (plus fiable que member.roles)
    const guildRole = member.guild?.roles?.cache?.get(roleId);
    const name = cleanValue(guildRole?.name || member.roles.cache.get(roleId)?.name, 16);

    out.push(name || "POSTE");
    if (out.length >= 3) break;
  }

  return out;
}

function buildMemberLine(member, cfg) {
  const pseudo = pickBestPseudo(member);
  const role = resolveMainRole(member, cfg);
  const posts = resolvePosts(member, cfg);

  const parts = [pseudo];
  if (role) parts.push(role);
  if (posts.length) parts.push(posts.join("/"));

  return parts.join(" | ");
}

module.exports = {
  buildMemberLine,
  resolveMainRole,
  resolvePosts,
};
