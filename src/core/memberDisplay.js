// src/core/memberDisplay.js
//
// Format final :
// POSTE / RÔLE / PSEUDO
//
// Tout le nickname est forcé en MAJUSCULES.
//
// PSEUDO :
// pseudo > psn > xbox > ea > username Discord
//
// RÔLE :
// 1) rôle STAFF le plus haut parmi cfg.staffRoleIds
// 2) sinon rôle joueur configuré dans cfg.displayRoleId
//
// POSTES :
// ordre cfg.postRoleIds, maximum 3.
//
// Discord limite les nicknames à 32 caractères.

const { getUserPseudos } = require("./pseudoStore");

// --------------------
// Utils
// --------------------
function cleanValue(value, max = 200) {
  return String(value ?? "")
    .replace(/[`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function upper(value) {
  return cleanValue(value).toLocaleUpperCase("fr-FR");
}

// --------------------
// USERNAME fallback
// --------------------
function normalizeUsername(username) {
  const value = cleanValue(username, 40);
  return value || "USER";
}

// --------------------
// PSEUDO
// --------------------
function stripAnyPlatformPrefix(value) {
  const cleaned = cleanValue(value, 80);
  if (!cleaned) return "";

  return cleaned
    .replace(/^\s*(psn|xbox|ea)\s*:\s*\/?\s*/i, "")
    .trim();
}

function pickBestPseudo(member) {
  const entry = getUserPseudos(member.guild.id, member.user.id) || {};

  const directPseudo = cleanValue(entry.pseudo, 40);
  const psn = stripAnyPlatformPrefix(entry.psn);
  const xbox = stripAnyPlatformPrefix(entry.xbox);
  const ea = stripAnyPlatformPrefix(entry.ea);

  if (directPseudo) return directPseudo;
  if (psn) return psn;
  if (xbox) return xbox;
  if (ea) return ea;

  return normalizeUsername(member.user?.username);
}

// --------------------
// RÔLE STAFF
// --------------------
function mapStaffRoleName(roleName) {
  const name = String(roleName || "").toLowerCase();

  if (name.includes("président") || name.includes("president")) return "PRÉSIDENT";
  if (name.includes("fondateur") || name.includes("founder")) return "FONDATEUR";

  // coGM avant GM
  if (
    name.includes("cogm") ||
    name.includes("co gm") ||
    name.includes("co-gm") ||
    name.includes("co_gm") ||
    name.includes("co general manager")
  ) {
    return "COGM";
  }

  if (/\bgm\b/.test(name) || name.includes("general manager")) {
    return "GM";
  }

  return upper(roleName || "STAFF");
}

function resolveStaffRole(member, cfg) {
  if (!member) return null;

  const staffRoleIds = Array.isArray(cfg?.staffRoleIds)
    ? cfg.staffRoleIds.map(String)
    : [];

  if (!staffRoleIds.length) return null;

  const staffRoles = member.roles?.cache?.filter(
    (role) => role && staffRoleIds.includes(String(role.id))
  );

  if (!staffRoles || staffRoles.size === 0) return null;

  // Priorité = hiérarchie Discord.
  const topRole = staffRoles.sort((a, b) => b.position - a.position).first();
  if (!topRole) return "STAFF";

  return mapStaffRoleName(topRole.name);
}

// --------------------
// RÔLE AFFICHÉ POUR LES NON-STAFF
// --------------------
function resolveConfiguredDisplayRole(member, cfg) {
  const roleId = cfg?.displayRoleId ? String(cfg.displayRoleId) : null;
  if (!roleId) return null;

  // Le rôle n'est affiché que si le membre le possède réellement.
  if (!member.roles?.cache?.has(roleId)) return null;

  const role = member.guild?.roles?.cache?.get(roleId);
  if (!role) return null;

  return upper(role.name);
}

function resolveMainRole(member, cfg) {
  return resolveStaffRole(member, cfg) || resolveConfiguredDisplayRole(member, cfg);
}

// --------------------
// POSTES (max 3)
// --------------------
function resolvePosts(member, cfg) {
  if (!member) return [];

  const ids = Array.isArray(cfg?.postRoleIds)
    ? cfg.postRoleIds
    : Array.isArray(cfg?.posts)
      ? cfg.posts.map((post) => post?.roleId).filter(Boolean)
      : [];

  const orderedRoleIds = ids.map(String).filter(Boolean);
  const posts = [];

  for (const roleId of orderedRoleIds) {
    if (!member.roles.cache.has(roleId)) continue;

    const role =
      member.guild?.roles?.cache?.get(roleId) ||
      member.roles.cache.get(roleId);

    const roleName = upper(role?.name);

    if (roleName) posts.push(roleName);
    if (posts.length >= 3) break;
  }

  return posts;
}

// --------------------
// BUILD LINE
// --------------------
function fitNickname(postsText, roleText, pseudoText) {
  const parts = [];
  if (postsText) parts.push(postsText);
  if (roleText) parts.push(roleText);

  const prefix = parts.length ? `${parts.join(" / ")} / ` : "";
  const maxPseudoLength = Math.max(1, 32 - prefix.length);
  const pseudo = pseudoText.slice(0, maxPseudoLength);

  return `${prefix}${pseudo}`.slice(0, 32);
}

function buildMemberLine(member, cfg) {
  const pseudo = upper(pickBestPseudo(member));
  const role = upper(resolveMainRole(member, cfg));
  const posts = resolvePosts(member, cfg).map(upper);

  // Plusieurs postes restent groupés dans le premier bloc :
  // DC/MDC / JOUEUR / PSEUDO
  const postsText = posts.join("/");

  return fitNickname(postsText, role, pseudo);
}

module.exports = {
  buildMemberLine,
  resolveMainRole,
  resolveStaffRole,
  resolveConfiguredDisplayRole,
  resolvePosts,
  pickBestPseudo,
};
