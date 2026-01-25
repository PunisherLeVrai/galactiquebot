// src/core/memberDisplay.js
// Format: "PSEUDO | RÔLE | POSTE1/POSTE2/POSTE3"
//
// PSEUDO priorité: PSN > XBOX > EA > username Discord
// ✅ Affichage PSEUDO: sans "psn/xbox/ea" (on affiche l'ID pur)
// ✅ Username fallback: supprime chiffres + caractères spéciaux + espaces (garde uniquement A-Z)
// ✅ Rôle: prend le rôle le plus haut hiérarchiquement (position Discord), hors @everyone
// ✅ Postes: max 3, ordre cfg.postRoleIds (0..25), libellé = nom du rôle Discord (pas de label)

const { getUserPseudos } = require("./pseudoStore");

function cleanValue(v, max = 64) {
  return String(v ?? "")
    .replace(/[`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// --------------------
// USERNAME fallback
// --------------------
// - retire accents
// - retire tout sauf A-Z
// - retire espaces (donc concatène)
// - si vide => "User"
function normalizeUsernameStrict(username) {
  const raw = String(username || "");

  const noAccents = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

  // garde uniquement A-Z
  const lettersOnly = noAccents.replace(/[^a-zA-Z]/g, "");
  if (!lettersOnly) return "User";

  // option: on normalise la casse (première majuscule, reste minuscule)
  return lettersOnly.charAt(0).toUpperCase() + lettersOnly.slice(1).toLowerCase();
}

// --------------------
// PSEUDO (PSN/XBOX/EA)
// --------------------
// Stockage: pseudos.json peut contenir "psn:xxx" ou "xxx"
// Affichage: on enlève le préfixe quoi qu'il arrive.
function stripAnyPlatformPrefix(value) {
  const v = cleanValue(value, 80);
  if (!v) return "";

  // enlève "psn:" "psn:/" "xbox:" "ea:" + espaces
  return v
    .replace(/^\s*(psn|xbox|ea)\s*:\s*\/?\s*/i, "")
    .trim();
}

function pickBestPseudo(member) {
  const entry = getUserPseudos(member.guild.id, member.user.id) || {};

  const psn = stripAnyPlatformPrefix(entry.psn);
  const xbox = stripAnyPlatformPrefix(entry.xbox);
  const ea = stripAnyPlatformPrefix(entry.ea);

  if (psn) return psn;
  if (xbox) return xbox;
  if (ea) return ea;

  return normalizeUsernameStrict(member.user?.username);
}

// --------------------
// ROLE = plus haut hiérarchiquement
// --------------------
function cleanRoleName(name, max = 16) {
  return String(name || "")
    .replace(/[`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function resolveMainRole(member) {
  if (!member) return null;

  const roles = member.roles?.cache;
  if (!roles || roles.size === 0) return null;

  // retire @everyone (id == guild.id)
  const filtered = roles.filter((r) => r && r.id !== member.guild?.id);
  if (filtered.size === 0) return null;

  // rôle le plus haut (position max)
  const top = filtered.sort((a, b) => b.position - a.position).first();
  if (!top) return null;

  return cleanRoleName(top.name, 16) || null;
}

// --------------------
// POSTES (max 3)
// --------------------
function resolvePosts(member, cfg) {
  if (!member) return [];

  const ids = Array.isArray(cfg?.postRoleIds)
    ? cfg.postRoleIds
    : Array.isArray(cfg?.posts)
      ? cfg.posts.map((p) => p?.roleId).filter(Boolean)
      : [];

  const ordered = ids.map(String).filter(Boolean);
  const out = [];

  for (const roleId of ordered) {
    if (!member.roles.cache.has(roleId)) continue;

    // nom du rôle depuis le cache serveur
    const guildRole = member.guild?.roles?.cache?.get(roleId);
    const name = cleanRoleName(guildRole?.name || member.roles.cache.get(roleId)?.name, 16);

    out.push(name || "POSTE");
    if (out.length >= 3) break;
  }

  return out;
}

// --------------------
// BUILD LINE
// --------------------
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
