// src/core/memberDisplay.js
// Format: "PSEUDO | RÔLE | POSTE1/POSTE2/POSTE3"
//
// PSEUDO priorité: PSN > XBOX > EA > username Discord
// ✅ Affichage PSEUDO: sans "psn/xbox/ea" (ID pur)
// ✅ Username fallback: supprime chiffres + caractères spéciaux + espaces (garde uniquement A-Z)
// ✅ RÔLE (staff only): Président > Fondateur > GM > coGM > STAFF
//    - détection par NOM des rôles (Président, Fondateur, GM, coGM, Staff)
//    - fallback: si membre a un des cfg.staffRoleIds => "STAFF"
// ✅ Postes: max 3, ordre cfg.postRoleIds (0..25), libellé = nom du rôle Discord (entier)
// ✅ Nickname final: max 32 caractères (Discord)

const { PermissionFlagsBits } = require("discord.js");
const { getUserPseudos } = require("./pseudoStore");

// --------------------
// Utils
// --------------------
function cleanValue(v, max = 200) {
  return String(v ?? "")
    .replace(/[`|]/g, "") // "|" casse le format
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// --------------------
// USERNAME fallback
// --------------------
// - retire accents
// - garde uniquement A-Z
// - supprime espaces/chiffres/symboles (concatène)
// - si vide => "User"
function normalizeUsernameStrict(username) {
  const raw = String(username || "");
  const noAccents = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const lettersOnly = noAccents.replace(/[^a-zA-Z]/g, "");
  if (!lettersOnly) return "User";
  return lettersOnly.charAt(0).toUpperCase() + lettersOnly.slice(1).toLowerCase();
}

// --------------------
// PSEUDO (PSN/XBOX/EA)
// --------------------
// Stockage possible: "psn:xxx" ou "xxx"
// Affichage: on enlève le préfixe quoi qu'il arrive (ID pur)
function stripAnyPlatformPrefix(value) {
  const v = cleanValue(value, 80);
  if (!v) return "";
  return v.replace(/^\s*(psn|xbox|ea)\s*:\s*\/?\s*/i, "").trim();
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
// STAFF ROLE (Président/Fondateur/GM/coGM/STAFF)
// --------------------
function roleNameMatches(roleName, keywords) {
  const n = String(roleName || "").toLowerCase();
  return keywords.some((k) => {
    const kk = String(k).toLowerCase();
    return n === kk || n.includes(kk);
  });
}

function hasAnyRoleId(member, roleIds) {
  const ids = Array.isArray(roleIds) ? roleIds : [];
  return ids.some((id) => id && member.roles.cache.has(String(id)));
}

/**
 * resolveMainRole(member, cfg)
 * Retourne UNIQUEMENT un rôle "staff" au format demandé.
 * Priorité: Président > Fondateur > GM > coGM > STAFF
 */
function resolveMainRole(member, cfg) {
  if (!member) return null;

  const roles = member.roles?.cache;
  const isAdmin = member.permissions?.has?.(PermissionFlagsBits.Administrator);

  // 1) Détection par NOM de rôle (priorité stricte)
  //    (on ne renvoie PAS le nom du rôle, mais le libellé standard)
  const order = [
    { label: "Président", keywords: ["président", "president"] },
    { label: "Fondateur", keywords: ["fondateur", "founder"] },
    // ⚠️ GM avant coGM
    { label: "GM", keywords: ["gm"] },
    { label: "coGM", keywords: ["cogm", "co gm", "co-gm", "co_gm"] },
    { label: "STAFF", keywords: ["staff"] },
  ];

  if (roles && roles.size) {
    for (const it of order) {
      const found = roles.find((r) => r && roleNameMatches(r.name, it.keywords));
      if (found) return it.label;
    }
  }

  // 2) Fallback: si admin ou si membre a un des rôles staff configurés dans /setup
  const staffRoleIds = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  if (isAdmin || hasAnyRoleId(member, staffRoleIds)) return "STAFF";

  return null;
}

// --------------------
// POSTES (max 3)
// --------------------
// - ordre cfg.postRoleIds
// - libellé = nom du rôle Discord entier (nettoyé), pas de label poste
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

    const guildRole = member.guild?.roles?.cache?.get(roleId);
    const roleName = cleanValue(guildRole?.name || member.roles.cache.get(roleId)?.name, 80);

    if (roleName) out.push(roleName);
    if (out.length >= 3) break;
  }

  return out;
}

// --------------------
// BUILD LINE (max 32 chars)
// --------------------
function buildMemberLine(member, cfg) {
  const pseudo = pickBestPseudo(member);
  const role = resolveMainRole(member, cfg);
  const posts = resolvePosts(member, cfg);

  const parts = [pseudo];
  if (role) parts.push(role);
  if (posts.length) parts.push(posts.join("/"));

  // Discord nickname max 32
  return parts.join(" | ").slice(0, 32);
}

module.exports = {
  buildMemberLine,
  resolveMainRole,
  resolvePosts,
};
