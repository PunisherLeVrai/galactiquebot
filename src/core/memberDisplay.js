// src/core/memberDisplay.js
// Format: "PSEUDO | RÔLE | POSTE1/POSTE2/POSTE3"
//
// PSEUDO priorité: PSN > XBOX > EA > username Discord
// RÔLE (staff only): basé UNIQUEMENT sur cfg.staffRoleIds (setup)
// Priorité stricte selon hiérarchie Discord, puis mapping :
// Président > Fondateur > GM > coGM > STAFF
//
// POSTES: ordre cfg.postRoleIds (0..25), max 3, nom du rôle complet
//
// Nickname final: max 32 caractères

const { PermissionFlagsBits } = require("discord.js");
const { getUserPseudos } = require("./pseudoStore");

// --------------------
// Utils
// --------------------
function cleanValue(v, max = 200) {
  return String(v ?? "")
    .replace(/[`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// --------------------
// USERNAME fallback
// --------------------
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
// RÔLE STAFF UNIQUEMENT (selon setup)
// --------------------
function resolveMainRole(member, cfg) {
  if (!member) return null;

  const staffRoleIds = Array.isArray(cfg?.staffRoleIds)
    ? cfg.staffRoleIds.map(String)
    : [];

  if (!staffRoleIds.length) return null;

  // On filtre uniquement les rôles staff définis dans le setup
  const staffRoles = member.roles?.cache?.filter((r) => r && staffRoleIds.includes(String(r.id)));
  if (!staffRoles || staffRoles.size === 0) return null;

  // On prend le rôle staff le plus haut (position Discord)
  const top = staffRoles.sort((a, b) => b.position - a.position).first();
  if (!top) return "STAFF";

  const name = String(top.name).toLowerCase();

  // Mapping exact
  if (name.includes("président") || name.includes("president")) return "Président";
  if (name.includes("fondateur") || name.includes("founder")) return "Fondateur";

  // coGM avant GM
  if (
    name.includes("cogm") ||
    name.includes("co gm") ||
    name.includes("co-gm") ||
    name.includes("co_gm") ||
    name.includes("co general manager")
  ) {
    return "coGM";
  }

  // GM (évite de matcher coGM)
  if (/\bgm\b/.test(name) || name.includes("general manager")) return "GM";

  return "STAFF";
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

    const guildRole = member.guild?.roles?.cache?.get(roleId);
    const roleName = cleanValue(guildRole?.name || member.roles.cache.get(roleId)?.name, 80);

    if (roleName) out.push(roleName);
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

  return parts.join(" | ").slice(0, 32);
}

module.exports = {
  buildMemberLine,
  resolveMainRole,
  resolvePosts,
};
