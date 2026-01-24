// src/core/disposWeekButtons.js
// Boutons 100% emojis – mobile friendly (2 par ligne)

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

/**
 * customId:
 * - vote:  dispo:vote:<present|absent>:<sessionId>:<dayKey>
 * - staff: dispo:staff:<remind|report|close|auto>:<sessionId>:<dayKey>
 */
function buildRows({ sessionId, dayKey, closed, automationsEnabled }) {
  const isClosed = !!closed;

  // Row 1 (public) – Présent / Absent
  const rowPublic = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispo:vote:present:${sessionId}:${dayKey}`)
      .setLabel("✅")               // PRESENT (emoji only)
      .setStyle(ButtonStyle.Success)
      .setDisabled(isClosed),

    new ButtonBuilder()
      .setCustomId(`dispo:vote:absent:${sessionId}:${dayKey}`)
      .setLabel("❌")               // ABSENT (emoji only)
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isClosed)
  );

  // Row 2 (staff) – Rappel / Rapport
  const rowStaff1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispo:staff:remind:${sessionId}:${dayKey}`)
      .setLabel("🔔")              // RAPPEL
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`dispo:staff:report:${sessionId}:${dayKey}`)
      .setLabel("📊")              // RAPPORT
      .setStyle(ButtonStyle.Primary)
  );

  // Row 3 (staff) – Fermer / Auto ON-OFF
  const rowStaff2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispo:staff:close:${sessionId}:${dayKey}`)
      .setLabel("🔒")               // FERMER
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isClosed),

    new ButtonBuilder()
      .setCustomId(`dispo:staff:auto:${sessionId}:${dayKey}`)
      .setLabel(automationsEnabled ? "⚙️" : "🛑")   // AUTO ON = ⚙️ / OFF = 🛑
      .setStyle(automationsEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  return [rowPublic, rowStaff1, rowStaff2];
}

module.exports = { buildRows };
