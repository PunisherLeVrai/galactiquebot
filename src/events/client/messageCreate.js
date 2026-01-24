// src/events/client/messageCreate.js
// Scan pseudos dans un salon dédié: PSN / XBOX / EA
// ✅ Salon configuré via setup: cfg.pseudo.scanChannelId
// ✅ Priorité: PSN > XBOX > EA (en pratique: on enregistre ce que la personne envoie)
// ✅ Parse strict + clean + limite longueur
// ✅ Confirmation (✅) sans mention
// ✅ Option deleteMessages
// ✅ Anti-spam (cooldown par user)
// CommonJS — nécessite Intent MessageContent

const { getOrCreateGuildConfig } = require("../../core/guildConfig");
const { setUserPseudo } = require("../../core/pseudoStore");
const { warn } = require("../../core/logger");

const COOLDOWN_MS = 10_000; // 10s par user dans le salon scan
const lastByUser = new Map(); // key: guildId:userId -> epoch

function now() {
  return Date.now();
}

function cleanValue(v) {
  return String(v || "")
    .replace(/[`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

// Parse strict : "PSN: xxx" / "XBOX: xxx" / "EA: xxx"
function parsePseudo(content) {
  const text = String(content || "").trim();

  // PSN
  let m = text.match(/^(psn|playstation)\s*[:=\-]\s*(.+)$/i);
  if (m) return { platform: "psn", value: cleanValue(m[2]) };

  // XBOX
  m = text.match(/^(xbox|xbl)\s*[:=\-]\s*(.+)$/i);
  if (m) return { platform: "xbox", value: cleanValue(m[2]) };

  // EA
  m = text.match(/^(ea|ea\s*id)\s*[:=\-]\s*(.+)$/i);
  if (m) return { platform: "ea", value: cleanValue(m[2]) };

  return null;
}

module.exports = {
  name: "messageCreate",
  once: false,

  async execute(message) {
    try {
      if (!message.guild) return;
      if (!message.author || message.author.bot) return;

      const guildId = message.guild.id;

      // ✅ safe + auto-create defaults
      const cfg = getOrCreateGuildConfig(guildId);
      const pseudoCfg = cfg.pseudo || {};

      const scanChannelId = pseudoCfg.scanChannelId || null;
      if (!scanChannelId) return;

      // Scan uniquement dans le salon prévu
      if (message.channel.id !== scanChannelId) return;

      // Anti-spam simple
      const k = `${guildId}:${message.author.id}`;
      const last = lastByUser.get(k) || 0;
      if (now() - last < COOLDOWN_MS) return;
      lastByUser.set(k, now());

      const parsed = parsePseudo(message.content);
      if (!parsed || !parsed.value) return;

      const saved = setUserPseudo(guildId, message.author.id, parsed.platform, parsed.value);
      if (!saved) return;

      // Confirmation simple sans ping
      await message.react("✅").catch(() => {});

      // Optionnel: supprimer les messages (désactivé par défaut)
      if (pseudoCfg.deleteMessages === true) {
        await message.delete().catch(() => {});
      }
    } catch (e) {
      warn("pseudo scan messageCreate error:", e);
    }
  },
};
