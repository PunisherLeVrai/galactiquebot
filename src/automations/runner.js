// src/automations/runner.js
// Automation runner — CommonJS
// ✅ Lance l'automatisation pseudo toutes les heures
// ✅ Fonctionne même si pseudoScanChannelId n'est pas configuré : sync basée sur username/pseudos store
// ✅ Scan salon pseudo si configuré + accessible
// ⚠️ Le bot doit avoir "Manage Nicknames" + rôle au-dessus des membres ciblés

const { getGuildConfig } = require("../core/guildConfig");
const { importAllPseudos } = require("../core/pseudoStore");
const { buildMemberLine } = require("../core/memberDisplay");

// ---------------
// Helpers
// ---------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanText(s, max = 64) {
  return String(s || "")
    .replace(/[`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Accepte: "psn:ID", "psn:/ID", "xbox: ID", "ea:ID" (même au milieu d'une phrase)
function parsePlatformIdFromContent(content) {
  const txt = String(content || "");
  const re = /\b(psn|xbox|ea)\s*:\s*\/?\s*([^\s|]{2,64})/i;
  const m = txt.match(re);
  if (!m) return null;

  const platform = String(m[1]).toLowerCase();
  const value = cleanText(m[2], 40);
  if (!value) return null;

  return { platform, value };
}

async function scanPseudoChannel(channel, { limit = 300 } = {}) {
  // Map<userId, { psn?, xbox?, ea? }> (valeur la + récente par plateforme)
  const out = new Map();

  let lastId = undefined;
  let fetched = 0;

  while (fetched < limit) {
    const batchSize = Math.min(100, limit - fetched);
    const messages = await channel.messages.fetch({ limit: batchSize, before: lastId }).catch(() => null);
    if (!messages || messages.size === 0) break;

    for (const msg of messages.values()) {
      if (!msg?.author?.id) continue;
      if (msg.author.bot) continue;

      const parsed = parsePlatformIdFromContent(msg.content);
      if (!parsed) continue;

      const userId = msg.author.id;
      const cur = out.get(userId) || {};

      // On parcourt du + récent au + ancien => on ne remplace pas si déjà trouvé
      if (!cur[parsed.platform]) {
        cur[parsed.platform] = parsed.value;
        out.set(userId, cur);
      }
    }

    fetched += messages.size;
    lastId = messages.last()?.id;
    if (!lastId) break;
  }

  return out;
}

// ---------------
// Job principal
// ---------------
async function runPseudoForGuild(guild, cfg, { scanLimit = 300, throttleMs = 850 } = {}) {
  if (!guild) {
    return { storedCount: 0, ok: 0, fail: 0, skipped: 0, notManageable: 0, scanned: false, scanError: false };
  }

  // 1) Scan (si salon configuré + accessible)
  let storedCount = 0;
  let scanned = false;
  let scanError = false;

  const pseudoScanChannelId = cfg?.pseudoScanChannelId;

  if (pseudoScanChannelId) {
    const ch = await guild.channels.fetch(pseudoScanChannelId).catch(() => null);

    // discord.js v14 : isTextBased() existe, parfois sous forme de fonction
    const isTextBased =
      ch && typeof ch.isTextBased === "function" ? ch.isTextBased() : false;

    if (ch && isTextBased && ch.messages?.fetch) {
      try {
        const scannedMap = await scanPseudoChannel(ch, { limit: scanLimit });

        const usersPayload = {};
        for (const [userId, patch] of scannedMap.entries()) {
          if (!patch || typeof patch !== "object") continue;

          const u = {};
          if (patch.psn) u.psn = patch.psn;
          if (patch.xbox) u.xbox = patch.xbox;
          if (patch.ea) u.ea = patch.ea;

          if (Object.keys(u).length) {
            usersPayload[String(userId)] = u;
            storedCount++;
          }
        }

        if (storedCount > 0) {
          importAllPseudos(
            {
              version: 1,
              guilds: {
                [String(guild.id)]: { users: usersPayload },
              },
            },
            { replace: false }
          );
        }

        scanned = true;
      } catch {
        scanError = true;
      }
    }
  }

  // 2) Sync nicknames (même si scan impossible / non configuré)
  await guild.members.fetch().catch(() => null);

  const members = guild.members.cache.filter((m) => m && !m.user.bot);

  let ok = 0;
  let fail = 0;
  let skipped = 0;
  let notManageable = 0;

  for (const m of members.values()) {
    if (!m.manageable) {
      notManageable++;
      continue;
    }

    const line = buildMemberLine(m, cfg);
    if (!line || line.length < 2) {
      skipped++;
      continue;
    }

    if ((m.nickname || "") === line) {
      skipped++;
      continue;
    }

    try {
      await m.setNickname(line, "PSEUDO_AUTO_SYNC");
      ok++;
    } catch {
      fail++;
    }

    await sleep(throttleMs);
  }

  return { storedCount, ok, fail, skipped, notManageable, scanned, scanError };
}

// ---------------
// Runner
// ---------------
function startAutomationRunner(client, opts = {}) {
  const everyMs = typeof opts.everyMs === "number" ? opts.everyMs : 60 * 60 * 1000; // 1h
  const throttleMs = typeof opts.throttleMs === "number" ? opts.throttleMs : 850;
  const scanLimit = typeof opts.scanLimit === "number" ? opts.scanLimit : 300;

  const tick = async () => {
    try {
      if (!client?.guilds?.cache) return;

      for (const guild of client.guilds.cache.values()) {
        const cfg = getGuildConfig(guild.id);
        if (!cfg) continue;

        // IMPORTANT:
        // On NE bloque PAS l'automatisation si automations.enabled = false.
        // (Sinon tu te retrouves avec "ça marche pas" tant que setup n'a pas été remis ou togglé.)
        // Si tu veux un interrupteur plus tard, on le remettra proprement.

        await runPseudoForGuild(guild, cfg, { scanLimit, throttleMs });
      }
    } catch {
      // volontairement silencieux (évite spam logs)
    }
  };

  // 1) premier run au démarrage (optionnel)
  const runOnStart = opts.runOnStart !== false;
  if (runOnStart) tick();

  // 2) puis toutes les heures
  const timer = setInterval(tick, everyMs);
  timer.unref?.();

  return () => clearInterval(timer);
}

module.exports = {
  startAutomationRunner,
};
