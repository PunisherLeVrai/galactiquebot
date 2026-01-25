// src/core/memberDisplay.js
// Format: "PSEUDO | RÔLE | POSTE1/POSTE2/POSTE3"
//
// PSEUDO priorité: PSN > XBOX > EA > username Discord
// ✅ Préfixe obligatoire sur plateformes: "psn:" / "xbox:" / "ea:"
// RÔLE priorité: Président > Fondateur > GM > coGM > STAFF
// ✅ Sans config de labels: détection par NOM de rôle (Discord) + fallback STAFF si membre a un rôle staff configuré
// POSTES: max 3, ordre cfg.postRoleIds (0..25), libellé = nom du rôle (Discord)
// Aucun bloc vide: si pas de rôle, on n'affiche pas le bloc

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

  // accepte déjà "psn:xxx" / "psn:/xxx" (tolérance) -> normalise en "psn:xxx"
  const lowered = v.toLowerCase();
  if (lowered.startsWith(wanted)) return `${wanted}${v.slice(wanted.length).trim().replace(/^\/+/, "")}`.trim();

  // si l'utilisateur a tapé "psn:/xxx" ou "/xxx"
  if (lowered.startsWith(`${wanted}/`)) return `${wanted}${v.slice((wanted + "/").length).trim()}`.trim();

  return `${wanted}${v}`.trim();
}

function pickBestPseudo(member) {
  const entry = getUserPseudos(member.guild.id, member.user.id);
  const psn = cleanValue(entry?.psn);
  const xbox = cleanValue(entry?.xbox);
  const ea = cleanValue(entry?.ea);

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

  // admin = considéré staff -> renvoie STAFF si rien de plus précis trouvé
  const isAdmin = member.permissions?.has?.(PermissionFlagsBits.Administrator);

  // priorité demandée (par nom de rôle Discord)
  const order = [
    { keyword: "président", label: "Président" },
    { keyword: "president", label: "Président" }, // tolérance sans accent
    { keyword: "fondateur", label: "Fondateur" },
    { keyword: "founder", label: "Fondateur" }, // tolérance
    { keyword: "gm", label: "GM" },
    { keyword: "cogm", label: "coGM" },
    { keyword: "co gm", label: "coGM" },
    { keyword: "co-gm", label: "coGM" },
  ];

  // 1) détection par nom de rôle
  const roles = member.roles?.cache;
  if (roles) {
    for (const it of order) {
      const found = roles.find((r) => roleNameMatches(r?.name, it.keyword));
      if (found) return it.label;
    }
    // STAFF si un rôle s'appelle "staff"
    const staffByName = roles.find((r) => roleNameMatches(r?.name, "staff"));
    if (staffByName) return "STAFF";
  }

  // 2) fallback STAFF si le membre a un des rôles staff configurés (setup)
  const staffRoleIds = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  if (hasAnyRoleId(member, staffRoleIds) || isAdmin) return "STAFF";

  return null;
}

function resolvePosts(member, cfg) {
  const ids = Array.isArray(cfg?.postRoleIds)
    ? cfg.postRoleIds
    : Array.isArray(cfg?.posts) // compat legacy [{roleId,label}]
      ? cfg.posts.map((p) => p?.roleId).filter(Boolean)
      : [];

  const ordered = ids.map(String).filter(Boolean);
  const out = [];

  for (const roleId of ordered) {
    const role = member.roles.cache.get(roleId);
    if (role) {
      const name = cleanValue(role.name, 16) || "POSTE";
      out.push(name);
      if (out.length >= 3) break;
    }
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
