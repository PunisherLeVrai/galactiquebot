// src/core/guildConfig.js
// Config multi-serveur (servers.json) — minimal + safe
// Champs utiles pour setup + export_config

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "servers.json");

const DEFAULT_DATA = { version: 1, guilds: {} };

const DEFAULT_GUILD = {
  botLabel: "XIG BLAUGRANA FC Staff",

  // salons
  disposChannelId: null,
  staffReportsChannelId: null,
  pseudoScanChannelId: null, // ✅ pour la suite si tu veux

  // rôles
  staffRoleId: null,
  playerRoleId: null,
  trialRoleId: null,

  // automations (juste ON/OFF ici)
  automations: { enabled: false },

  setupBy: null,
  setupAt: null,
  updatedAt: null,
};

function ensureFile() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
  }
}

function readAll() {
  ensureFile();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return { ...DEFAULT_DATA };
    if (!data.guilds || typeof data.guilds !== "object") data.guilds = {};
    if (!data.version) data.version = 1;
    return data;
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
}

function mergeGuild(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  return {
    ...DEFAULT_GUILD,
    ...c,
    automations: {
      ...DEFAULT_GUILD.automations,
      ...(c.automations || {}),
    },
  };
}

function getGuildConfig(guildId) {
  const data = readAll();
  const cfg = data.guilds[guildId];
  return cfg ? mergeGuild(cfg) : null;
}

function upsertGuildConfig(guildId, patch) {
  const data = readAll();
  const current = mergeGuild(data.guilds[guildId] || {});
  const p = patch && typeof patch === "object" ? patch : {};

  const merged = mergeGuild({
    ...current,
    ...p,
    automations: { ...current.automations, ...(p.automations || {}) },
  });

  merged.updatedAt = new Date().toISOString();
  data.guilds[guildId] = merged;

  writeAll(data);
  return merged;
}

function exportAllConfig() {
  const data = readAll();
  const out = { ...data, guilds: {} };
  for (const [gid, cfg] of Object.entries(data.guilds || {})) {
    out.guilds[gid] = mergeGuild(cfg);
  }
  return out;
}

module.exports = {
  CONFIG_PATH,
  getGuildConfig,
  upsertGuildConfig,
  exportAllConfig,
};
