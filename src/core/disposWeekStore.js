// src/core/disposWeekStore.js
const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "..", "config", "disposWeek.json");

function ensureStore() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ version: 1, guilds: {} }, null, 2), "utf8");
  }
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return { version: 1, guilds: {} };
  }
}

function writeStore(db) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(db, null, 2), "utf8");
}

function ensureGuild(db, guildId) {
  if (!db.guilds[guildId]) db.guilds[guildId] = { sessions: {}, lastSessionId: null };
  return db.guilds[guildId];
}

function newSessionId() {
  // court, stable, < 100 chars en customId
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Create session
 * days: [{ key: 'mon', label:'Lundi', imageUrl?: string|null, mode:'embed'|'image'|'both', messageId?:string }]
 */
function createSession(guildId, createdBy, channelId, days, meta = {}) {
  const db = readStore();
  const g = ensureGuild(db, guildId);

  const sessionId = newSessionId();

  g.sessions[sessionId] = {
    sessionId,
    guildId,
    channelId,
    createdBy,
    createdAt: new Date().toISOString(),
    closed: false,
    closedAt: null,
    days: days.map((d) => ({
      key: d.key,
      label: d.label,
      mode: d.mode || "embed",
      imageUrl: d.imageUrl || null,
      messageId: d.messageId || null,
    })),
    votes: {}, // votes[dayKey] = { present:Set as array, absent: array }
    meta: {
      title: meta.title || null,
    },
  };

  // init votes structure
  for (const d of g.sessions[sessionId].days) {
    g.sessions[sessionId].votes[d.key] = { present: [], absent: [] };
  }

  g.lastSessionId = sessionId;
  writeStore(db);
  return g.sessions[sessionId];
}

function getSession(guildId, sessionId) {
  const db = readStore();
  const g = db.guilds[guildId];
  if (!g) return null;
  return g.sessions[sessionId] || null;
}

function updateSessionDayMessage(guildId, sessionId, dayKey, patch) {
  const db = readStore();
  const g = ensureGuild(db, guildId);
  const s = g.sessions[sessionId];
  if (!s) return null;

  const day = s.days.find((x) => x.key === dayKey);
  if (!day) return null;

  Object.assign(day, patch);
  writeStore(db);
  return day;
}

function setVote(guildId, sessionId, dayKey, userId, status /* 'present'|'absent' */) {
  const db = readStore();
  const g = ensureGuild(db, guildId);
  const s = g.sessions[sessionId];
  if (!s) return { ok: false, reason: "SESSION_NOT_FOUND" };
  if (s.closed) return { ok: false, reason: "CLOSED" };

  const bucket = s.votes[dayKey];
  if (!bucket) return { ok: false, reason: "DAY_NOT_FOUND" };

  // remove from both
  bucket.present = bucket.present.filter((id) => id !== userId);
  bucket.absent = bucket.absent.filter((id) => id !== userId);

  // add to selected
  if (status === "present") bucket.present.push(userId);
  if (status === "absent") bucket.absent.push(userId);

  writeStore(db);
  return { ok: true };
}

function closeSession(guildId, sessionId, closedBy) {
  const db = readStore();
  const g = ensureGuild(db, guildId);
  const s = g.sessions[sessionId];
  if (!s) return null;

  s.closed = true;
  s.closedAt = new Date().toISOString();
  s.closedBy = closedBy || null;
  writeStore(db);
  return s;
}

function getLastOpenSession(guildId) {
  const db = readStore();
  const g = db.guilds[guildId];
  if (!g) return null;
  // lastSessionId d'abord
  if (g.lastSessionId) {
    const s = g.sessions[g.lastSessionId];
    if (s && !s.closed) return s;
  }
  // fallback : scan
  const sessions = Object.values(g.sessions || {});
  const open = sessions.filter((s) => !s.closed);
  open.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return open[0] || null;
}

module.exports = {
  STORE_PATH,
  createSession,
  getSession,
  updateSessionDayMessage,
  setVote,
  closeSession,
  getLastOpenSession,
};
