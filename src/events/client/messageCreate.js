// src/events/client/messageCreate.js
// Scan pseudos dans un salon dédié: PSN OU XBOX OU EA
// CommonJS — nécessite Intent MessageContent

const { getGuildConfig } = require("../../core/guildConfig");
const { setUserPseudo } = require("../../core/pseudoStore");
const { warn } = require("../../core/logger");

// Parse strict : "PSN: xxx" / "XBOX: xxx" / "EA: xxx"
function parsePseudo(content) {
  const text = String(content || "").trim();

  let m = text.match(/^(psn)\s*[:\-]\s*(.+)$/i);
  if (m) return { platform: "psn", value: m[2] };

  m = text.match(/^(xbox|xbl)\s*[:\-]\s*(.+)$/i);
  if (m) return { platform: "xbox", value: m[2] };

  m = text.match(/^(ea|ea\s*id)\s*[:\-]\s*(.+)$/i);
  if (m) return { platform: "ea", value: m[2] };

  return null;
}

module.exports = {
  name: "messageCreate",
  once: false,
  async execute(message) {
    try {
      if (!message.guild) return;
      if (message.author.bot) return;

      const cfg = getGuildConfig(message.guild.id) || {};
      const pseudoCfg = cfg.pseudo || {};

      const scanChannelId = pseudoCfg.scanChannelId || null;
      if (!scanChannelId) return;

      // Scan uniquement dans le salon prévu
      if (message.channel.id !== scanChannelId) return;

      const parsed = parsePseudo(message.content);
      if (!parsed) return;

      const saved = setUserPseudo(
        message.guild.id,
        message.author.id,
        parsed.platform,
        parsed.value
      );

      if (!saved) return;

      // Confirmation simple sans ping
      await message.react("✅").catch(() => {});

      // Optionnel: supprimer pour ne pas exposer l'ID (désactivé par défaut)
      if (pseudoCfg.deleteMessages === true) {
        await message.delete().catch(() => {});
      }
    } catch (e) {
      warn("pseudo scan messageCreate error:", e);
    }
  },
};
