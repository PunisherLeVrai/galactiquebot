// src/core/guildConfig.js
// Configuration multi-serveur PROSYNC
// Stockage : src/config/servers.json
// CommonJS

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(SRC_DIR, "config");
const CONFIG_PATH = path.join(DATA_DIR, "servers.json");

const DEFAULT_DATA = {
  version: 2,
  guilds: {},
};

const DEFAULT_GUILD = {
  botLabel: "PROSYNC",

  disposChannelId: null,
  staffReportsChannelId: null,
  pseudoScanChannelId: null,
  checkDispoChannelId: null,

  dispoMessageIds: [null, null, null, null, null, null, null],

  staffRoleIds: [],
  playerRoleIds: [],
  postRoleIds: [],
  posts: [],

  automations: {
    enabled: false,

    pseudo: {
      enabled: true,
      minute: 10,
    },

    checkDispo: {
      enabled: false,
      times: [],
    },

    rappel: {
      enabled: false,
      times: [],
    },

    avertissement: {
      enabled: false,
      roleId: null,
    },
  },

  setupBy: null,
  setupAt: null,
  updatedAt: null,
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(
      CONFIG_PATH,
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

  const data = safeReadJson(CONFIG_PATH, {
    version: DEFAULT_DATA.version,
    guilds: {},
  });

  if (!data || typeof data !== "object") {
    return {
      version: DEFAULT_DATA.version,
      guilds: {},
    };
  }

  if (!data.guilds || typeof data.guilds !== "object") {
    data.guilds = {};
  }

  if (!data.version) {
    data.version = DEFAULT_DATA.version;
  }

  return data;
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
}

function uniqIds(arr, { max = null } = {}) {
  const output = [];
  const seen = new Set();

  for (const value of Array.isArray(arr) ? arr : []) {
    const id = String(value || "").trim();

    if (!id || seen.has(id)) continue;

    seen.add(id);
    output.push(id);

    if (typeof max === "number" && output.length >= max) break;
  }

  return output;
}

function isSnowflake(value) {
  return /^[0-9]{15,25}$/.test(String(value || "").trim());
}

function normalizeOptionalId(value) {
  return isSnowflake(value) ? String(value).trim() : null;
}

function normalizeDispoMessageIds(input) {
  const source = Array.isArray(input) ? input : [];
  const output = new Array(7).fill(null);

  for (let index = 0; index < 7; index++) {
    output[index] = normalizeOptionalId(source[index]);
  }

  return output;
}

function toBool(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function clampInt(
  value,
  { min = 0, max = 59, fallback = 0 } = {}
) {
  const number = Number(value);

  if (!Number.isFinite(number)) return fallback;

  const integer = Math.trunc(number);

  if (integer < min) return min;
  if (integer > max) return max;

  return integer;
}

function normalizeTimeStr(value) {
  const string = String(value || "").trim();
  const match = string.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}`;
}

function normalizeTimes(input, { max = 12 } = {}) {
  const output = [];
  const seen = new Set();

  for (const value of Array.isArray(input) ? input : []) {
    const time = normalizeTimeStr(value);

    if (!time || seen.has(time)) continue;

    seen.add(time);
    output.push(time);

    if (output.length >= max) break;
  }

  output.sort((a, b) => a.localeCompare(b));
  return output;
}

function normalizeAutomations(input) {
  const source =
    input && typeof input === "object" ? input : {};

  const pseudoSource =
    source.pseudo && typeof source.pseudo === "object"
      ? source.pseudo
      : {};

  const checkSource =
    source.checkDispo && typeof source.checkDispo === "object"
      ? source.checkDispo
      : {};

  const rappelSource =
    source.rappel && typeof source.rappel === "object"
      ? source.rappel
      : {};

  const legacyReminderSource =
    source.reminderDispo &&
    typeof source.reminderDispo === "object"
      ? source.reminderDispo
      : {};

  const warningSource =
    source.avertissement &&
    typeof source.avertissement === "object"
      ? source.avertissement
      : {};

  const rappelEnabled = Object.prototype.hasOwnProperty.call(
    rappelSource,
    "enabled"
  )
    ? toBool(
        rappelSource.enabled,
        DEFAULT_GUILD.automations.rappel.enabled
      )
    : toBool(
        legacyReminderSource.enabled,
        DEFAULT_GUILD.automations.rappel.enabled
      );

  const rappelTimes = Array.isArray(rappelSource.times)
    ? normalizeTimes(rappelSource.times)
    : normalizeTimes(legacyReminderSource.times);

  return {
    enabled: toBool(
      source.enabled,
      DEFAULT_GUILD.automations.enabled
    ),

    pseudo: {
      enabled: toBool(
        pseudoSource.enabled,
        DEFAULT_GUILD.automations.pseudo.enabled
      ),
      minute: clampInt(pseudoSource.minute, {
        min: 0,
        max: 59,
        fallback: DEFAULT_GUILD.automations.pseudo.minute,
      }),
    },

    checkDispo: {
      enabled: toBool(
        checkSource.enabled,
        DEFAULT_GUILD.automations.checkDispo.enabled
      ),
      times: normalizeTimes(checkSource.times),
    },

    rappel: {
      enabled: rappelEnabled,
      times: rappelTimes,
    },

    avertissement: {
      enabled: toBool(
        warningSource.enabled,
        DEFAULT_GUILD.automations.avertissement.enabled
      ),
      roleId: normalizeOptionalId(warningSource.roleId),
    },
  };
}

function extractPostRoleIdsFromLegacyPosts(posts) {
  if (!Array.isArray(posts)) return [];

  return uniqIds(
    posts
      .filter(
        (post) =>
          post &&
          typeof post === "object" &&
          post.roleId
      )
      .map((post) => post.roleId),
    { max: 25 }
  );
}

function buildLegacyPostsFromIds(postRoleIds) {
  return uniqIds(postRoleIds, { max: 25 }).map((roleId) => ({
    roleId: String(roleId),
    label: "POSTE",
  }));
}

function normalizeGuild(config) {
  const source =
    config && typeof config === "object" ? config : {};

  const output = {
    ...DEFAULT_GUILD,
    ...source,
  };

  output.botLabel = "PROSYNC";
  output.automations = normalizeAutomations(source.automations);

  output.staffRoleIds = uniqIds(output.staffRoleIds);
  output.playerRoleIds = uniqIds(output.playerRoleIds);

  if (!output.staffRoleIds.length && source.staffRoleId) {
    output.staffRoleIds = uniqIds([source.staffRoleId]);
  }

  if (!output.playerRoleIds.length && source.playerRoleId) {
    output.playerRoleIds = uniqIds([source.playerRoleId]);
  }

  const configuredPostRoleIds = Array.isArray(source.postRoleIds)
    ? source.postRoleIds
    : null;

  const legacyPostRoleIds =
    extractPostRoleIdsFromLegacyPosts(source.posts);

  output.postRoleIds = uniqIds(
    configuredPostRoleIds ?? legacyPostRoleIds,
    { max: 25 }
  );

  output.posts = buildLegacyPostsFromIds(output.postRoleIds);
  output.dispoMessageIds = normalizeDispoMessageIds(
    source.dispoMessageIds
  );

  output.disposChannelId = source.disposChannelId
    ? String(source.disposChannelId)
    : null;

  output.staffReportsChannelId = source.staffReportsChannelId
    ? String(source.staffReportsChannelId)
    : null;

  output.pseudoScanChannelId = source.pseudoScanChannelId
    ? String(source.pseudoScanChannelId)
    : null;

  output.checkDispoChannelId = source.checkDispoChannelId
    ? String(source.checkDispoChannelId)
    : null;

  return output;
}

function getGuildConfig(guildId) {
  if (!guildId) return null;

  const data = readAll();
  const config = data.guilds[String(guildId)];

  return config ? normalizeGuild(config) : null;
}

function upsertGuildConfig(guildId, patch) {
  if (!guildId) return null;

  const data = readAll();
  const id = String(guildId);

  const current = normalizeGuild(data.guilds[id] || {});
  const source =
    patch && typeof patch === "object" ? patch : {};

  const staffRoleIds = Array.isArray(source.staffRoleIds)
    ? source.staffRoleIds
    : current.staffRoleIds;

  const playerRoleIds = Array.isArray(source.playerRoleIds)
    ? source.playerRoleIds
    : current.playerRoleIds;

  let postRoleIds = current.postRoleIds;

  if (Array.isArray(source.postRoleIds)) {
    postRoleIds = source.postRoleIds;
  } else if (Array.isArray(source.posts)) {
    postRoleIds =
      extractPostRoleIdsFromLegacyPosts(source.posts);
  }

  const dispoMessageIds = Array.isArray(
    source.dispoMessageIds
  )
    ? source.dispoMessageIds
    : current.dispoMessageIds;

  const checkDispoChannelId =
    Object.prototype.hasOwnProperty.call(
      source,
      "checkDispoChannelId"
    )
      ? source.checkDispoChannelId
        ? String(source.checkDispoChannelId)
        : null
      : current.checkDispoChannelId;

  const mergedAutomations = normalizeAutomations({
    ...current.automations,
    ...(source.automations || {}),

    pseudo: {
      ...(current.automations?.pseudo || {}),
      ...(source.automations?.pseudo || {}),
    },

    checkDispo: {
      ...(current.automations?.checkDispo || {}),
      ...(source.automations?.checkDispo || {}),
    },

    rappel: {
      ...(current.automations?.rappel || {}),
      ...(source.automations?.rappel || {}),
    },

    avertissement: {
      ...(current.automations?.avertissement || {}),
      ...(source.automations?.avertissement || {}),
    },

    reminderDispo: {
      ...(source.automations?.reminderDispo || {}),
    },
  });

  const merged = normalizeGuild({
    ...current,
    ...source,
    botLabel: "PROSYNC",
    staffRoleIds,
    playerRoleIds,
    postRoleIds,
    dispoMessageIds,
    checkDispoChannelId,
    automations: mergedAutomations,
  });

  merged.updatedAt = new Date().toISOString();

  data.version = DEFAULT_DATA.version;
  data.guilds[id] = merged;

  writeAll(data);
  return merged;
}

function exportAllConfig() {
  const data = readAll();

  const output = {
    version: DEFAULT_DATA.version,
    guilds: {},
  };

  for (const [guildId, config] of Object.entries(
    data.guilds || {}
  )) {
    output.guilds[guildId] = normalizeGuild(config);
  }

  return output;
}

function importAllConfig(payload, { replace = false } = {}) {
  const data = readAll();

  const source =
    payload && typeof payload === "object" ? payload : {};

  const incomingGuilds =
    source.guilds && typeof source.guilds === "object"
      ? source.guilds
      : {};

  if (replace) {
    data.guilds = {};
  }

  for (const [guildId, config] of Object.entries(
    incomingGuilds
  )) {
    data.guilds[String(guildId)] = normalizeGuild(config);
  }

  data.version = DEFAULT_DATA.version;
  writeAll(data);

  return exportAllConfig();
}

function resetGuildConfig(guildId) {
  if (!guildId) return false;

  const data = readAll();
  delete data.guilds[String(guildId)];
  writeAll(data);

  return true;
}

module.exports = {
  SRC_DIR,
  DATA_DIR,
  CONFIG_PATH,

  DEFAULT_DATA,
  DEFAULT_GUILD,

  getGuildConfig,
  upsertGuildConfig,
  exportAllConfig,

  importAllConfig,
  resetGuildConfig,
};
