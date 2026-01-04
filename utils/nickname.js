// utils/nickname.js
// ✅ Version complète + corrigée
// - Format configurable via nicknameCfg.format
// - Tokens : {PSEUDO} {MID} {HIER} {TEAM} {POSTES} {TAG} {CLUB}
// - MID = Hiérarchie si existe sinon Team
// - Trim intelligent 32 chars : on réduit le pseudo en priorité, puis fallback coupe proprement.

const MAX_LEN = 32;

function cleanPseudo(username, room = MAX_LEN) {
  if (!username) return 'Joueur';

  // Supprime tout sauf lettres
  let clean = String(username).replace(/[^A-Za-z]/g, '');
  if (!clean.length) return 'Joueur';

  // 1ère lettre maj, reste min
  clean = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();

  if (clean.length > room) clean = clean.slice(0, Math.max(1, room - 1)) + '…';
  return clean;
}

function getHierarchy(member, hierarchyRoles = []) {
  const found = hierarchyRoles.find(r => member.roles.cache.has(r.id));
  return found ? String(found.label || '') : '';
}

function getTeam(member, teamRoles = []) {
  const found = teamRoles.find(r => member.roles.cache.has(r.id));
  return found ? String(found.label || '') : '';
}

function getPostes(member, posteRoles = []) {
  return posteRoles
    .filter(p => member.roles.cache.has(p.id))
    .map(p => String(p.label || ''))
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeSep(str) {
  // Nettoie les doublons de séparateurs et espaces
  return String(str || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\|\s*/g, ' | ')          // uniformise
    .replace(/(\s\|\s){2,}/g, ' | ')      // " |  | " -> " | "
    .replace(/^\s*\|\s*/g, '')            // leading |
    .replace(/\s*\|\s*$/g, '')            // trailing |
    .trim();
}

function renderFromFormat(format, tokens) {
  let out = String(format || '').trim();

  // Remplacement tokens (keys en MAJ)
  out = out.replace(/\{([A-Z_]+)\}/g, (_, key) => {
    const v = tokens[key];
    return v ? String(v) : '';
  });

  out = normalizeSep(out);

  // Supprime les segments vides finaux
  out = out
    .split(' | ')
    .map(s => s.trim())
    .filter(Boolean)
    .join(' | ');

  return out;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * ✅ Build nickname configurable via nicknameCfg.format
 *
 * Tokens dispos :
 * {PSEUDO} {MID} {HIER} {TEAM} {POSTES} {TAG} {CLUB}
 *
 * MID = Hiérarchie si existe sinon Team
 */
function buildNickname(member, nicknameCfg = {}, guildCfg = {}) {
  const hierarchyRoles = Array.isArray(nicknameCfg.hierarchy) ? nicknameCfg.hierarchy : [];
  const teamRoles = Array.isArray(nicknameCfg.teams) ? nicknameCfg.teams : [];
  const posteRoles = Array.isArray(nicknameCfg.postes) ? nicknameCfg.postes : [];

  const hier = getHierarchy(member, hierarchyRoles);
  const team = getTeam(member, teamRoles);
  const mid = hier || team || '';

  const postesArr = getPostes(member, posteRoles);
  const postes = postesArr.length ? postesArr.join('/') : '';

  const tag = String(guildCfg?.tag || '').trim();
  const club = String(guildCfg?.clubName || '').trim();

  // ✅ Format par défaut
  const format = String(nicknameCfg.format || '{PSEUDO} | {MID} | {POSTES}').trim();

  const username = member?.user?.username || '';
  const basePseudo = cleanPseudo(username, MAX_LEN);

  const tokensBase = {
    PSEUDO: basePseudo,
    MID: mid,
    HIER: hier,
    TEAM: team,
    POSTES: postes,
    TAG: tag,
    CLUB: club
  };

  // 1) Render normal
  let out = renderFromFormat(format, tokensBase);
  if (out.length <= MAX_LEN) return out;

  // 2) Trim pseudo en priorité (mesure "overhead" du format autour du pseudo)
  const tokensNoPseudo = { ...tokensBase, PSEUDO: '' };
  const withoutPseudo = renderFromFormat(format, tokensNoPseudo);

  // Mesure l'impact réel d'un pseudo de 1 char pour capturer les séparateurs ajoutés
  const testOne = renderFromFormat(format, { ...tokensNoPseudo, PSEUDO: 'X' });

  // overheadTotal = (séparateurs + 'X') que le format ajoute quand PSEUDO existe
  const overheadTotal = Math.max(0, testOne.length - withoutPseudo.length);

  // overheadSep = overheadTotal - 1 (on retire 'X' = 1 char)
  const overheadSep = Math.max(0, overheadTotal - 1);

  // Place disponible pour le pseudo dans la limite 32
  let room = MAX_LEN - (withoutPseudo.length + overheadSep);
  room = clamp(room, 3, MAX_LEN);

  const trimmedPseudo = cleanPseudo(username, room);
  out = renderFromFormat(format, { ...tokensBase, PSEUDO: trimmedPseudo });

  // 3) Si encore trop long (cas rare : mid/postes énormes) -> coupe proprement
  if (out.length > MAX_LEN) {
    out = out.slice(0, MAX_LEN - 1) + '…';
  }

  return out;
}

module.exports = {
  buildNickname,
  cleanPseudo
};
