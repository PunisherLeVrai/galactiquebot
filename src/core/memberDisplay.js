// src/core/memberDisplay.js
// Format : "NOM | RÔLE | POSTE1/POSTE2/POSTE3"
// NOM = priorité : PSN > XBOX > EA > username Discord clean (sans chiffres/symboles + Maj)
// RÔLE = déterministe (ordre fixe), ignore hiérarchie Discord
// POSTE = 0..3 postes (labels depuis setup) join par "/"
// Aucun bloc vide après "|" (on omet les blocs absents)
// ✅ Gestion accents + underscore + espaces multiples (username)
// ✅ Nettoyage des pseudos plateformes (trim / collapse spaces / limite)
// CommonJS

const pseudoStore = require("./pseudoStore");

function cleanValue(v, max = 40) {
  if (!v) return "";
  return String(v)
    .replace(/[`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanUsername(raw) {
  if (!raw) return "User";

  // garde lettres + espaces (retire chiffres + symboles) + enlève accents
  const noAccents = String(raw)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

  const lettersSpaces = noAccents
    .replace(/[^a-zA-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!lettersSpaces) return "User";

  // Maj au début, le reste en minuscules (plus stable/clean)
  return lettersSpaces.charAt(0).toUpperCase() + lettersSpaces.slice(1).toLowerCase();
}

function getBestName(member) {
  if (!member) return "User";

  const guildId = member.guild?.id;
  const userId = member.user?.id;
  if (!guildId || !userId) return "User";

  // pseudos stockés
  const entry = pseudoStore.getUserPseudos(guildId, userId);

  // Priorité stricte : PSN > XBOX > EA
  const psn = cleanValue(entry?.psn);
  const xbox = cleanValue(entry?.xbox);
  const ea = cleanValue(entry?.ea);

  if (psn) return psn;
  if (xbox) return xbox;
  if (ea) return ea;

  // Fallback : username clean
  return cleanUsername(member.user?.username || "");
}

function hasRole(member, roleId) {
  if (!member || !roleId) return false;
  return member.roles?.cache?.has(roleId) === true;
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
  const defs = Array.isArray(postDefs) ? postDefs : [];
  const posts = [];

  for (const p of defs) {
    if (!p?.id) continue;
    if (hasRole(member, p.id)) {
      posts.push(cleanValue(p.label || "POSTE", 24) || "POSTE");
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

  // Aucun bloc vide après "|"
  const parts = [name];
  if (role) parts.push(role);
  if (postStr) parts.push(postStr);

  return parts.join(" | ");
}

module.exports = {
  buildMemberLine,
  cleanUsername,
  getBestName,
  resolveMainRole,
  resolvePosts,
};
