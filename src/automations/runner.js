// src/automations/runner.js
// Automation runner — CommonJS — MULTI JOBS
//
// ✅ PSEUDO
// - Lance l'automatisation /pseudo toutes les heures à HH:<minute> (défaut 10)
// - Respecte cfg.automations.enabled === true
// - Respecte cfg.automations.pseudo.enabled === true (si présent), sinon fallback sur cfg.automations.enabled
//
// ✅ CHECK_DISPO (AUTO REPORT)
// - Poste un embed NON-EPHEMERE dans le salon Staff (cfg.staffReportsChannelId)
// - Analyse le jour "aujourd’hui" (Lun..Dim) via cfg.dispoMessageIds[0..6]
// - Respecte cfg.automations.checkDispo.enabled === true
// - Déclenchements configurables via cfg.automations.checkDispo.times = ["21:10","22:10", ...]
//   (format 24h, Paris). Si absent -> aucun run automatique.
//
// ⚠️ Le bot doit avoir:
// - Manage Nicknames (pour PSEUDO)
// - accès lecture aux messages de dispos + lecture réactions (pour CHECK_DISPO)
// - droit d'envoyer embeds dans le salon staffReportsChannelId

const { EmbedBuilder } = require("discord.js");

const { getGuildConfig } = require("../core/guildConfig");
const { importAllPseudos } = require("../core/pseudoStore");
const { buildMemberLine } = require("../core/memberDisplay");

// --------------------
// Constantes
// --------------------
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

// JS getDay(): 0=Dim .. 6=Sam  -> nous: 0=Lun .. 6=Dim
function dayIndexFromDate(d = new Date()) {
  const js = d.getDay(); // 0..6 (Dim..Sam)
  return js === 0 ? 6 : js - 1;
}

// --------------------
// Helpers généraux
// --------------------
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

function uniq(arr) {
  return Array.from(new Set((arr || []).map(String))).filter(Boolean);
}

function mentionList(ids, { empty = "—", max = 40 } = {}) {
  const u = uniq(ids);
  if (!u.length) return empty;

  const sliced = u.slice(0, max).map((id) => `<@${id}>`);
  const more = u.length > max ? `\n… +${u.length - max}` : "";
  return sliced.join(" ") + more;
}

// --------------------
// PSEUDO — scan salon
// --------------------

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

