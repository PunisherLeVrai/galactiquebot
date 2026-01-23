// src/core/disposWeekStore.js
// Stockage JSON simple (local) des semaines + votes.
// Compatible Railway (si volume/persist) sinon ça reset au redéploiement.

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "..", "config", "disposWeekStore.json");

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

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getGuildData(guildId) {
  const db = readStore();
  if (!db.guilds[guildId]) db.guilds[guildId] = { weeks: {} };
  return { db, guild: db.guilds[guildId] };
}

/**
 * Crée une nouvelle semaine (weekId) et enregistre les messageIds par jour.
 */
function createWeek(guildId, weekId, payload) {
  const { db, guild } = getGuildData(guildId);
  guild.weeks[weekId] = {
    createdAt: new Date().toISOString(),
    ...payload,
  };
  writeStore(db);
  return guild.weeks[weekId];
}

function getWeek(guildId, weekId) {
  const db = readStore();
  return db.guilds?.[guildId]?.weeks?.[weekId] || null;
}

function updateWeek(guildId, weekId, patch) {
  const { db, guild } = getGuildData(guildId);
  if (!guild.weeks[weekId]) return null;

  guild.weeks[weekId] = {
    ...guild.weeks[weekId],
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  writeStore(db);
  return guild.weeks[weekId];
}

/**
 * Enregistre un vote.
 * dayIndex: 0..6
 * status: "present" | "absent"
 */
function setVote(guildId, weekId, dayIndex, userId, status) {
  const { db, guild } = getGuildData(guildId);
  const week = guild.weeks[weekId];
  if (!week) return null;

  if (!week.votes) week.votes = {};
  if (!week.votes[dayIndex]) week.votes[dayIndex] = { present: [], absent: [] };

  // retirer de l'autre liste si existant
  const day = week.votes[dayIndex];
  day.present = (day.present || []).filter((id) => id !== userId);
  day.absent = (day.absent || []).filter((id) => id !== userId);

  // ajouter dans la bonne liste
  if (status === "present") day.present.push(userId);
  else day.absent.push(userId);

  week.votes[dayIndex] = day;
  week.updatedAt = new Date().toISOString();

  writeStore(db);
  return week;
}

function getCounts(week, dayIndex) {
  const day = week?.votes?.[dayIndex];
  const present = day?.present?.length || 0;
  const absent = day?.absent?.length || 0;
  return { present, absent };
}

module.exports = {
  STORE_PATH,
  createWeek,
  getWeek,
  updateWeek,
  setVote,
  getCounts,
};
