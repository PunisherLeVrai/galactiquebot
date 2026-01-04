// utils/nickname.js
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
  return found ? found.label : '';
}

function getTeam(member, teamRoles = []) {
  const found = teamRoles.find(r => member.roles.cache.has(r.id));
  return found ? found.label : '';
}

function getPostes(member, posteRoles = []) {
  return posteRoles
    .filter(p => member.roles.cache.has(p.id))
    .map(p => p.label)
    .slice(0, 3);
}

function normalizeSep(str) {
  // Nettoie les doublons de séparateurs et espaces
  return String(str || '')
    .replace(/\s+\|\s+\|\s+/g, ' | ')
    .replace(/\|\s+\|/g, '|')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*\|\s*$/g, '')
    .replace(/^\s*\|\s*/g, '')
    .trim();
}

function renderFromFormat(format, tokens) {
  let out = String(format || '').trim();

  // Remplacement tokens
  out = out.replace(/\{([A-Z_]+)\}/g, (_, key) => {
    const v = tokens[key];
    return v ? String(v) : '';
  });

  // Nettoyage (si token vide => " |  | " etc.)
  out = normalizeSep(out.replace(/\s*\|\s*\|\s*/g, ' | '));
  out = out.replace(/\s*\|\s*/g, ' | '); // uniformiser

  // Supprime les " |  | " résiduels
  out = out
    .split(' | ')
    .map(s => s.trim())
    .filter(Boolean)
    .join(' | ');

  return out;
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

  const tag = guildCfg?.tag || '';
  const club = guildCfg?.clubName || '';

  const format = nicknameCfg.format || '{PSEUDO} | {MID} | {POSTES}';

  // 1) on render avec pseudo "normal"
  const basePseudo = cleanPseudo(member.user.username, MAX_LEN);
  const tokensBase = {
    PSEUDO: basePseudo,
    MID: mid,
    HIER: hier,
    TEAM: team,
    POSTES: postes,
    TAG: tag,
    CLUB: club
  };

  let out = renderFromFormat(format, tokensBase);

  // 2) Si trop long -> on réduit le pseudo en priorité
  if (out.length > MAX_LEN) {
    // Render sans pseudo pour calculer la place dispo
    const tokensNoPseudo = { ...tokensBase, PSEUDO: '' };
    const withoutPseudo = renderFromFormat(format, tokensNoPseudo);

    // Si le format met PSEUDO au milieu, withoutPseudo peut contenir " |  | "
    // On calcule room pseudo en visant MAX_LEN (en ajoutant pseudo + séparateurs éventuels)
    let room = MAX_LEN;

    // On va approximer : on re-render avec "X" puis on mesure la différence
    const testOne = renderFromFormat(format, { ...tokensNoPseudo, PSEUDO: 'X' });
    const overhead = testOne.length - withoutPseudo.length; // inclut séparateurs autour de PSEUDO si présents
    room = MAX_LEN - (withoutPseudo.length + Math.max(0, overhead - 1)); // -1 car 'X' = 1 char

    room = Math.max(3, room);
    const trimmedPseudo = cleanPseudo(member.user.username, room);

    out = renderFromFormat(format, { ...tokensBase, PSEUDO: trimmedPseudo });
  }

  // 3) Si encore trop long -> coupe proprement
  if (out.length > MAX_LEN) {
    out = out.slice(0, MAX_LEN - 1) + '…';
  }

  return out;
}

module.exports = {
  buildNickname,
  cleanPseudo
};
