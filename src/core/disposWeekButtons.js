// src/core/disposWeekButtons.js
// Construction des boutons Dispo — CommonJS

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

/**
 * customId:
 * - vote:  dispo:vote:<present|absent>:<sessionId>:<dayKey>
 * - staff: dispo:staff:<remind|report|close|auto>:<sessionId>:<dayKey>
 */
function buildRows({ sessionId, dayKey, closed, automationsEnabled }) {
  const isClosed = !!closed;

  const rowPublic = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispo:vote:present:${sessionId}:${dayKey}`)
      .setLabel("Présent")
      .setStyle(ButtonStyle.Success)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId(`dispo:vote:absent:${sessionId}:${dayKey}`)
      .setLabel("Absent")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isClosed)
  );

  const rowStaff = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispo:staff:remind:${sessionId}:${dayKey}`)
      .setLabel("Rappel")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`dispo:staff:report:${sessionId}:${dayKey}`)
      .setLabel("Rapport")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`dispo:staff:close:${sessionId}:${dayKey}`)
      .setLabel("Fermer")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId(`dispo:staff:auto:${sessionId}:${dayKey}`)
      .setLabel(automationsEnabled ? "Auto: ON" : "Auto: OFF")
      .setStyle(automationsEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  return [rowPublic, rowStaff];
}

module.exports = { buildRows };
