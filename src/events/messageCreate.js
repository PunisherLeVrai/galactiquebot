// src/events/messageCreate.js
// Scan salon pseudos (pseudoScanChannelId) — CommonJS

const { getGuildConfig } = require("../core/guildConfig");
const { setUserPseudos } = require("../core/pseudoStore");

function parseScanMessage(content) {
  const raw = String(content || "").trim();
  if (!raw) return null;

  const m = raw.match(/^(psn|xbox|ea)\s*[:=]\s*(.+)$/i);
  if (m) {
    const platform = m[1].toLowerCase();
    const value = m[2].trim();
    if (!value) return null;
    return { platform, value };
  }

  // fallback: si juste une valeur, on la met en PSN par défaut
  return { platform: "psn", value: raw };
}

module.exports = {
  name: "messageCreate",
  once: false,

  async execute(message) {
    try {
      if (!message.guild) return;
      if (message.author?.bot) return;

      const cfg = getGuildConfig(message.guild.id);
      const scanId = cfg?.pseudoScanChannelId;
      if (!scanId) return;

      if (message.channel.id !== scanId) return;

      const parsed = parseScanMessage(message.content);
      if (!parsed) return;

      const patch = {};
      patch[parsed.platform] = parsed.value;
      setUserPseudos(message.guild.id, message.author.id, patch);

      // Option: on ne répond pas pour rester "clean"
      // Si tu veux un accusé minimal:
      // await message.react("✅").catch(() => {});
      await message.react("✅").catch(() => {});
    } catch {
      // silence
    }
  },
};
