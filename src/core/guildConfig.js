// src/core/guildConfig.js
// Configuration multi-serveur PRIME — CommonJS

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(SRC_DIR, "config");
const CONFIG_PATH = path.join(DATA_DIR, "servers.json");

const DEFAULT_DATA = {
  version: 5,
  guilds: {},
};

const DEFAULT_GUILD = {
  botLabel: "PRIME",

  disposChannelId: null,
  staffReportsChannelId: null,
  pseudoScanChannelId: null,
  displayRoleId: null,
  checkDispoChannelId: null,

  dispoMessageIds: [null, null, null, null, null, null, null],

  // Plusieurs systèmes de disponibilités peuvent coexister sur un serveur.
  disponibilites: [],

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
      roleIds: [null, null, null],
      roleId: null,
      lastProcessedDate: null,
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

  data.version = DEFAULT_DATA.version;
  return data;
}

function writeAll(data) {
  ensureFile();
  data.version = DEFAULT_DATA.version;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
}

function uniqIds(input, { max = null } = {}) {
  const output = [];
  const seen = new Set();

  for (const value of Array.isArray(input) ? input : []) {
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

function normalizeFixedRoleIds(input, length = 3) {
  const source = Array.isArray(input) ? input : [];
  const output = new Array(length).fill(null);
  const seen = new Set();

  for (let index = 0; index < length; index++) {
    const id = normalizeOptionalId(source[index]);

    if (!id || seen.has(id)) continue;

    seen.add(id);
    output[index] = id;
  }

  return output;
}

function normalizeDispoMessageIds(input) {
  const source = Array.isArray(input) ? input : [];

  return Array.from(
    { length: 7 },
    (_, index) => normalizeOptionalId(source[index])
  );
}

function toBool(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function clampInt(value, { min = 0, max = 59, fallback = 0 } = {}) {
  const number = Number(value);

  if (!Number.isFinite(number)) return fallback;

  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function normalizeTimeStr(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
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

  return output.sort((a, b) => a.localeCompare(b));
}

function normalizeDateKey(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeAutomations(input) {
  const source = input && typeof input === "object" ? input : {};

  const pseudo =
    source.pseudo && typeof source.pseudo === "object" ? source.pseudo : {};

  const check =
    source.checkDispo && typeof source.checkDispo === "object"
      ? source.checkDispo
      : {};

  const rappel =
    source.rappel && typeof source.rappel === "object"
      ? source.rappel
      : {};

  const legacyRappel =
    source.reminderDispo && typeof source.reminderDispo === "object"
      ? source.reminderDispo
      : {};

  const warning =
    source.avertissement && typeof source.avertissement === "object"
      ? source.avertissement
      : {};

  const rappelEnabled = Object.prototype.hasOwnProperty.call(
    rappel,
    "enabled"
  )
    ? toBool(rappel.enabled, false)
    : toBool(legacyRappel.enabled, false);

  const rappelTimes = Array.isArray(rappel.times)
    ? normalizeTimes(rappel.times)
    : normalizeTimes(legacyRappel.times);

  const legacyRoleId = normalizeOptionalId(warning.roleId);

  const roleIds = normalizeFixedRoleIds(
    Array.isArray(warning.roleIds)
      ? warning.roleIds
      : [legacyRoleId, null, null],
    3
  );

  return {
    enabled: toBool(source.enabled, false),

    pseudo: {
      enabled: toBool(pseudo.enabled, true),
      minute: clampInt(pseudo.minute, { fallback: 10 }),
    },

    checkDispo: {
      enabled: toBool(check.enabled, false),
      times: normalizeTimes(check.times),
    },

    rappel: {
      enabled: rappelEnabled,
      times: rappelTimes,
    },

    avertissement: {
      enabled: toBool(warning.enabled, false),
      roleIds,
      roleId: roleIds[0] || null,
      lastProcessedDate: normalizeDateKey(warning.lastProcessedDate),
    },
  };
}

function extractPostRoleIdsFromLegacyPosts(posts) {
  return uniqIds(
    (Array.isArray(posts) ? posts : [])
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

function buildLegacyPostsFromIds(ids) {
  return uniqIds(ids, { max: 25 }).map((roleId) => ({
    roleId,
    label: "POSTE",
  }));
}

function normalizeDisponibilite(input, fallbackId = "principal") {
  const source =
    input && typeof input === "object"
      ? input
      : {};

  const id = String(
    source.id || fallbackId
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 32) || fallbackId;

  const automations = normalizeAutomations({
    enabled: true,
    pseudo: {
      enabled: false,
      minute: 10,
    },
    checkDispo: source.automations?.checkDispo,
    rappel: source.automations?.rappel,
    avertissement: source.automations?.avertissement,
  });

  return {
    id,
    nom: String(source.nom || source.name || id)
      .replace(/[`|]/g, "")
      .trim()
      .slice(0, 50) || id,

    disposChannelId: normalizeOptionalId(
      source.disposChannelId || source.channelId
    ),

    checkDispoChannelId: normalizeOptionalId(
      source.checkDispoChannelId ||
      source.disposChannelId ||
      source.channelId
    ),

    reportChannelId: normalizeOptionalId(
      source.reportChannelId ||
      source.staffReportsChannelId
    ),

    playerRoleIds: uniqIds(
      source.playerRoleIds,
      { max: 25 }
    ),

    dispoMessageIds: normalizeDispoMessageIds(
      source.dispoMessageIds || source.messageIds
    ),

    automations: {
      checkDispo: automations.checkDispo,
      rappel: automations.rappel,
      avertissement: automations.avertissement,
    },
  };
}

function buildLegacyDisponibilite(source) {
  const hasLegacyData =
    source.disposChannelId ||
    source.checkDispoChannelId ||
    source.staffReportsChannelId ||
    (Array.isArray(source.playerRoleIds) && source.playerRoleIds.length) ||
    (Array.isArray(source.dispoMessageIds) && source.dispoMessageIds.some(Boolean));

  if (!hasLegacyData) {
    return null;
  }

  return normalizeDisponibilite({
    id: "principal",
    nom: "Principal",
    disposChannelId: source.disposChannelId,
    checkDispoChannelId: source.checkDispoChannelId,
    reportChannelId: source.staffReportsChannelId,
    playerRoleIds: source.playerRoleIds,
    dispoMessageIds: source.dispoMessageIds,
    automations: {
      checkDispo: source.automations?.checkDispo,
      rappel: source.automations?.rappel,
      avertissement: source.automations?.avertissement,
    },
  });
}

function normalizeDisponibilites(source) {
  const raw = Array.isArray(source?.disponibilites)
    ? source.disponibilites
    : Array.isArray(source?.availabilities)
      ? source.availabilities
      : [];

  const output = [];
  const seen = new Set();

  for (let index = 0; index < raw.length; index++) {
    const item = normalizeDisponibilite(
      raw[index],
      `dispo-${index + 1}`
    );

    if (seen.has(item.id)) continue;

    seen.add(item.id);
    output.push(item);
  }

  if (!output.length) {
    const legacy = buildLegacyDisponibilite(source || {});

    if (legacy) {
      output.push(legacy);
    }
  }

  return output.slice(0, 20);
}

function normalizeGuild(config) {
  const source = config && typeof config === "object" ? config : {};

  const output = {
    ...DEFAULT_GUILD,
    ...source,
  };

  output.botLabel = "PRIME";
  output.automations = normalizeAutomations(source.automations);
  output.disponibilites = normalizeDisponibilites(source);

  output.staffRoleIds = uniqIds(output.staffRoleIds);
  output.playerRoleIds = uniqIds(output.playerRoleIds);

  if (!output.staffRoleIds.length && source.staffRoleId) {
    output.staffRoleIds = uniqIds([source.staffRoleId]);
  }

  if (!output.playerRoleIds.length && source.playerRoleId) {
    output.playerRoleIds = uniqIds([source.playerRoleId]);
  }

  output.postRoleIds = uniqIds(
    Array.isArray(source.postRoleIds)
      ? source.postRoleIds
      : extractPostRoleIdsFromLegacyPosts(source.posts),
    { max: 25 }
  );

  output.posts = buildLegacyPostsFromIds(output.postRoleIds);

  output.dispoMessageIds = normalizeDispoMessageIds(
    source.dispoMessageIds
  );

  output.disposChannelId = normalizeOptionalId(source.disposChannelId);
  output.staffReportsChannelId = normalizeOptionalId(
    source.staffReportsChannelId
  );
  output.pseudoScanChannelId = normalizeOptionalId(
    source.pseudoScanChannelId
  );
  output.displayRoleId = normalizeOptionalId(source.displayRoleId);
  output.checkDispoChannelId = normalizeOptionalId(
    source.checkDispoChannelId
  );

  const principal = output.disponibilites[0] || null;

  if (principal) {
    output.disposChannelId = principal.disposChannelId;
    output.checkDispoChannelId = principal.checkDispoChannelId;
    output.staffReportsChannelId = principal.reportChannelId;
    output.playerRoleIds = [...principal.playerRoleIds];
    output.dispoMessageIds = [...principal.dispoMessageIds];
    output.automations.checkDispo = principal.automations.checkDispo;
    output.automations.rappel = principal.automations.rappel;
    output.automations.avertissement = principal.automations.avertissement;
  }

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
  const source = patch && typeof patch === "object" ? patch : {};

  const mergedAutomations = normalizeAutomations({
    ...current.automations,
    ...(source.automations || {}),

    pseudo: {
      ...(current.automations.pseudo || {}),
      ...(source.automations?.pseudo || {}),
    },

    checkDispo: {
      ...(current.automations.checkDispo || {}),
      ...(source.automations?.checkDispo || {}),
    },

    rappel: {
      ...(current.automations.rappel || {}),
      ...(source.automations?.rappel || {}),
    },

    avertissement: {
      ...(current.automations.avertissement || {}),
      ...(source.automations?.avertissement || {}),
    },
  });

  const hasExplicitDisponibilites =
    Array.isArray(source.disponibilites) ||
    Array.isArray(source.availabilities);

  let mergedDisponibilites = hasExplicitDisponibilites
    ? (Array.isArray(source.disponibilites)
        ? source.disponibilites
        : source.availabilities)
    : current.disponibilites;

  if (!hasExplicitDisponibilites) {
    const hasPrincipalPatch =
      Object.prototype.hasOwnProperty.call(source, "disposChannelId") ||
      Object.prototype.hasOwnProperty.call(source, "checkDispoChannelId") ||
      Object.prototype.hasOwnProperty.call(source, "staffReportsChannelId") ||
      Object.prototype.hasOwnProperty.call(source, "playerRoleIds") ||
      Object.prototype.hasOwnProperty.call(source, "dispoMessageIds") ||
      source.automations?.checkDispo !== undefined ||
      source.automations?.rappel !== undefined ||
      source.automations?.avertissement !== undefined;

    if (hasPrincipalPatch) {
      const currentPrincipal =
        current.disponibilites[0] ||
        normalizeDisponibilite(
          {
            id: "principal",
            nom: "Principal",
          },
          "principal"
        );

      const updatedPrincipal = normalizeDisponibilite(
        {
          ...currentPrincipal,

          disposChannelId:
            Object.prototype.hasOwnProperty.call(source, "disposChannelId")
              ? source.disposChannelId
              : currentPrincipal.disposChannelId,

          checkDispoChannelId:
            Object.prototype.hasOwnProperty.call(source, "checkDispoChannelId")
              ? source.checkDispoChannelId
              : currentPrincipal.checkDispoChannelId,

          reportChannelId:
            Object.prototype.hasOwnProperty.call(source, "staffReportsChannelId")
              ? source.staffReportsChannelId
              : currentPrincipal.reportChannelId,

          playerRoleIds: Array.isArray(source.playerRoleIds)
            ? source.playerRoleIds
            : currentPrincipal.playerRoleIds,

          dispoMessageIds: Array.isArray(source.dispoMessageIds)
            ? source.dispoMessageIds
            : currentPrincipal.dispoMessageIds,

          automations: {
            checkDispo: source.automations?.checkDispo !== undefined
              ? mergedAutomations.checkDispo
              : currentPrincipal.automations.checkDispo,

            rappel: source.automations?.rappel !== undefined
              ? mergedAutomations.rappel
              : currentPrincipal.automations.rappel,

            avertissement: source.automations?.avertissement !== undefined
              ? mergedAutomations.avertissement
              : currentPrincipal.automations.avertissement,
          },
        },
        currentPrincipal.id || "principal"
      );

      mergedDisponibilites = [
        updatedPrincipal,
        ...current.disponibilites.slice(1),
      ];
    }
  }

  const merged = normalizeGuild({
    ...current,
    ...source,

    botLabel: "PRIME",

    staffRoleIds: Array.isArray(source.staffRoleIds)
      ? source.staffRoleIds
      : current.staffRoleIds,

    playerRoleIds: Array.isArray(source.playerRoleIds)
      ? source.playerRoleIds
      : current.playerRoleIds,

    postRoleIds: Array.isArray(source.postRoleIds)
      ? source.postRoleIds
      : Array.isArray(source.posts)
        ? extractPostRoleIdsFromLegacyPosts(source.posts)
        : current.postRoleIds,

    dispoMessageIds: Array.isArray(source.dispoMessageIds)
      ? source.dispoMessageIds
      : current.dispoMessageIds,

    disponibilites: mergedDisponibilites,

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

  for (const [guildId, config] of Object.entries(data.guilds || {})) {
    output.guilds[guildId] = normalizeGuild(config);
  }

  return output;
}

function importAllConfig(payload, { replace = false } = {}) {
  const data = readAll();

  const incoming =
    payload?.guilds && typeof payload.guilds === "object"
      ? payload.guilds
      : {};

  if (replace) {
    data.guilds = {};
  }

  for (const [guildId, config] of Object.entries(incoming)) {
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

  normalizeDisponibilite,
};
