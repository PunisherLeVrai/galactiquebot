// src/core/disposButtons.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getSession, upsertSession } = require("./disposStore");
const { getGuildConfig } = require("./configManager");
const { normalizeConfig } = require("./guildConfig");

const FLAGS_EPHEMERAL = 64;

const STATUS = {
  PRESENT: "present",
  ABSENT: "absent",
  LATE: "late",
  MAYBE: "maybe",
};

function buildButtons(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("dispo:present")
      .setLabel("Présent")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("dispo:absent")
      .setLabel("Absent")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("dispo:late")
      .setLabel("Retard")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("dispo:maybe")
      .setLabel("Incertain")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

function countsFrom(session) {
  const map = session.responses || {};
  const vals = Object.values(map);
  const c = { present: 0, absent: 0, late: 0, maybe: 0 };
  for (const v of vals) {
    if (v === STATUS.PRESENT) c.present++;
    else if (v === STATUS.ABSENT) c.absent++;
    else if (v === STATUS.LATE) c.late++;
    else if (v === STATUS.MAYBE) c.maybe++;
  }
  return c;
}

function buildEmbed(session, cfgNorm) {
  const c = countsFrom(session);

  const embed = new EmbedBuilder()
    .setTitle(session.title || "DISPOS")
    .setDescription(session.note ? session.note : "Clique sur un bouton pour indiquer ta disponibilité.")
    .addFields(
      { name: "✅ Présent", value: String(c.present), inline: true },
      { name: "❌ Absent", value: String(c.absent), inline: true },
      { name: "⏳ Retard", value: String(c.late), inline: true },
      { name: "❔ Incertain", value: String(c.maybe), inline: true }
    )
    .setFooter({ text: `Session: ${session.closed ? "fermée" : "ouverte"} • MAJ: ${new Date().toISOString()}` });

  const color = cfgNorm?.colors?.primary;
  if (color) {
    const colorInt = Number(color);
    if (!Number.isNaN(colorInt)) embed.setColor(colorInt);
  }

  return embed;
}

function isDispoCustomId(customId) {
  return typeof customId === "string" && customId.startsWith("dispo:");
}

function customIdToStatus(customId) {
  if (customId === "dispo:present") return STATUS.PRESENT;
  if (customId === "dispo:absent") return STATUS.ABSENT;
  if (customId === "dispo:late") return STATUS.LATE;
  if (customId === "dispo:maybe") return STATUS.MAYBE;
  return null;
}

/**
 * Handle button interaction for dispo sessions.
 * Requires the message to be in the configured dispos channel (if configured).
 */
async function handleDispoButton(interaction) {
  if (!interaction.inGuild()) return false;
  if (!interaction.isButton()) return false;
  if (!isDispoCustomId(interaction.customId)) return false;

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const messageId = interaction.message.id;

  // Check channel matches configured dispos channel (if configured)
  const cfg = normalizeConfig(getGuildConfig(guildId) || {});
  const disposChannelId = cfg.channels?.dispos;
  if (disposChannelId && interaction.channelId !== disposChannelId) {
    await interaction.reply({
      content: `Ce bouton doit être utilisé dans <#${disposChannelId}>.`,
      flags: FLAGS_EPHEMERAL,
    });
    return true;
  }

  const session = getSession(guildId, messageId);
  if (!session) {
    await interaction.reply({
      content: "Session dispos introuvable (elle a peut-être été supprimée).",
      flags: FLAGS_EPHEMERAL,
    });
    return true;
  }

  if (session.closed) {
    await interaction.reply({ content: "Cette session est fermée.", flags: FLAGS_EPHEMERAL });
    return true;
  }

  const status = customIdToStatus(interaction.customId);
  if (!status) {
    await interaction.reply({ content: "Action inconnue.", flags: FLAGS_EPHEMERAL });
    return true;
  }

  const responses = session.responses || {};
  responses[userId] = status;

  const updated = upsertSession(guildId, messageId, {
    responses,
    updatedAt: new Date().toISOString(),
  });

  // Update the message embed
  await interaction.update({
    embeds: [buildEmbed(updated, cfg)],
    components: [buildButtons(false)],
  });

  return true;
}

module.exports = {
  buildButtons,
  buildEmbed,
  handleDispoButton,
};