async function runPseudoForGuild(guild, cfg, { scanLimit = 300, throttleMs = 850 } = {}) {
  if (!guild) return { storedCount: 0, ok: 0, fail: 0, skipped: 0, notManageable: 0, scanned: false };

  // 1) Scan (si salon configuré + accessible)
  let storedCount = 0;
  let scanned = false;

  const pseudoScanChannelId = cfg?.pseudoScanChannelId;
  if (pseudoScanChannelId) {
    const ch = await guild.channels.fetch(pseudoScanChannelId).catch(() => null);
    if (ch && typeof ch.isTextBased === "function" && ch.isTextBased()) {
      const scannedMap = await scanPseudoChannel(ch, { limit: scanLimit }).catch(() => new Map());

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

  return { storedCount, ok, fail, skipped, notManageable, scanned };
}

// --------------------
// CHECK_DISPO — job auto
// --------------------
function hasAnyRoleId(member, ids) {
  const arr = Array.isArray(ids) ? ids : [];
  return arr.some((id) => id && member.roles.cache.has(String(id)));
}

function getDispoMessageIds(cfg) {
  if (Array.isArray(cfg?.dispoMessageIds)) {
    const a = cfg.dispoMessageIds.slice(0, 7).map((v) => (v ? String(v) : null));
    while (a.length < 7) a.push(null);
    return a;
  }

  // fallback legacy
  const legacy = [];
  for (let i = 0; i < 7; i++) legacy.push(cfg?.[`dispoMessageId_${i}`] ? String(cfg[`dispoMessageId_${i}`]) : null);
  while (legacy.length < 7) legacy.push(null);
  return legacy.slice(0, 7);
}

async function safeFetchMessage(channel, messageId) {
  if (!channel || !messageId) return null;
  try {
    return await channel.messages.fetch(String(messageId));
  } catch {
    return null;
  }
}

async function collectReactionUserIds(message, emojiName) {
  const out = new Set();
  if (!message?.reactions?.cache) return out;

  const reaction =
    message.reactions.cache.find((r) => r?.emoji?.name === emojiName) ||
    message.reactions.cache.find((r) => r?.emoji?.toString?.() === emojiName);

  if (!reaction) return out;

  try {
    const users = await reaction.users.fetch();
    for (const u of users.values()) {
      if (!u?.id) continue;
      if (u.bot) continue;
      out.add(u.id);
    }
  } catch {}

  return out;
}

function resolveDispoChannelId(cfg) {
  // checkDispoChannelId prioritaire, sinon disposChannelId
  const v = cfg?.checkDispoChannelId && String(cfg.checkDispoChannelId) !== "null" ? cfg.checkDispoChannelId : cfg?.disposChannelId;
  return v ? String(v) : null;
}

async function runCheckDispoForGuild(guild, cfg, { throttleMs = 0 } = {}) {
  if (!guild) return { ok: false, reason: "no_guild" };

  const reportChannelId = cfg?.staffReportsChannelId ? String(cfg.staffReportsChannelId) : null;
  if (!reportChannelId) return { ok: false, reason: "no_staff_reports_channel" };

  const disposChannelId = resolveDispoChannelId(cfg);
  if (!disposChannelId) return { ok: false, reason: "no_dispo_channel" };

  const messageIds = getDispoMessageIds(cfg);
  const idx = dayIndexFromDate(new Date());
  const dayLabel = DAYS[idx];
  const mid = messageIds[idx];

  const reportChannel = await guild.channels.fetch(reportChannelId).catch(() => null);
  if (!reportChannel || !reportChannel.isTextBased?.()) return { ok: false, reason: "invalid_report_channel" };

  const dispoChannel = await guild.channels.fetch(disposChannelId).catch(() => null);
  if (!dispoChannel || !dispoChannel.isTextBased?.()) return { ok: false, reason: "invalid_dispo_channel" };

  // Fetch membres pour filtrer joueurs
  await guild.members.fetch().catch(() => null);

  const playerRoleIds = Array.isArray(cfg?.playerRoleIds) ? cfg.playerRoleIds : [];
  if (!playerRoleIds.length) return { ok: false, reason: "no_player_roles" };

  const players = guild.members.cache
    .filter((m) => m && !m.user.bot)
    .filter((m) => hasAnyRoleId(m, playerRoleIds));

  const playerIds = new Set(players.map((m) => m.user.id));

  const embed = new EmbedBuilder()
    .setTitle(`📊 Check Dispo — ${dayLabel}`)
    .setColor(0x5865f2)
    .setDescription(
      `Salon : <#${disposChannelId}>\n` +
      `Filtre : rôles Joueurs (👟)\n` +
      `Joueurs détectés : **${playerIds.size}**`
    )
    .setFooter({ text: "XIG BLAUGRANA FC Staff" });

  if (!mid) {
    embed.addFields({
      name: "⚠️ Message",
      value: "ID du message non configuré pour ce jour (Lun..Dim).",
      inline: false,
    });

    await reportChannel.send({ embeds: [embed] }).catch(() => null);
    if (throttleMs) await sleep(throttleMs);
    return { ok: true, dayIndex: idx, dayLabel, mid: null };
  }

  const msg = await safeFetchMessage(dispoChannel, mid);
  if (!msg) {
    embed.addFields({
      name: "⚠️ Message",
      value: `Message introuvable (ID: \`${mid}\`).`,
      inline: false,
    });

    await reportChannel.send({ embeds: [embed] }).catch(() => null);
    if (throttleMs) await sleep(throttleMs);
    return { ok: true, dayIndex: idx, dayLabel, mid, missingMessage: true };
  }

  const okSet = await collectReactionUserIds(msg, "✅");
  const noSet = await collectReactionUserIds(msg, "❌");

  const okPlayers = Array.from(okSet).filter((id) => playerIds.has(id));
  const noPlayers = Array.from(noSet).filter((id) => playerIds.has(id));

  const reacted = new Set([...okPlayers, ...noPlayers]);
  const missing = Array.from(playerIds).filter((id) => !reacted.has(id));

  embed.addFields(
    { name: `🟩 ✅ Présents (${okPlayers.length})`, value: mentionList(okPlayers), inline: false },
    { name: `🟥 ❌ Absents (${noPlayers.length})`, value: mentionList(noPlayers), inline: false },
    { name: `🟦 ⏳ Sans réaction (${missing.length})`, value: mentionList(missing), inline: false }
  );

  await reportChannel.send({ embeds: [embed] }).catch(() => null);
  if (throttleMs) await sleep(throttleMs);

  return { ok: true, dayIndex: idx, dayLabel, mid };
}

// --------------------
// Scheduler (HH:MM) — anti double-run
// --------------------
function pad2(n) {
  return String(n).padStart(2, "0");
}

function minuteKey(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

function parseHHMM(s) {
  const m = String(s || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return { hh: Number(m[1]), mm: Number(m[2]) };
}

// --------------------
// Runner
// --------------------
function startAutomationRunner(client, opts = {}) {
  const scanLimit = typeof opts.scanLimit === "number" ? opts.scanLimit : 300;
  const throttleMsPseudo = typeof opts.throttleMsPseudo === "number" ? opts.throttleMsPseudo : 850;
  const throttleMsCheck = typeof opts.throttleMsCheck === "number" ? opts.throttleMsCheck : 0;

  // tick loop fréquence (plus petit = plus précis, mais inutilement agressif)
  const loopMs = typeof opts.loopMs === "number" ? opts.loopMs : 20_000; // 20s

  // anti double-run: Map<guildId:job, lastMinuteKey>
  const lastRun = new Map();

  async function tick() {
    try {
      if (!client?.guilds?.cache) return;

      const now = new Date();
      const hh = now.getHours();
      const mm = now.getMinutes();
      const mKey = minuteKey(now);

      for (const guild of client.guilds.cache.values()) {
        const cfg = getGuildConfig(guild.id);
        if (!cfg) continue;

        // switch global
        if (cfg?.automations?.enabled !== true) continue;

        // ---------- PSEUDO ----------
        const pseudoEnabled = cfg?.automations?.pseudo?.enabled;
        const pseudoMinute =
          Number.isInteger(cfg?.automations?.pseudo?.minute) ? cfg.automations.pseudo.minute :
          Number.isInteger(cfg?.automations?.minute) ? cfg.automations.minute :
          10;

        const allowPseudo = pseudoEnabled === true || (pseudoEnabled === undefined && cfg?.automations?.enabled === true);

        if (allowPseudo && mm === pseudoMinute) {
          const key = `${guild.id}:pseudo`;
          if (lastRun.get(key) !== mKey) {
            lastRun.set(key, mKey);
            await runPseudoForGuild(guild, cfg, { scanLimit, throttleMs: throttleMsPseudo });
          }
        }

        // ---------- CHECK_DISPO ----------
        const cdEnabled = cfg?.automations?.checkDispo?.enabled === true;
        if (cdEnabled) {
          const times = Array.isArray(cfg?.automations?.checkDispo?.times) ? cfg.automations.checkDispo.times : [];
          // ex: ["21:10","22:10"]
          for (const t of times) {
            const parsed = parseHHMM(t);
            if (!parsed) continue;

            if (hh === parsed.hh && mm === parsed.mm) {
              const key = `${guild.id}:check_dispo:${t}`;
              if (lastRun.get(key) !== mKey) {
                lastRun.set(key, mKey);
                await runCheckDispoForGuild(guild, cfg, { throttleMs: throttleMsCheck });
              }
            }
          }
        }
      }
    } catch {
      // silencieux volontairement (évite spam logs)
    }
  }

  // start loop
  const timer = setInterval(tick, loopMs);
  timer.unref?.();

  // run immédiat optionnel (utile pour vérifier que ça tourne)
  if (opts.runOnStart === true) tick();

  return () => clearInterval(timer);
}

module.exports = {
  startAutomationRunner,
};
