// src/core/pseudoStore.js
// Stockage pseudos multi-serveur — CommonJS
//
// Nouveau champ principal : pseudo
// Compatibilité conservée avec : psn / xbox / ea
//
// Priorité d'affichage utilisée ailleurs :
// pseudo > psn > xbox > ea > username Discord
//
// Chemin : <root>/src/config/pseudos.json

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..", "..");
const DATA_DIR = path.join(ROOT_DIR, "src", "config");
const STORE_PATH = path.join(DATA_DIR, "pseudos.json");

const DEFAULT_DATA = {
  version: 2,
  guilds: {},
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(
      STORE_PATH,
      JSON.stringify(DEFAULT_DATA, null, 2),
      "utf8"
    );
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

  const data = safeReadJson(STORE_PATH, {
    version: 2,
    guilds: {},
  });

  if (!data || typeof data !== "object") {
    return {
      version: 2,
      guilds: {},
    };
  }

  if (!data.guilds || typeof data.guilds !== "object") {
    data.guilds = {};
  }

  // Passage transparent du format v1 au format v2.
  data.version = 2;

  return data;
}

function writeAll(data) {
  ensureFile();

  data.version = 2;

  fs.writeFileSync(
    STORE_PATH,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function normalizeValue(value, max = 40) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/[`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function stripPlatformPrefix(platform, value) {
  const normalized = normalizeValue(value, 60);
  if (!normalized) return "";

  const platformName = String(platform || "").toLowerCase();

  if (!["psn", "xbox", "ea"].includes(platformName)) {
    return normalizeValue(normalized, 40);
  }

  const regex = new RegExp(
    `^\\s*${platformName}\\s*:\\s*\\/?\\s*`,
    "i"
  );

  return normalizeValue(
    normalized.replace(regex, "").trim(),
    40
  );
}

function ensureGuild(data, guildId) {
  const gid = String(guildId);

  if (!data.guilds[gid] || typeof data.guilds[gid] !== "object") {
    data.guilds[gid] = { users: {} };
  }

  if (
    !data.guilds[gid].users ||
    typeof data.guilds[gid].users !== "object"
  ) {
    data.guilds[gid].users = {};
  }

  return data.guilds[gid];
}

function ensureUser(guildObject, userId) {
  const uid = String(userId);

  if (
    !guildObject.users[uid] ||
    typeof guildObject.users[uid] !== "object"
  ) {
    guildObject.users[uid] = {
      pseudo: "",
      psn: "",
      xbox: "",
      ea: "",
      updatedAt: null,
    };
  }

  const current = guildObject.users[uid];

  if (typeof current.pseudo !== "string") current.pseudo = "";
  if (typeof current.psn !== "string") current.psn = "";
  if (typeof current.xbox !== "string") current.xbox = "";
  if (typeof current.ea !== "string") current.ea = "";

  return current;
}

function getUserPseudos(guildId, userId) {
  if (!guildId || !userId) return null;

  const data = readAll();

  return (
    data.guilds?.[String(guildId)]?.users?.[String(userId)] ||
    null
  );
}

/**
 * setUserPseudos(guildId, userId, patch)
 *
 * patch peut contenir :
 * { pseudo?, psn?, xbox?, ea? }
 */
function setUserPseudos(guildId, userId, patch, opts = {}) {
  if (!guildId || !userId) return null;

  const options = {
    write: opts.write !== false,
  };

  const data = readAll();
  const guildObject = ensureGuild(data, guildId);
  const current = ensureUser(guildObject, userId);
  const incoming =
    patch && typeof patch === "object" ? patch : {};

  const next = {
    pseudo:
      incoming.pseudo !== undefined
        ? normalizeValue(incoming.pseudo, 40)
        : current.pseudo,

    psn:
      incoming.psn !== undefined
        ? stripPlatformPrefix("psn", incoming.psn)
        : current.psn,

    xbox:
      incoming.xbox !== undefined
        ? stripPlatformPrefix("xbox", incoming.xbox)
        : current.xbox,

    ea:
      incoming.ea !== undefined
        ? stripPlatformPrefix("ea", incoming.ea)
        : current.ea,

    updatedAt: new Date().toISOString(),
  };

  guildObject.users[String(userId)] = next;

  if (options.write) {
    writeAll(data);
  }

  return next;
}

function setUserPseudo(guildId, userId, pseudo, opts = {}) {
  return setUserPseudos(
    guildId,
    userId,
    { pseudo },
    opts
  );
}

function exportAllPseudos() {
  const data = readAll();

  const output = {
    version: 2,
    guilds: {},
  };

  for (const [guildId, guildObject] of Object.entries(
    data.guilds || {}
  )) {
    const users =
      guildObject?.users &&
      typeof guildObject.users === "object"
        ? guildObject.users
        : {};

    output.guilds[guildId] = {
      users: {},
    };

    for (const [userId, user] of Object.entries(users)) {
      output.guilds[guildId].users[userId] = {
        pseudo: normalizeValue(user?.pseudo),
        psn: normalizeValue(user?.psn),
        xbox: normalizeValue(user?.xbox),
        ea: normalizeValue(user?.ea),
        updatedAt: user?.updatedAt || null,
      };
    }
  }

  return output;
}

function importAllPseudos(payload, { replace = false } = {}) {
  const data = readAll();

  const incoming =
    payload && typeof payload === "object"
      ? payload
      : {};

  const incomingGuilds =
    incoming.guilds &&
    typeof incoming.guilds === "object"
      ? incoming.guilds
      : {};

  if (replace) {
    data.guilds = {};
  }

  for (const [guildId, guildData] of Object.entries(
    incomingGuilds
  )) {
    const guildObject = ensureGuild(data, guildId);

    const users =
      guildData?.users &&
      typeof guildData.users === "object"
        ? guildData.users
        : {};

    for (const [userId, user] of Object.entries(users)) {
      const current = ensureUser(guildObject, userId);

      guildObject.users[String(userId)] = {
        pseudo:
          user?.pseudo !== undefined
            ? normalizeValue(user.pseudo, 40)
            : current.pseudo,

        psn:
          user?.psn !== undefined
            ? stripPlatformPrefix("psn", user.psn)
            : current.psn,

        xbox:
          user?.xbox !== undefined
            ? stripPlatformPrefix("xbox", user.xbox)
            : current.xbox,

        ea:
          user?.ea !== undefined
            ? stripPlatformPrefix("ea", user.ea)
            : current.ea,

        updatedAt:
          user?.updatedAt ||
          new Date().toISOString(),
      };
    }
  }

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
  ROOT_DIR,
  DATA_DIR,
  STORE_PATH,

  getUserPseudos,
  setUserPseudos,
  setUserPseudo,

  exportAllPseudos,
  importAllPseudos,
  resetGuildPseudos,
};
