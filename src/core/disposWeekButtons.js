// src/core/disposWeekButtons.js
// Boutons 100% emojis – mobile friendly (2 par ligne)
// + ♻️ reopen (staff only)

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

/**
 * customId:
 * - vote:  dispo:vote:<present|absent>:<sessionId>:<dayKey>
 * - staff: dispo:staff:<remind|report|close|reopen|auto>:<sessionId>:<dayKey>
 */
function buildRows({ sessionId, dayKey, closed, automationsEnabled }) {
  const isClosed = !!closed;

  // Row 1 (public) – ✅ / ❌
  const rowPublic = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispo:vote:present:${sessionId}:${dayKey}`)
      .setLabel("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(isClosed),

    new ButtonBuilder()
      .setCustomId(`dispo:vote:absent:${sessionId}:${dayKey}`)
      .setLabel("❌")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isClosed)
  );

  // Row 2 (staff) – 🔔 / 📊
  const rowStaff1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispo:staff:remind:${sessionId}:${dayKey}`)
      .setLabel("🔔")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`dispo:staff:report:${sessionId}:${dayKey}`)
      .setLabel("📊")
      .setStyle(ButtonStyle.Primary)
  );

  // Row 3 (staff) – 🔒 / ♻️
  // 🔒 désactivé si déjà fermé (optionnel)
  // ♻️ toujours actif (permet de rouvrir + reset votes)
  const rowStaff2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispo:staff:close:${sessionId}:${dayKey}`)
      .setLabel("🔒")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isClosed),

    new ButtonBuilder()
      .setCustomId(`dispo:staff:reopen:${sessionId}:${dayKey}`)
      .setLabel("♻️")
      .setStyle(ButtonStyle.Success)
  );

  // Row 4 (staff) – ⚙️/🛑 (auto)
  const rowStaff3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispo:staff:auto:${sessionId}:${dayKey}`)
      .setLabel(automationsEnabled ? "⚙️" : "🛑")
      .setStyle(automationsEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  return [rowPublic, rowStaff1, rowStaff2, rowStaff3];
}

module.exports = { buildRows };
