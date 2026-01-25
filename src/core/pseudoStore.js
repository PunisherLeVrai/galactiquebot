// src/core/pseudoStore.js
// Stockage pseudos multi-serveur — CommonJS
// ✅ psn/xbox/ea
// ✅ nettoyage (retire ` et |), trim, max length
// ✅ strip du préfixe (psn:/xbox:/ea:) au stockage (le rendu n'affiche pas le préfixe si tu le veux)
// ✅ utilitaires export/import/reset — import batché (1 seul write)
// ✅ DATA_DIR (Railway /data) sinon ./config (racine projet)

const fs = require("fs");
const path = require("path");

// Racine projet: src/core -> src -> (racine)
const PROJECT_ROOT = path.join(__dirname, "..", "..", "..");

// Dossier de data persistant (Railway: DATA_DIR=/data + volume monté)
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(PROJECT_ROOT, "config");

const STORE_PATH = path.join(DATA_DIR, "pseudos.json");

const DEFAULT_DATA = { version: 1, guilds: {} };

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
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

  const data = safeReadJson(STORE_PATH, { ...DEFAULT_DATA });

  if (!data || typeof data !== "object") return { ...DEFAULT_DATA };
  if (!data.guilds || typeof data.guilds !== "object") data.guilds = {};
  if (!data.version) data.version = 1;

  return data;
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

function normalizeValue(v, max = 40) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/[`|]/g, "") // "|" casse le format "PSEUDO | ROLE | POSTES"
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Retire les mentions "psn/xbox/ea" au stockage :
 * Accepte: "psn:xxx", "psn:/xxx", "psn xxx", "/xxx", "xxx" -> stocke "xxx"
 * (le rendu décidera d'afficher ou non un préfixe)
 */
function stripPlatformPrefix(platform, value) {
  const v = normalizeValue(value, 60);
  if (!v) return "";

  const p = String(platform || "").toLowerCase();
  if (!["psn", "xbox", "ea"].includes(p)) return normalizeValue(v, 40);

  // enlève "psn:" / "psn:/" / "psn " / "psn/" (case-insensitive), tolère espaces
  const re = new RegExp(`^\\s*${p}\\s*[:\\s/]+\\s*`, "i");
  let cleaned = v.replace(re, "").trim();

  // enlève un slash résiduel "/xxx"
  cleaned = cleaned.replace(/^\/+/, "").trim();

  return normalizeValue(cleaned, 40);
}

function ensureGuild(data, guildId) {
  const gid = String(guildId);
  if (!data.guilds[gid] || typeof data.guilds[gid] !== "object") data.guilds[gid] = { users: {} };
  if (!data.guilds[gid].users || typeof data.guilds[gid].users !== "object") data.guilds[gid].users = {};
  return data.guilds[gid];
}

function ensureUser(guildObj, userId) {
  const uid = String(userId);
  if (!guildObj.users[uid] || typeof guildObj.users[uid] !== "object") {
    guildObj.users[uid] = { psn: "", xbox: "", ea: "", updatedAt: null };
  }
  return guildObj.users[uid];
}

function getUserPseudos(guildId, userId) {
  if (!guildId || !userId) return null;
  const data = readAll();
  return data.guilds?.[String(guildId)]?.users?.[String(userId)] || null;
}

/**
 * setUserPseudos(guildId, userId, patch, opts?)
 * - patch: { psn?, xbox?, ea? }
 * - opts.write (default true): permet d'updater en batch sans écrire à chaque appel
 */
function setUserPseudos(guildId, userId, patch, opts = {}) {
  if (!guildId || !userId) return null;

  const options = { write: opts.write !== false };

  const data = readAll();
  const g = ensureGuild(data, guildId);
  const cur = ensureUser(g, userId);

  const p = patch && typeof patch === "object" ? patch : {};

  const next = {
    psn: p.psn !== undefined ? stripPlatformPrefix("psn", p.psn) : cur.psn,
    xbox: p.xbox !== undefined ? stripPlatformPrefix("xbox", p.xbox) : cur.xbox,
    ea: p.ea !== undefined ? stripPlatformPrefix("ea", p.ea) : cur.ea,
    updatedAt: new Date().toISOString(),
  };

  g.users[String(userId)] = next;

  if (options.write) writeAll(data);
  return next;
}

// --- utilitaires ---

function exportAllPseudos() {
  const data = readAll();

  const out = { version: data.version || 1, guilds: {} };

  for (const [gid, g] of Object.entries(data.guilds || {})) {
    const users = g?.users && typeof g.users === "object" ? g.users : {};
    out.guilds[gid] = { users: {} };

    for (const [uid, u] of Object.entries(users)) {
      out.guilds[gid].users[uid] = {
        psn: normalizeValue(u?.psn),
        xbox: normalizeValue(u?.xbox),
        ea: normalizeValue(u?.ea),
        updatedAt: u?.updatedAt || null,
      };
    }
  }

  return out;
}

/**
 * Import payload (exportAllPseudos ou structure compatible)
 * - replace=false: merge
 * - replace=true: remplace data.guilds complètement
 * Batché => 1 seul writeAll()
 */
function importAllPseudos(payload, { replace = false } = {}) {
  const data = readAll();

  const incoming = payload && typeof payload === "object" ? payload : {};
  const incomingGuilds = incoming.guilds && typeof incoming.guilds === "object" ? incoming.guilds : {};

  if (replace) data.guilds = {};

  for (const [gid, g] of Object.entries(incomingGuilds)) {
    const guildObj = ensureGuild(data, gid);
    const users = g?.users && typeof g.users === "object" ? g.users : {};

    for (const [uid, u] of Object.entries(users)) {
      const cur = ensureUser(guildObj, uid);

      const next = {
        psn: u?.psn !== undefined ? stripPlatformPrefix("psn", u.psn) : cur.psn,
        xbox: u?.xbox !== undefined ? stripPlatformPrefix("xbox", u.xbox) : cur.xbox,
        ea: u?.ea !== undefined ? stripPlatformPrefix("ea", u.ea) : cur.ea,
        updatedAt: u?.updatedAt || new Date().toISOString(),
      };

      guildObj.users[String(uid)] = next;
    }
  }

  if (!data.version) data.version = 1;
  writeAll(data);
  return exportAllPseudos();
}

function resetGuildPseudos(guildId) {
  if (!guildId) return false;
  const data = readAll();
  delete data.guilds[String(guildId)];
  writeAll(data);
  return true;
}

module.exports = {
  DATA_DIR,
  STORE_PATH,

  getUserPseudos,
  setUserPseudos,

  exportAllPseudos,
  importAllPseudos,
  resetGuildPseudos,
};
