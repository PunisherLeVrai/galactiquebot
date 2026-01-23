// src/core/disposStore.js
const fs = require("fs");
const path = require("path");

function filePath(guildId) {
  return path.join(process.cwd(), "data", "dispos", `${guildId}.json`);
}

function ensureDir(guildId) {
  const fp = filePath(guildId);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
}

function readGuild(guildId) {
  ensureDir(guildId);
  const fp = filePath(guildId);
  if (!fs.existsSync(fp)) {
    return { version: 1, guildId, lastSessionMessageId: null, sessions: {} };
  }
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("bad json");
    if (!parsed.sessions || typeof parsed.sessions !== "object") parsed.sessions = {};
    if (!parsed.version) parsed.version = 1;
    parsed.guildId = guildId;
    return parsed;
  } catch {
    return { version: 1, guildId, lastSessionMessageId: null, sessions: {} };
  }
}

function writeGuild(guildId, data) {
  ensureDir(guildId);
  const fp = filePath(guildId);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf8");
}

function createSession(guildId, session) {
  const data = readGuild(guildId);
  data.sessions[session.messageId] = session;
  data.lastSessionMessageId = session.messageId;
  writeGuild(guildId, data);
  return session;
}

function getSession(guildId, messageId) {
  const data = readGuild(guildId);
  return data.sessions[messageId] || null;
}

function upsertSession(guildId, messageId, patch) {
  const data = readGuild(guildId);
  if (!data.sessions[messageId]) data.sessions[messageId] = { messageId, createdAt: new Date().toISOString() };
  data.sessions[messageId] = { ...data.sessions[messageId], ...patch };
  data.lastSessionMessageId = messageId;
  writeGuild(guildId, data);
  return data.sessions[messageId];
}

function getLastSessionId(guildId) {
  const data = readGuild(guildId);
  return data.lastSessionMessageId || null;
}

function exportGuild(guildId) {
  return readGuild(guildId);
}

module.exports = {
  createSession,
  getSession,
  upsertSession,
  getLastSessionId,
  exportGuild,
};
