// src/core/guildConfig.js
// Configuration multi-serveur PROSYNC — CommonJS

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(SRC_DIR, 'config');
const CONFIG_PATH = path.join(DATA_DIR, 'servers.json');

const DEFAULT_DATA = { version: 3, guilds: {} };
const DEFAULT_GUILD = {
  botLabel: 'PROSYNC',
  disposChannelId: null,
  staffReportsChannelId: null,
  pseudoScanChannelId: null,
  checkDispoChannelId: null,
  dispoMessageIds: [null, null, null, null, null, null, null],
  staffRoleIds: [],
  playerRoleIds: [],
  postRoleIds: [],
  posts: [],
  automations: {
    enabled: false,
    pseudo: { enabled: true, minute: 10 },
    checkDispo: { enabled: false, times: [] },
    rappel: { enabled: false, times: [] },
    avertissement: {
      enabled: false,
      roleIds: [null, null, null],
      roleId: null,
      lastProcessedDate: null,
    },
  },
  setupBy: null,
  setupAt: null,
  updatedAt: null,
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_DATA, null, 2), 'utf8');
  }
}

function safeReadJson(filePath, fallback) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

function readAll() {
  ensureFile();
  const data = safeReadJson(CONFIG_PATH, { ...DEFAULT_DATA, guilds: {} });
  if (!data.guilds || typeof data.guilds !== 'object') data.guilds = {};
  if (!data.version) data.version = DEFAULT_DATA.version;
  return data;
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function uniqIds(input, { max = null } = {}) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(input) ? input : []) {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (typeof max === 'number' && out.length >= max) break;
  }
  return out;
}

function isSnowflake(value) {
  return /^[0-9]{15,25}$/.test(String(value || '').trim());
}

function normalizeOptionalId(value) {
  return isSnowflake(value) ? String(value).trim() : null;
}

