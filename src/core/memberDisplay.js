// src/core/memberDisplay.js
// Format : "NOM | RÔLE | POSTE1/POSTE2/POSTE3"
// NOM = priorité : PSN > XBOX > EA > username Discord clean (sans chiffres/symboles + Maj)
// RÔLE = déterministe via cfg.mainRoles (Président/Fondateur/GM/coGM/STAFF) — "Membre" jamais affiché
// POSTE = 0..3 postes détectés depuis cfg.posts (liste complète détectable), join par "/"
// Aucun bloc vide : si pas de rôle => pas de " | " inutile ; si pas de postes => idem
// CommonJS

const { getUserPseudos } = require("./pseudoStore");

function cleanUsername(raw) {
  // Username Discord (pas pseudo serveur) nettoyé : lettres uniquement, Maj au début
  if (!raw) return "User";

  let name = String(raw);

  // retire chiffres
  name = name.replace(/[0-9]/g, "");

  // retire tout sauf lettres A-Z
  name = name.replace(/[^a-zA-Z]/g, "");

  name = name.trim();
  if (!name.length) return "User";

  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function getBestName(member) {
  if (!member?.guild?.id || !member?.user?.id) return "User";

  const entry = getUserPseudos(member.guild.id, member.user.id);

  // Priorité stricte : PSN > XBOX > EA
  if (entry?.psn) return entry.psn;
  if (entry?.xbox) return entry.xbox;
  if (entry?.ea) return entry.ea;

  // Fallback : username clean (PAS le pseudo serveur)
  return cleanUsername(member.user.username || "");
}

function hasRole(member, roleId) {
  if (!member || !roleId) return false;
  return member.roles?.cache?.has(roleId) === true;
}

/**
 * Rôle principal forcé (ignore hiérarchie Discord)
 * cfg.mainRoles = {
 *   president:{id}, fondateur:{id}, gm:{id}, cogm:{id}, staff:{id}
 * }
 * Retourne: "Président" | "Fondateur" | "GM" | "coGM" | "STAFF" | null
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

  // IMPORTANT: on ne renvoie jamais "Membre"
  return null;
}

/**
 * Postes 0..3 (POSTE1/POSTE2/POSTE3)
 * cfg.posts = [{ id: "roleId", label: "MDC" }, ...]
 * Détecte sur TOUTE la liste, et renvoie les 3 premiers matchés (ordre cfg.posts)
 */
function resolvePosts(member, postDefs = [], limit = 3) {
  const posts = [];
  const defs = Array.isArray(postDefs) ? postDefs : [];

  for (const p of defs) {
    if (!p?.id) continue;
    if (!hasRole(member, p.id)) continue;

    const label = String(p.label || "").trim();
    posts.push(label || "POSTE");

    if (posts.length >= limit) break;
  }

  return posts;
}

/**
 * Build final line :
 * - "Chris" si rien
 * - "Punisher | Président"
 * - "Mattlsm | MDC"
 * - "Nom | Rôle | Poste1/Poste2/Poste3"
 */
function buildMemberLine(member, cfg = {}) {
  const name = getBestName(member);

  const role = resolveMainRole(member, cfg.mainRoles || {});
  const postList = resolvePosts(member, cfg.posts || [], 3);

  const parts = [name];

  if (role) parts.push(role);

  if (postList.length) parts.push(postList.join("/"));

  return parts.join(" | ");
}

module.exports = {
  buildMemberLine,
  cleanUsername,
  getBestName,
  resolveMainRole,
  resolvePosts,
};
