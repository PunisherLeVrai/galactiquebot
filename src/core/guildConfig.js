// src/core/guildConfig.js
// ✅ Stockage FORCÉ dans: <project>/src/config/servers.json
// ✅ Override possible avec DATA_DIR (Railway volume) si tu veux plus tard

const fs = require("fs");
const path = require("path");

// src/core -> src
const SRC_DIR = path.join(__dirname, ".."); // => <project>/src
const DEFAULT_DATA_DIR = path.join(SRC_DIR, "config");

// Si tu veux plus tard rendre persistant via Railway: DATA_DIR=/data
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;

const CONFIG_PATH = path.join(DATA_DIR, "servers.json");

const DEFAULT_DATA = { version: 1, guilds: {} };

const DEFAULT_GUILD = {
  botLabel: "XIG BLAUGRANA FC Staff",

  disposChannelId: null,
  staffReportsChannelId: null,
  pseudoScanChannelId: null,

  staffRoleIds: [],
  playerRoleIds: [],
  postRoleIds: [],

  // legacy compat
  posts: [],

  automations: { enabled: false },

  setupBy: null,
  setupAt: null,
  updatedAt: null,
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
  }
}

function safeReadJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : fallback;
  } catch {
    return fallback;
  }
}

function readAll() {
  ensureFile();
  const data = safeReadJson(CONFIG_PATH, { ...DEFAULT_DATA });
  if (!data || typeof data !== "object") return { ...DEFAULT_DATA };
  if (!data.guilds || typeof data.guilds !== "object") data.guilds = {};
  if (!data.version) data.version = 1;
  return data;
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
}

function uniqIds(arr, { max = null } = {}) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    const id = String(v || "").trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (typeof max === "number" && out.length >= max) break;
  }
  return out;
}

function extractPostRoleIdsFromLegacyPosts(posts) {
  if (!Array.isArray(posts)) return [];
  return uniqIds(
    posts
      .filter((p) => p && typeof p === "object" && p.roleId)
      .map((p) => p.roleId),
    { max: 25 }
  );
}

function buildLegacyPostsFromIds(postRoleIds) {
  const ids = uniqIds(postRoleIds, { max: 25 });
  return ids.map((roleId) => ({ roleId: String(roleId), label: "POSTE" }));
}

function normalizeGuild(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};

  const out = {
    ...DEFAULT_GUILD,
    ...c,
    automations: { ...DEFAULT_GUILD.automations, ...(c.automations || {}) },
  };

  out.staffRoleIds = uniqIds(out.staffRoleIds);
  out.playerRoleIds = uniqIds(out.playerRoleIds);

  if (!out.staffRoleIds.length && c.staffRoleId) out.staffRoleIds = uniqIds([c.staffRoleId]);
  if (!out.playerRoleIds.length && c.playerRoleId) out.playerRoleIds = uniqIds([c.playerRoleId]);

  const fromPostRoleIds = Array.isArray(c.postRoleIds) ? c.postRoleIds : null;
  const fromLegacyPosts = extractPostRoleIdsFromLegacyPosts(c.posts);

  out.postRoleIds = uniqIds(fromPostRoleIds ?? fromLegacyPosts, { max: 25 });
  out.posts = buildLegacyPostsFromIds(out.postRoleIds);

  return out;
}

function getGuildConfig(guildId) {
  if (!guildId) return null;
  const data = readAll();
  const cfg = data.guilds[String(guildId)];
  return cfg ? normalizeGuild(cfg) : null;
}

function upsertGuildConfig(guildId, patch) {
  if (!guildId) return null;

  const data = readAll();
  const gid = String(guildId);

  const current = normalizeGuild(data.guilds[gid] || {});
  const p = patch && typeof patch === "object" ? patch : {};

  const staffRoleIds = Array.isArray(p.staffRoleIds) ? p.staffRoleIds : current.staffRoleIds;
  const playerRoleIds = Array.isArray(p.playerRoleIds) ? p.playerRoleIds : current.playerRoleIds;

  let postRoleIds = current.postRoleIds;
  if (Array.isArray(p.postRoleIds)) postRoleIds = p.postRoleIds;
  else if (Array.isArray(p.posts)) postRoleIds = extractPostRoleIdsFromLegacyPosts(p.posts);

  const merged = normalizeGuild({
    ...current,
    ...p,
    automations: { ...current.automations, ...(p.automations || {}) },
    staffRoleIds,
    playerRoleIds,
    postRoleIds,
  });

  merged.updatedAt = new Date().toISOString();
  data.guilds[gid] = merged;
  writeAll(data);
  return merged;
}

function exportAllConfig() {
  const data = readAll();
  const out = { ...data, guilds: {} };
  for (const [gid, cfg] of Object.entries(data.guilds || {})) out.guilds[gid] = normalizeGuild(cfg);
  return out;
}

function importAllConfig(payload, { replace = false } = {}) {
  const data = readAll();

  const incoming = payload && typeof payload === "object" ? payload : {};
  const incomingGuilds = incoming.guilds && typeof incoming.guilds === "object" ? incoming.guilds : {};

  if (replace) data.guilds = {};
  for (const [gid, cfg] of Object.entries(incomingGuilds)) data.guilds[String(gid)] = normalizeGuild(cfg);

  if (!data.version) data.version = 1;
  writeAll(data);
  return exportAllConfig();
}

function resetGuildConfig(guildId) {
  if (!guildId) return null;
  const data = readAll();
  delete data.guilds[String(guildId)];
  writeAll(data);
  return true;
}

module.exports = {
  DATA_DIR,
  CONFIG_PATH,

  DEFAULT_DATA,
  DEFAULT_GUILD,

  getGuildConfig,
  upsertGuildConfig,
  exportAllConfig,

  importAllConfig,
  resetGuildConfig,
};
