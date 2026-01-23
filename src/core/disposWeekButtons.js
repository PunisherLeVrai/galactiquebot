// src/core/disposWeekButtons.js
// Construction des boutons Dispos (public + staff)
// CommonJS — discord.js v14

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

/**
 * CustomId format (compact, stable):
 * - Votes:  dispo:vote:<present|absent>:<sessionId>:<dayKey>
 * - Staff:  dispo:staff:<remind|report|close|auto>:<sessionId>:<dayKey>
 *
 * Note: sessionId/dayKey doivent rester courts pour respecter la limite 100 chars.
 */

function buildRows({ sessionId, dayKey, closed, automationsEnabled }) {
  const isClosed = !!closed;

  // Row public (présent/absent)
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

  // Row staff (rappel/rapport/fermer/auto)
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
      .setLabel(automationsEnabled ? "Automations: ON" : "Automations: OFF")
      .setStyle(automationsEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  return [rowPublic, rowStaff];
}

module.exports = {
  buildRows,
};
