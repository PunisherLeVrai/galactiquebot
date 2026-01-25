// src/core/pseudoStore.js
// Stockage pseudos multi-serveur — CommonJS
// ✅ psn/xbox/ea
// ✅ nettoyage (retire ` et |), trim, max length
// ✅ utilitaires export/import/reset (utile pour backup/restore)

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "..", "config", "pseudos.json");
const DEFAULT_DATA = { version: 1, guilds: {} };

function ensureFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

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
    .replace(/[`|]/g, "") // important: "|" casse "PSEUDO | ROLE | POSTES"
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Accepte "psn:xxx" / "psn:/xxx" / "xxx" -> stocke seulement "xxx" (sans le préfixe)
// Le préfixe obligatoire est géré au rendu par memberDisplay.ensurePrefix()
function stripPlatformPrefix(platform, value) {
  const v = normalizeValue(value, 60);
  if (!v) return "";

  const p = String(platform || "").toLowerCase();
  if (!["psn", "xbox", "ea"].includes(p)) return normalizeValue(v, 40);

  // enlève "psn:" ou "psn:/" (case-insensitive)
  const re = new RegExp(`^\\s*${p}\\s*:\\s*\\/?\\s*`, "i");
  const cleaned = v.replace(re, "").trim();

  return normalizeValue(cleaned, 40);
}

function ensureGuild(data, guildId) {
  const gid = String(guildId);
  if (!data.guilds[gid]) data.guilds[gid] = { users: {} };
  if (!data.guilds[gid].users || typeof data.guilds[gid].users !== "object") data.guilds[gid].users = {};
  return data.guilds[gid];
}

function ensureUser(guildObj, userId) {
  const uid = String(userId);
  if (!guildObj.users[uid]) guildObj.users[uid] = { psn: "", xbox: "", ea: "", updatedAt: null };
  return guildObj.users[uid];
}

function getUserPseudos(guildId, userId) {
  if (!guildId || !userId) return null;
  const data = readAll();
  return data.guilds?.[String(guildId)]?.users?.[String(userId)] || null;
}

function setUserPseudos(guildId, userId, patch) {
  if (!guildId || !userId) return null;

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
  writeAll(data);
  return next;
}

// --- utilitaires (optionnels mais utiles) ---

function exportAllPseudos() {
  const data = readAll();
  // copie "safe"
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

function importAllPseudos(payload, { replace = false } = {}) {
  const data = readAll();

  const incoming = payload && typeof payload === "object" ? payload : {};
  const incomingGuilds = incoming.guilds && typeof incoming.guilds === "object" ? incoming.guilds : {};

  if (replace) data.guilds = {};

  for (const [gid, g] of Object.entries(incomingGuilds)) {
    const guildObj = ensureGuild(data, gid);
    const users = g?.users && typeof g.users === "object" ? g.users : {};

    for (const [uid, u] of Object.entries(users)) {
      setUserPseudos(gid, uid, {
        psn: u?.psn,
        xbox: u?.xbox,
        ea: u?.ea,
      });
      // setUserPseudos écrit déjà, mais on veut éviter 500 writes ? (option)
      // Ici on reste simple; si tu veux optimiser, on peut batcher.
    }

    // re-fetch après setUserPseudos, mais non nécessaire
    guildObj.users = guildObj.users;
  }

  if (!data.version) data.version = 1;
  // setUserPseudos a déjà écrit; pour rester cohérent on réécrit une fois
  writeAll(readAll());
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
  STORE_PATH,
  getUserPseudos,
  setUserPseudos,

  // utilitaires
  exportAllPseudos,
  importAllPseudos,
  resetGuildPseudos,
};
