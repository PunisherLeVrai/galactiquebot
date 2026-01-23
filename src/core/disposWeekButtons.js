// src/core/disposWeekButtons.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

function buildRows({ sessionId, dayKey, closed, automationsEnabled }) {
  const rowPublic = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispo:vote:present:${sessionId}:${dayKey}`)
      .setLabel("Présent")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!!closed),
    new ButtonBuilder()
      .setCustomId(`dispo:vote:absent:${sessionId}:${dayKey}`)
      .setLabel("Absent")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!!closed)
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
      .setDisabled(!!closed),
    new ButtonBuilder()
      .setCustomId(`dispo:staff:auto:${sessionId}:${dayKey}`)
      .setLabel(automationsEnabled ? "Automations: ON" : "Automations: OFF")
      .setStyle(automationsEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  return [rowPublic, rowStaff];
}

module.exports = { buildRows };
