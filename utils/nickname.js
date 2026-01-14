// utils/nickname.js
// ✅ Principe conservé : PSEUDO = lettres uniquement (A-Z), sans chiffres, sans caractères spéciaux.
// - Tokens : {PSEUDO} {MID} {HIER} {TEAM} {POSTES} {TAG} {CLUB}
// - MID = Hiérarchie si existe sinon Team
// - Trim intelligent 32 chars : on réduit le pseudo en priorité, puis coupe proprement.

const MAX_LEN = 32;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Nettoyage strict :
 * - conserve UNIQUEMENT A-Z (ASCII)
 * - supprime chiffres + caractères spéciaux + espaces
 * - fallback "Joueur" si vide
 */
function cleanPseudo(username, room = MAX_LEN) {
  const raw = String(username || '').trim();
  if (!raw) return 'Joueur';

  // Supprime tout sauf lettres A-Z
  let clean = raw.replace(/[^A-Za-z]/g, '');
  if (!clean.length) return 'Joueur';

  // 1ère lettre majuscule, reste minuscule
  clean = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();

  // Room minimale utile
  const r = clamp(Number(room) || MAX_LEN, 2, MAX_LEN);

  // Trim avec ellipsis si dépasse
  if (clean.length > r) clean = clean.slice(0, Math.max(1, r - 1)) + '…';

  return clean;
}

function getHierarchy(member, hierarchyRoles = []) {
  const found = hierarchyRoles.find(r => r?.id && member.roles.cache.has(r.id));
  return found ? String(found.label || '').trim() : '';
}

function getTeam(member, teamRoles = []) {
  const found = teamRoles.find(r => r?.id && member.roles.cache.has(r.id));
  return found ? String(found.label || '').trim() : '';
}

function getPostes(member, posteRoles = []) {
  return posteRoles
    .filter(p => p?.id && member.roles.cache.has(p.id))
    .map(p => String(p.label || '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeSep(str) {
  return String(str || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/^\s*\|\s*/g, '')
    .replace(/\s*\|\s*$/g, '')
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

  // Supprime segments vides
  out = out
    .split(' | ')
    .map(s => s.trim())
    .filter(Boolean)
    .join(' | ');

  return out.trim();
}

/**
 * ✅ Build nickname configurable via nicknameCfg.format
 *
 * Tokens :
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
  if (!out) out = basePseudo;
  if (out.length <= MAX_LEN) return out;

  // 2) Trim pseudo en priorité
  const tokensNoPseudo = { ...tokensBase, PSEUDO: '' };
  const withoutPseudo = renderFromFormat(format, tokensNoPseudo);
  const testOne = renderFromFormat(format, { ...tokensNoPseudo, PSEUDO: 'X' });

  const overheadTotal = Math.max(0, testOne.length - withoutPseudo.length);
  const overheadSep = Math.max(0, overheadTotal - 1);

  let room = MAX_LEN - (withoutPseudo.length + overheadSep);
  room = clamp(room, 3, MAX_LEN);

  const trimmedPseudo = cleanPseudo(username, room);
  out = renderFromFormat(format, { ...tokensBase, PSEUDO: trimmedPseudo });

  // 3) Dernier recours
  if (!out) out = trimmedPseudo || 'Joueur';
  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN - 1) + '…';

  return out;
}

module.exports = {
  buildNickname,
  cleanPseudo
};
