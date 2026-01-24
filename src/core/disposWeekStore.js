// src/core/disposWeekStore.js
// Stockage JSON des dispos (multi-serveur) — CommonJS
// ✅ Safe read/write + auto-create
// ✅ Write atomique (anti corruption)
// ✅ reset votes + reopen session (réutilise messages existants)

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "..", "config", "disposWeek.json");
const DEFAULT_DB = { version: 1, guilds: {} };

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_DB, null, 2), "utf8");
  }
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeDb(db) {
  const out = db && typeof db === "object" ? db : {};
  if (!out.version) out.version = DEFAULT_DB.version;
  if (!out.guilds || typeof out.guilds !== "object") out.guilds = {};
  return out;
}

function readDb() {
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return normalizeDb(safeParse(raw));
  } catch {
    return { ...DEFAULT_DB };
  }
}

// write atomique (Railway Linux OK)
function writeDb(db) {
  ensureStoreFile();
  const dir = path.dirname(STORE_PATH);
  const tmp = path.join(dir, `disposWeek.tmp.${process.pid}.${Date.now()}.json`);
  const payload = normalizeDb(db);

  try {
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmp, STORE_PATH);
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
    // dernier recours
    fs.writeFileSync(STORE_PATH, JSON.stringify(payload, null, 2), "utf8");
    throw e;
  }
}

function ensureGuild(db, guildId) {
  if (!db.guilds[guildId]) db.guilds[guildId] = { sessions: {}, lastSessionId: null };
  if (!db.guilds[guildId].sessions || typeof db.guilds[guildId].sessions !== "object") {
    db.guilds[guildId].sessions = {};
  }
  return db.guilds[guildId];
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * session schema:
 * {
 *  sessionId, guildId, channelId, createdBy, createdAt,
 *  closed, closedAt, closedBy,
 *  meta: { title, note },
 *  days: [{ key,label,mode,imageUrl,messageId }],
 *  votes: { [dayKey]: { present:[], absent:[] } },
 *  reopenedAt, reopenedBy,
 *  updatedAt
 * }
 */
function createSession(guildId, createdBy, channelId, days, meta = {}) {
  const db = readDb();
  const g = ensureGuild(db, guildId);

  const sessionId = newId();
  const session = {
    sessionId,
    guildId,
    channelId,
    createdBy,
    createdAt: new Date().toISOString(),

    closed: false,
    closedAt: null,
    closedBy: null,

    meta: {
      title: meta.title || "Disponibilités",
      note: meta.note || null,
    },

    days: (days || []).map((d) => ({
      key: String(d.key),
      label: String(d.label || d.key),
      mode: d.mode || "embed", // embed|image|both
      imageUrl: d.imageUrl || null,
      messageId: d.messageId || null,
    })),

    votes: {},
    reopenedAt: null,
    reopenedBy: null,
    updatedAt: new Date().toISOString(),
  };

  for (const d of session.days) {
    session.votes[d.key] = { present: [], absent: [] };
  }

  g.sessions[sessionId] = session;
  g.lastSessionId = sessionId;

  writeDb(db);
  return session;
}

function getSession(guildId, sessionId) {
  const db = readDb();
  return db.guilds?.[guildId]?.sessions?.[sessionId] || null;
}

function updateSessionDay(guildId, sessionId, dayKey, patch) {
  const db = readDb();
  const g = ensureGuild(db, guildId);
  const s = g.sessions?.[sessionId];
  if (!s) return null;

  const idx = (s.days || []).findIndex((d) => d.key === dayKey);
  if (idx === -1) return null;

  s.days[idx] = { ...s.days[idx], ...(patch || {}) };
  s.updatedAt = new Date().toISOString();

  writeDb(db);
  return s.days[idx];
}

function ensureVotesShape(session, dayKey) {
  if (!session.votes) session.votes = {};
  if (!session.votes[dayKey]) session.votes[dayKey] = { present: [], absent: [] };

  const bucket = session.votes[dayKey];
  if (!Array.isArray(bucket.present)) bucket.present = [];
  if (!Array.isArray(bucket.absent)) bucket.absent = [];

  return bucket;
}

function setVote(guildId, sessionId, dayKey, userId, status) {
  const db = readDb();
  const g = ensureGuild(db, guildId);
  const s = g.sessions?.[sessionId];
  if (!s) return { ok: false, reason: "SESSION_NOT_FOUND" };
  if (s.closed) return { ok: false, reason: "CLOSED" };

  const dayExists = (s.days || []).some((d) => d.key === dayKey);
  if (!dayExists) return { ok: false, reason: "DAY_NOT_FOUND" };

  const bucket = ensureVotesShape(s, dayKey);

  bucket.present = bucket.present.filter((id) => id !== userId);
  bucket.absent = bucket.absent.filter((id) => id !== userId);

  if (status === "present") bucket.present.push(userId);
  else if (status === "absent") bucket.absent.push(userId);
  else return { ok: false, reason: "BAD_STATUS" };

  s.votes[dayKey] = bucket;
  s.updatedAt = new Date().toISOString();
  writeDb(db);

  return { ok: true };
}

function closeSession(guildId, sessionId, closedBy) {
  const db = readDb();
  const g = ensureGuild(db, guildId);
  const s = g.sessions?.[sessionId];
  if (!s) return null;

  s.closed = true;
  s.closedAt = new Date().toISOString();
  s.closedBy = closedBy || null;
  s.updatedAt = new Date().toISOString();

  writeDb(db);
  return s;
}

/**
 * ✅ Réouvrir la semaine suivante sans recréer de messages
 * - closed=false
 * - reset votes
 * - garde les messageId existants
 */
function reopenSession(guildId, sessionId, reopenedBy) {
  const db = readDb();
  const g = ensureGuild(db, guildId);
  const s = g.sessions?.[sessionId];
  if (!s) return null;

  s.closed = false;
  s.closedAt = null;
  s.closedBy = null;

  // Reset votes
  s.votes = {};
  for (const d of s.days || []) {
    s.votes[d.key] = { present: [], absent: [] };
  }

  s.reopenedAt = new Date().toISOString();
  s.reopenedBy = reopenedBy || null;
  s.updatedAt = new Date().toISOString();

  writeDb(db);
  return s;
}

function getCounts(session, dayKey) {
  const bucket = session?.votes?.[dayKey] || { present: [], absent: [] };
  return {
    present: Array.isArray(bucket.present) ? bucket.present.length : 0,
    absent: Array.isArray(bucket.absent) ? bucket.absent.length : 0,
  };
}

function getLastOpenSession(guildId) {
  const db = readDb();
  const g = db.guilds?.[guildId];
  if (!g) return null;

  if (g.lastSessionId) {
    const s = g.sessions?.[g.lastSessionId];
    if (s && !s.closed) return s;
  }

  const all = Object.values(g.sessions || {}).filter(Boolean);
  const open = all.filter((s) => !s.closed);
  open.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return open[0] || null;
}

function getLastSession(guildId) {
  const db = readDb();
  const g = db.guilds?.[guildId];
  if (!g) return null;

  if (g.lastSessionId) return g.sessions?.[g.lastSessionId] || null;

  const all = Object.values(g.sessions || {}).filter(Boolean);
  all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return all[0] || null;
}

module.exports = {
  STORE_PATH,
  createSession,
  getSession,
  updateSessionDay,
  setVote,
  closeSession,
  reopenSession,
  getCounts,
  getLastOpenSession,
  getLastSession,
};
