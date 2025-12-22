// utils/nickname.js
const MAX_LEN = 32;

function cleanPseudo(username, room = MAX_LEN) {
  if (!username) return 'Joueur';

  // Supprime tout sauf lettres (comme ton code actuel)
  let clean = username.replace(/[^A-Za-z]/g, '');
  if (!clean.length) return 'Joueur';

  // 1ère lettre maj, reste min
  clean = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();

  if (clean.length > room) clean = clean.slice(0, room - 1) + '…';
  return clean;
}

function getHierarchy(member, hierarchyRoles = []) {
  const found = hierarchyRoles.find(r => member.roles.cache.has(r.id));
  return found ? found.label : null;
}

function getTeam(member, teamRoles = []) {
  const found = teamRoles.find(r => member.roles.cache.has(r.id));
  return found ? found.label : null;
}

function getPostes(member, posteRoles = []) {
  return posteRoles
    .filter(p => member.roles.cache.has(p.id))
    .map(p => p.label)
    .slice(0, 3);
}

/**
 * Nouveau format:
 * Pseudo | MID | Poste1/Poste2/Poste3
 * MID = Hiérarchie (si existe) sinon Team
 */
function buildNickname(member, nicknameCfg = {}, tagFromConfig = 'XIG') {
  const hierarchyRoles = Array.isArray(nicknameCfg.hierarchy) ? nicknameCfg.hierarchy : [];
  const teamRoles = Array.isArray(nicknameCfg.teams) ? nicknameCfg.teams : [];
  const posteRoles = Array.isArray(nicknameCfg.postes) ? nicknameCfg.postes : [];

  const hierarchy = getHierarchy(member, hierarchyRoles);
  const team = getTeam(member, teamRoles);
  const mid = hierarchy || team || '';

  const postesArr = getPostes(member, posteRoles);
  const postes = postesArr.length ? postesArr.join('/') : '';

  // Pseudo “propre”
  const pseudoBase = cleanPseudo(member.user.username, MAX_LEN);

  // Construction
  const parts = [pseudoBase, mid, postes].filter(Boolean);
  let full = parts.join(' | ');

  // Sécurité 32 chars : on réduit le pseudo en priorité
  if (full.length > MAX_LEN) {
    const fixedSuffix = parts.slice(1).join(' | '); // mid + postes
    const suffix = fixedSuffix ? ` | ${fixedSuffix}` : '';

    const roomForPseudo = Math.max(3, MAX_LEN - suffix.length);
    const trimmedPseudo = cleanPseudo(member.user.username, roomForPseudo);

    full = `${trimmedPseudo}${suffix}`;
  }

  return full.slice(0, MAX_LEN);
}

module.exports = {
  buildNickname,
  cleanPseudo
};
