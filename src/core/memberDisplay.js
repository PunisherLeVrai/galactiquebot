// src/core/memberDisplay.js
// Format : "NOM | RÔLE | POSTE1/POSTE2/POSTE3"
// NOM = priorité : PSN > XBOX > EA > username Discord clean (sans chiffres/symboles + Maj)
// RÔLE = déterministe (ordre fixe), ignore hiérarchie Discord
// POSTE = 0..3 postes (labels depuis setup) join par "/"
// Aucun bloc vide après "|" (on omet les blocs absents)
// CommonJS

const pseudoStore = require("./pseudoStore");

function cleanUsername(raw) {
  if (!raw) return "User";

  // Supprime chiffres + caractères spéciaux, garde lettres uniquement
  let name = String(raw).replace(/[0-9]/g, "");
  name = name.replace(/[^a-zA-Z]/g, "");

  if (!name.length) return "User";
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function getBestName(member) {
  if (!member) return "User";

  // On lit les pseudos stockés (peut contenir plusieurs plateformes)
  const entry = pseudoStore.getUserPseudos(member.guild.id, member.user.id);

  // Priorité stricte : PSN > XBOX > EA
  if (entry?.psn) return entry.psn;
  if (entry?.xbox) return entry.xbox;
  if (entry?.ea) return entry.ea;

  // Fallback : username clean
  return cleanUsername(member.user?.username || "");
}

function hasRole(member, roleId) {
  if (!member || !roleId) return false;
  return member.roles.cache.has(roleId);
}

/**
 * RÔLE forcé : ordre fixe (ignore la hiérarchie Discord)
 */
function resolveMainRole(member, mainRoles = {}) {
  const order = ["president", "fondateur", "gm", "cogm", "staff"];
  const labels = {
    president: "Président",
    fondateur: "Fondateur",
    gm: "GM",
    cogm: "coGM",
    staff: "STAFF",
  };

  for (const key of order) {
    const id = mainRoles?.[key]?.id || null;
    if (id && hasRole(member, id)) return labels[key];
  }
  return null;
}

/**
 * POSTES 0..3, ordre déterministe basé sur cfg.posts (setup)
 * cfg.posts = [{ id, label }]
 */
function resolvePosts(member, postDefs = []) {
  const posts = [];
  for (const p of postDefs) {
    if (!p?.id) continue;
    if (hasRole(member, p.id)) {
      posts.push(p.label || "POSTE");
      if (posts.length >= 3) break;
    }
  }
  return posts;
}

function buildMemberLine(member, cfg = {}) {
  const name = getBestName(member);

  const role = resolveMainRole(member, cfg.mainRoles || {});
  const postList = resolvePosts(member, cfg.posts || []);
  const postStr = postList.length ? postList.join("/") : null;

  const parts = [name];
  if (role) parts.push(role);
  if (postStr) parts.push(postStr);

  return parts.join(" | ");
}

module.exports = {
  buildMemberLine,
  cleanUsername,
  resolveMainRole,
  resolvePosts,
};
