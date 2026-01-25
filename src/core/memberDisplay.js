// src/core/memberDisplay.js
// Format: "PSEUDO | RÔLE | POSTE1/POSTE2/POSTE3"
//
// PSEUDO priorité: PSN > XBOX > EA > username Discord
// ✅ Username: supprime chiffres + caractères spéciaux + espaces (lettres uniquement, collées)
// ✅ Pseudo: enlève "psn/xbox/ea" si jamais présent (psn:, xbox:, ea:, / etc.)
// RÔLE priorité: Président > Fondateur > GM > coGM > STAFF
// ✅ Rôle: détection par NOM des rôles (Président, Fondateur, GM, coGM, Staff)
// ✅ Staff fallback: si membre a un des cfg.staffRoleIds (setup) -> "STAFF" (ou admin)
// POSTES: max 3, ordre cfg.postRoleIds (0..25)
// ✅ Postes: libellé = nom du rôle Discord (pas de label poste)

const { PermissionFlagsBits } = require("discord.js");
const { getUserPseudos } = require("./pseudoStore");

function cleanValue(v, max = 40) {
  return String(v || "")
    .replace(/[`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// ✅ Username: lettres uniquement, SANS espaces
function normalizeUsername(username) {
  const raw = String(username || "");

  // retire accents
  const noAccents = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

  // garde seulement A-Z (supprime chiffres, спец, espaces)
  const lettersOnly = noAccents.replace(/[^a-zA-Z]/g, "");

  if (!lettersOnly) return "User";

  // tu peux choisir lower/upper; ici: 1ère lettre maj, reste min
  return lettersOnly.charAt(0).toUpperCase() + lettersOnly.slice(1).toLowerCase();
}

// ✅ enlève toute mention psn/xbox/ea au début si un joueur l’a tapée
// Ex: "psn:ID" / "psn:/ID" / "psn ID" / "/ID" => "ID"
// (on ne remet PAS de préfixe)
function stripAnyPlatformPrefix(value) {
  let v = cleanValue(value, 60);
  if (!v) return "";

  // enlève "/"
  v = v.replace(/^\/+/, "").trim();

  // enlève "psn:" "xbox:" "ea:" + variantes espaces/"/"
  v = v.replace(/^(psn|xbox|ea)\s*[:\s/]+/i, "").trim();

  // sécurité: re-clean
  return cleanValue(v, 40);
}

function pickBestPseudo(member) {
  const entry = getUserPseudos(member.guild.id, member.user.id) || {};

  const psn = stripAnyPlatformPrefix(entry.psn);
  const xbox = stripAnyPlatformPrefix(entry.xbox);
  const ea = stripAnyPlatformPrefix(entry.ea);

  if (psn) return psn;
  if (xbox) return xbox;
  if (ea) return ea;

  // fallback username (lettres uniquement, sans espaces)
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

  const staffRoleIds = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  if (isAdmin || hasAnyRoleId(member, staffRoleIds)) return "STAFF";

  return null;
}

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
