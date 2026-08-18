// src/core/pseudoStore.js
// Stockage pseudos multi-serveur — CommonJS
//
// Priorité :
// pseudo du salon > username Discord
//
// PSN/XBOX/EA conservés uniquement pour compatibilité.

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..", "..");
const DATA_DIR = path.join(ROOT_DIR, "src", "config");
const STORE_PATH = path.join(DATA_DIR, "pseudos.json");

const DEFAULT_DATA = {
  version: 3,
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

    return data && typeof data === "object"
      ? data
      : fallback;
  } catch {
    return fallback;
  }
}

function readAll() {
  ensureFile();

  const data = safeReadJson(STORE_PATH, {
    version: 3,
    guilds: {},
  });

  if (!data || typeof data !== "object") {
    return {
      version: 3,
      guilds: {},
    };
  }

  if (!data.guilds || typeof data.guilds !== "object") {
    data.guilds = {};
  }

  data.version = 3;

  return data;
}

function writeAll(data) {
  ensureFile();

  data.version = 3;

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

  if (
    !data.guilds[gid] ||
    typeof data.guilds[gid] !== "object"
  ) {
    data.guilds[gid] = {
      users: {},
    };
  }

  if (
    !data.guilds[gid].users ||
    typeof data.guilds[gid].users !== "object"
  ) {
    data.guilds[gid].users = {};
  }

  return data.guilds[gid];
}

function normalizeStoredUser(user) {
  const source =
    user && typeof user === "object" ? user : {};

  return {
    pseudo: normalizeValue(source.pseudo, 40),
    psn: stripPlatformPrefix("psn", source.psn),
    xbox: stripPlatformPrefix("xbox", source.xbox),
    ea: stripPlatformPrefix("ea", source.ea),

    sourceMessageId: source.sourceMessageId
      ? String(source.sourceMessageId)
      : null,

    updatedAt: source.updatedAt || null,
  };
}

function ensureUser(guildObject, userId) {
  const uid = String(userId);

  const current = normalizeStoredUser(
    guildObject.users[uid]
  );

  guildObject.users[uid] = current;

  return current;
}

function getUserPseudos(guildId, userId) {
  if (!guildId || !userId) return null;

  const data = readAll();

  const user =
    data.guilds?.[String(guildId)]?.users?.[String(userId)];

  return user ? normalizeStoredUser(user) : null;
}

function setUserPseudos(guildId, userId, patch, opts = {}) {
  if (!guildId || !userId) return null;

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

    sourceMessageId:
      incoming.sourceMessageId !== undefined
        ? incoming.sourceMessageId
          ? String(incoming.sourceMessageId)
          : null
        : current.sourceMessageId,

    updatedAt: new Date().toISOString(),
  };

  guildObject.users[String(userId)] = next;

  if (opts.write !== false) {
    writeAll(data);
  }

  return next;
}

function setUserPseudo(guildId, userId, pseudo, opts = {}) {
  return setUserPseudos(
    guildId,
    userId,
    {
      pseudo,
      sourceMessageId:
        opts.sourceMessageId !== undefined
          ? opts.sourceMessageId
          : undefined,
    },
    opts
  );
}

function syncGuildPseudoSnapshot(
  guildId,
  snapshot,
  { clearMissing = true } = {}
) {
  if (!guildId) {
    return {
      stored: 0,
      cleared: 0,
      unchanged: 0,
      totalFound: 0,
    };
  }

  const data = readAll();
  const guildObject = ensureGuild(data, guildId);

  const incoming = new Map();

  if (snapshot instanceof Map) {
    for (const [userId, value] of snapshot.entries()) {
      incoming.set(String(userId), value);
    }
  } else if (snapshot && typeof snapshot === "object") {
    for (const [userId, value] of Object.entries(snapshot)) {
      incoming.set(String(userId), value);
    }
  }

  let stored = 0;
  let cleared = 0;
  let unchanged = 0;

  if (clearMissing) {
    for (const userId of Object.keys(guildObject.users)) {
      if (incoming.has(String(userId))) continue;

      const current = ensureUser(guildObject, userId);

      if (current.pseudo || current.sourceMessageId) {
        guildObject.users[String(userId)] = {
          ...current,
          pseudo: "",
          sourceMessageId: null,
          updatedAt: new Date().toISOString(),
        };

        cleared++;
      } else {
        unchanged++;
      }
    }
  }

  for (const [userId, value] of incoming.entries()) {
    const current = ensureUser(guildObject, userId);

    const pseudo = normalizeValue(value?.pseudo, 40);

    if (!pseudo) continue;

    const sourceMessageId =
      value?.messageId || value?.sourceMessageId
        ? String(value.messageId || value.sourceMessageId)
        : null;

    const changed =
      current.pseudo !== pseudo ||
      current.sourceMessageId !== sourceMessageId;

    guildObject.users[String(userId)] = {
      ...current,
      pseudo,
      sourceMessageId,
      updatedAt: changed
        ? new Date().toISOString()
        : current.updatedAt,
    };

    if (changed) {
      stored++;
    } else {
      unchanged++;
    }
  }

  writeAll(data);

  return {
    stored,
    cleared,
    unchanged,
    totalFound: incoming.size,
  };
}

function exportAllPseudos() {
  const data = readAll();

  const output = {
    version: 3,
    guilds: {},
  };

  for (const [guildId, guildObject] of Object.entries(data.guilds || {})) {
    const users =
      guildObject?.users && typeof guildObject.users === "object"
        ? guildObject.users
        : {};

    output.guilds[guildId] = {
      users: {},
    };

    for (const [userId, user] of Object.entries(users)) {
      output.guilds[guildId].users[userId] =
        normalizeStoredUser(user);
    }
  }

  return output;
}

function importAllPseudos(payload, { replace = false } = {}) {
  const data = readAll();

  const incomingGuilds =
    payload?.guilds && typeof payload.guilds === "object"
      ? payload.guilds
      : {};

  if (replace) {
    data.guilds = {};
  }

  for (const [guildId, guildData] of Object.entries(incomingGuilds)) {
    const guildObject = ensureGuild(data, guildId);

    const users =
      guildData?.users && typeof guildData.users === "object"
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

        sourceMessageId:
          user?.sourceMessageId
            ? String(user.sourceMessageId)
            : current.sourceMessageId,

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
  syncGuildPseudoSnapshot,

  exportAllPseudos,
  importAllPseudos,
  resetGuildPseudos,
};
