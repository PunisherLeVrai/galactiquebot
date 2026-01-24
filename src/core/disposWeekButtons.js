// src/core/disposWeekButtons.js
// Boutons 100% emojis – mobile friendly (2 par ligne)

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

function buildRows({ sessionId, dayKey, closed, automationsEnabled }) {
  const isClosed = !!closed;

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

  const rowStaff2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispo:staff:close:${sessionId}:${dayKey}`)
      .setLabel("🔒")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId(`dispo:staff:auto:${sessionId}:${dayKey}`)
      .setLabel(automationsEnabled ? "⚙️" : "🛑")
      .setStyle(automationsEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  return [rowPublic, rowStaff1, rowStaff2];
}

module.exports = { buildRows };