function normalizeFixedRoleIds(input, length = 3) {
  const src = Array.isArray(input) ? input : [];
  const out = new Array(length).fill(null);
  const seen = new Set();
  for (let i = 0; i < length; i++) {
    const id = normalizeOptionalId(src[i]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out[i] = id;
  }
  return out;
}

function normalizeDispoMessageIds(input) {
  const src = Array.isArray(input) ? input : [];
  return Array.from({ length: 7 }, (_, i) => normalizeOptionalId(src[i]));
}

function toBool(value, fallback = false) {
  return value === true ? true : value === false ? false : fallback;
}

function clampInt(value, { min = 0, max = 59, fallback = 0 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function normalizeTimeStr(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizeTimes(input, { max = 12 } = {}) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(input) ? input : []) {
    const time = normalizeTimeStr(value);
    if (!time || seen.has(time)) continue;
    seen.add(time);
    out.push(time);
    if (out.length >= max) break;
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function normalizeDateKey(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeAutomations(input) {
  const src = input && typeof input === 'object' ? input : {};
  const pseudo = src.pseudo && typeof src.pseudo === 'object' ? src.pseudo : {};
  const check = src.checkDispo && typeof src.checkDispo === 'object' ? src.checkDispo : {};
  const rappel = src.rappel && typeof src.rappel === 'object' ? src.rappel : {};
  const legacyRappel = src.reminderDispo && typeof src.reminderDispo === 'object' ? src.reminderDispo : {};
  const warning = src.avertissement && typeof src.avertissement === 'object' ? src.avertissement : {};

  const rappelEnabled = Object.prototype.hasOwnProperty.call(rappel, 'enabled')
    ? toBool(rappel.enabled, false)
    : toBool(legacyRappel.enabled, false);
  const rappelTimes = Array.isArray(rappel.times)
    ? normalizeTimes(rappel.times)
    : normalizeTimes(legacyRappel.times);

  const legacyRoleId = normalizeOptionalId(warning.roleId);
  const roleIds = normalizeFixedRoleIds(
    Array.isArray(warning.roleIds) ? warning.roleIds : [legacyRoleId, null, null],
    3
  );

  return {
    enabled: toBool(src.enabled, false),
    pseudo: {
      enabled: toBool(pseudo.enabled, true),
      minute: clampInt(pseudo.minute, { fallback: 10 }),
    },
    checkDispo: {
      enabled: toBool(check.enabled, false),
      times: normalizeTimes(check.times),
    },
    rappel: {
      enabled: rappelEnabled,
      times: rappelTimes,
    },
    avertissement: {
      enabled: toBool(warning.enabled, false),
      roleIds,
      roleId: roleIds[0] || null,
      lastProcessedDate: normalizeDateKey(warning.lastProcessedDate),
    },
  };
}

function extractPostRoleIdsFromLegacyPosts(posts) {
  return uniqIds(
    (Array.isArray(posts) ? posts : [])
      .filter((post) => post && typeof post === 'object' && post.roleId)
      .map((post) => post.roleId),
    { max: 25 }
  );
}

function buildLegacyPostsFromIds(ids) {
  return uniqIds(ids, { max: 25 }).map((roleId) => ({ roleId, label: 'POSTE' }));
}

function normalizeGuild(config) {
  const src = config && typeof config === 'object' ? config : {};
  const out = { ...DEFAULT_GUILD, ...src };
  out.botLabel = 'PROSYNC';
  out.automations = normalizeAutomations(src.automations);
  out.staffRoleIds = uniqIds(out.staffRoleIds);
  out.playerRoleIds = uniqIds(out.playerRoleIds);
  if (!out.staffRoleIds.length && src.staffRoleId) out.staffRoleIds = uniqIds([src.staffRoleId]);
  if (!out.playerRoleIds.length && src.playerRoleId) out.playerRoleIds = uniqIds([src.playerRoleId]);
  out.postRoleIds = uniqIds(
    Array.isArray(src.postRoleIds) ? src.postRoleIds : extractPostRoleIdsFromLegacyPosts(src.posts),
    { max: 25 }
  );
  out.posts = buildLegacyPostsFromIds(out.postRoleIds);
  out.dispoMessageIds = normalizeDispoMessageIds(src.dispoMessageIds);
  for (const key of ['disposChannelId', 'staffReportsChannelId', 'pseudoScanChannelId', 'checkDispoChannelId']) {
    out[key] = src[key] ? String(src[key]) : null;
  }
  return out;
}

function getGuildConfig(guildId) {
  if (!guildId) return null;
  const data = readAll();
  const config = data.guilds[String(guildId)];
  return config ? normalizeGuild(config) : null;
}

function upsertGuildConfig(guildId, patch) {
  if (!guildId) return null;
  const data = readAll();
  const id = String(guildId);
  const current = normalizeGuild(data.guilds[id] || {});
  const src = patch && typeof patch === 'object' ? patch : {};

  const mergedAutomations = normalizeAutomations({
    ...current.automations,
    ...(src.automations || {}),
    pseudo: { ...(current.automations.pseudo || {}), ...(src.automations?.pseudo || {}) },
    checkDispo: { ...(current.automations.checkDispo || {}), ...(src.automations?.checkDispo || {}) },
    rappel: { ...(current.automations.rappel || {}), ...(src.automations?.rappel || {}) },
    avertissement: { ...(current.automations.avertissement || {}), ...(src.automations?.avertissement || {}) },
  });

  const merged = normalizeGuild({
    ...current,
    ...src,
    botLabel: 'PROSYNC',
    staffRoleIds: Array.isArray(src.staffRoleIds) ? src.staffRoleIds : current.staffRoleIds,
    playerRoleIds: Array.isArray(src.playerRoleIds) ? src.playerRoleIds : current.playerRoleIds,
    postRoleIds: Array.isArray(src.postRoleIds)
      ? src.postRoleIds
      : Array.isArray(src.posts)
        ? extractPostRoleIdsFromLegacyPosts(src.posts)
        : current.postRoleIds,
    dispoMessageIds: Array.isArray(src.dispoMessageIds) ? src.dispoMessageIds : current.dispoMessageIds,
    automations: mergedAutomations,
  });

  merged.updatedAt = new Date().toISOString();
  data.version = DEFAULT_DATA.version;
  data.guilds[id] = merged;
  writeAll(data);
  return merged;
}

function exportAllConfig() {
  const data = readAll();
  const out = { version: DEFAULT_DATA.version, guilds: {} };
  for (const [guildId, config] of Object.entries(data.guilds || {})) {
    out.guilds[guildId] = normalizeGuild(config);
  }
  return out;
}

function importAllConfig(payload, { replace = false } = {}) {
  const data = readAll();
  const incoming = payload?.guilds && typeof payload.guilds === 'object' ? payload.guilds : {};
  if (replace) data.guilds = {};
  for (const [guildId, config] of Object.entries(incoming)) {
    data.guilds[String(guildId)] = normalizeGuild(config);
  }
  data.version = DEFAULT_DATA.version;
  writeAll(data);
  return exportAllConfig();
}

function resetGuildConfig(guildId) {
  if (!guildId) return false;
  const data = readAll();
  delete data.guilds[String(guildId)];
  writeAll(data);
  return true;
}

module.exports = {
  SRC_DIR,
  DATA_DIR,
  CONFIG_PATH,
  DEFAULT_DATA,
  DEFAULT_GUILD,
  getGuildConfig,
  upsertGuildConfig,
  exportAllConfig,
  importAllConfig,
  resetGuildConfig,
