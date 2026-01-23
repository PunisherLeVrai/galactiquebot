const fs = require("fs");
const path = require("path");

function filePath(guildId) {
  return path.join(process.cwd(), "data", "dispos", `${guildId}.json`);
}

function ensureDir(guildId) {
  fs.mkdirSync(path.dirname(filePath(guildId)), { recursive: true });
}

function readGuild(guildId) {
  ensureDir(guildId);
  const fp = filePath(guildId);

  if (!fs.existsSync(fp)) {
    return { version: 1, guildId, activeRootId: null, sessions: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("bad json");
    if (!parsed.sessions || typeof parsed.sessions !== "object") parsed.sessions = {};
    if (!("activeRootId" in parsed)) parsed.activeRootId = null;
    if (!parsed.version) parsed.version = 1;
    parsed.guildId = guildId;
    return parsed;
  } catch {
    return { version: 1, guildId, activeRootId: null, sessions: {} };
  }
}

function writeGuild(guildId, data) {
  ensureDir(guildId);
  fs.writeFileSync(filePath(guildId), JSON.stringify(data, null, 2), "utf8");
}

function createSession(guildId, session) {
  const data = readGuild(guildId);
  data.sessions[session.rootId] = session;
  data.activeRootId = session.rootId;
  writeGuild(guildId, data);
  return session;
}

function getSession(guildId, rootId) {
  const data = readGuild(guildId);
  return data.sessions[rootId] || null;
}

function updateSession(guildId, rootId, patch) {
  const data = readGuild(guildId);
  if (!data.sessions[rootId]) return null;

  data.sessions[rootId] = {
    ...data.sessions[rootId],
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  data.activeRootId = rootId;
  writeGuild(guildId, data);
  return data.sessions[rootId];
}

module.exports = { createSession, getSession, updateSession };
