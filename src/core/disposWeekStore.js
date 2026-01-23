// src/core/disposWeekStore.js
// Stockage JSON simple (persistant si volume Railway, sinon reset au redeploy)
// CommonJS

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "..", "config", "disposWeek.json");

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(
      STORE_PATH,
      JSON.stringify({ version: 1, guilds: {} }, null, 2),
      "utf8"
    );
  }
}

function safeRead() {
  ensureStoreFile();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return { version: 1, guilds: {} };
  }
}

function safeWrite(db) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(db, null, 2), "utf8");
}

function ensureGuild(db, guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = {
      sessions: {},      // sessionId -> session
      lastSessionId: null,
    };
  }
  return db.guilds[guildId];
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Session schema:
 * {
 *  sessionId,
 *  guildId,
 *  channelId,
 *  createdBy,
 *  createdAt,
 *  closed,
 *  closedAt,
 *  days: [{ key, label, mode, imageUrl, messageId }],
 *  votes: { [dayKey]: { present: [userId], absent: [userId] } }
 * }
 */
function createSession(guildId, createdBy, channelId, days, meta = {}) {
  const db = safeRead();
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
      title: meta.title || null,
      note: meta.note || null,
    },

    days: (days || []).map((d) => ({
      key: d.key,                   // ex: lun/mar/...
      label: d.label,               // ex: Lundi
      mode: d.mode || "embed",      // embed|image|both
      imageUrl: d.imageUrl || null, // URL de l'attachment Discord
      messageId: d.messageId || null,
    })),

    votes: {}, // init plus bas
  };

  // Init votes pour chaque jour
  for (const d of session.days) {
    session.votes[d.key] = { present: [], absent: [] };
  }

  g.sessions[sessionId] = session;
  g.lastSessionId = sessionId;

  safeWrite(db);
  return session;
}

function getSession(guildId, sessionId) {
  const db = safeRead();
  return db.guilds?.[guildId]?.sessions?.[sessionId] || null;
}

function updateSession(guildId, sessionId, patch) {
  const db = safeRead();
  const g = ensureGuild(db, guildId);
  const s = g.sessions[sessionId];
  if (!s) return null;

  g.sessions[sessionId] = {
    ...s,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  safeWrite(db);
  return g.sessions[sessionId];
}

function updateSessionDay(guildId, sessionId, dayKey, patch) {
  const db = safeRead();
  const g = ensureGuild(db, guildId);
  const s = g.sessions[sessionId];
  if (!s) return null;

  const idx = s.days.findIndex((d) => d.key === dayKey);
  if (idx === -1) return null;

  s.days[idx] = { ...s.days[idx], ...patch };
  s.updatedAt = new Date().toISOString();

  safeWrite(db);
  return s.days[idx];
}

function ensureVotesShape(session, dayKey) {
  if (!session.votes) session.votes = {};
  if (!session.votes[dayKey]) session.votes[dayKey] = { present: [], absent: [] };
  if (!Array.isArray(session.votes[dayKey].present)) session.votes[dayKey].present = [];
  if (!Array.isArray(session.votes[dayKey].absent)) session.votes[dayKey].absent = [];
  return session.votes[dayKey];
}

/**
 * Vote: tout le monde, 1 choix max par jour
 * status: "present" | "absent"
 */
function setVote(guildId, sessionId, dayKey, userId, status) {
  const db = safeRead();
  const g = ensureGuild(db, guildId);
  const s = g.sessions[sessionId];

  if (!s) return { ok: false, reason: "SESSION_NOT_FOUND" };
  if (s.closed) return { ok: false, reason: "CLOSED" };

  const day = s.days.find((d) => d.key === dayKey);
  if (!day) return { ok: false, reason: "DAY_NOT_FOUND" };

  const bucket = ensureVotesShape(s, dayKey);

  // Retirer l'utilisateur des deux listes
  bucket.present = bucket.present.filter((id) => id !== userId);
  bucket.absent = bucket.absent.filter((id) => id !== userId);

  // Ajouter au bon statut
  if (status === "present") bucket.present.push(userId);
  else if (status === "absent") bucket.absent.push(userId);
  else return { ok: false, reason: "BAD_STATUS" };

  s.votes[dayKey] = bucket;
  s.updatedAt = new Date().toISOString();

  safeWrite(db);
  return { ok: true };
}

function clearVote(guildId, sessionId, dayKey, userId) {
  const db = safeRead();
  const g = ensureGuild(db, guildId);
  const s = g.sessions[sessionId];

  if (!s) return { ok: false, reason: "SESSION_NOT_FOUND" };
  if (s.closed) return { ok: false, reason: "CLOSED" };

  const bucket = ensureVotesShape(s, dayKey);
  bucket.present = bucket.present.filter((id) => id !== userId);
  bucket.absent = bucket.absent.filter((id) => id !== userId);

  s.votes[dayKey] = bucket;
  s.updatedAt = new Date().toISOString();

  safeWrite(db);
  return { ok: true };
}

function closeSession(guildId, sessionId, closedBy) {
  const db = safeRead();
  const g = ensureGuild(db, guildId);
  const s = g.sessions[sessionId];
  if (!s) return null;

  s.closed = true;
  s.closedAt = new Date().toISOString();
  s.closedBy = closedBy || null;
  s.updatedAt = new Date().toISOString();

  safeWrite(db);
  return s;
}

function isClosed(guildId, sessionId) {
  const s = getSession(guildId, sessionId);
  return !!s?.closed;
}

function getCounts(session, dayKey) {
  const bucket = session?.votes?.[dayKey] || { present: [], absent: [] };
  return {
    present: Array.isArray(bucket.present) ? bucket.present.length : 0,
    absent: Array.isArray(bucket.absent) ? bucket.absent.length : 0,
  };
}

/**
 * Dernière session ouverte (utile automations)
 */
function getLastOpenSession(guildId) {
  const db = safeRead();
  const g = db.guilds?.[guildId];
  if (!g) return null;

  if (g.lastSessionId) {
    const s = g.sessions?.[g.lastSessionId];
    if (s && !s.closed) return s;
  }

  const all = Object.values(g.sessions || {});
  const open = all.filter((s) => s && !s.closed);
  open.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return open[0] || null;
}

module.exports = {
  STORE_PATH,

  createSession,
  getSession,
  updateSession,
  updateSessionDay,

  setVote,
  clearVote,

  closeSession,
  isClosed,

  getCounts,
  getLastOpenSession,
};
