// src/core/memberDisplay.js
// Format: "PSEUDO | RÔLE | POSTE1/POSTE2/POSTE3"
// PSEUDO priorité: PSN > XBOX > EA > username Discord
// RÔLE priorité: Président > Fondateur > GM > coGM > STAFF
// POSTES: max 3, ordre cfg.posts
// Aucun bloc vide: si pas de rôle, on n'affiche pas le bloc

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

function pickBestPseudo(member) {
  const entry = getUserPseudos(member.guild.id, member.user.id);
  const psn = entry?.psn?.trim();
  const xbox = entry?.xbox?.trim();
  const ea = entry?.ea?.trim();

  if (psn) return psn;
  if (xbox) return xbox;
  if (ea) return ea;

  return normalizeUsername(member.user?.username);
}

function hasAnyRole(member, roleIds) {
  const ids = Array.isArray(roleIds) ? roleIds : [];
  return ids.some((id) => id && member.roles.cache.has(id));
}

function resolveMainRole(member, cfg) {
  const m = cfg?.mainRoles || {};
  const order = [
    { key: "president", label: "Président" },
    { key: "fondateur", label: "Fondateur" },
    { key: "gm", label: "GM" },
    { key: "cogm", label: "coGM" },
    { key: "staff", label: "STAFF" },
  ];

  for (const it of order) {
    if (hasAnyRole(member, m[it.key])) return it.label;
  }
  return null;
}

function resolvePosts(member, cfg) {
  const defs = Array.isArray(cfg?.posts) ? cfg.posts : [];
  const out = [];

  for (const p of defs) {
    if (!p?.roleId) continue;
    if (member.roles.cache.has(p.roleId)) {
      out.push(String(p.label || "POSTE").trim() || "POSTE");
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
