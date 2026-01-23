// src/core/disposWeekRenderer.js
// Rend une semaine de dispos (7 messages max) avec boutons + images en attachments.
//
// Stratégie images:
// - Tu passes des attachments via la commande (/dispo images...)
// - Le renderer re-uploade ces fichiers sur CHAQUE message du jour (Discord ne permet pas "réutiliser" un upload sans re-jointe)
// - Si tu envoies 0 image => embed seul

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const { createWeek } = require("./disposWeekStore");

const DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function weekIdFromNow() {
  // identifiant stable, suffisant
  return `${Date.now()}`;
}

function buildButtonsRow(guildId, weekId, dayIndex) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispo:week:${guildId}:${weekId}:${dayIndex}:present`)
      .setLabel("Présent")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`dispo:week:${guildId}:${weekId}:${dayIndex}:absent`)
      .setLabel("Absent")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildDayEmbed({ weekLabel, dayIndex, guildName, attachmentsCount }) {
  const { EmbedBuilder } = require("discord.js");
  return new EmbedBuilder()
    .setTitle(`Disponibilités — ${DAY_LABELS[dayIndex]}`)
    .setDescription(
      [
        `Semaine : **${weekLabel}**`,
        guildName ? `Serveur : **${guildName}**` : null,
        "",
        "Clique sur un bouton pour indiquer ta disponibilité.",
        attachmentsCount > 0 ? `Images : **${attachmentsCount}** pièce(s) jointe(s).` : null,
      ].filter(Boolean).join("\n")
    )
    .addFields(
      { name: "✅ Présents", value: "**0**", inline: true },
      { name: "❌ Absents", value: "**0**", inline: true }
    )
    .setFooter({ text: "XIG — Dispos semaine" });
}

/**
 * attachments: Array<{ url, name }>
 * - fournis depuis les options attachments de la commande
 */
async function renderDisposWeek({ client, guild, channel, guildCfg, weekLabel, attachments }) {
  const guildId = guild.id;
  const weekId = weekIdFromNow();

  const safeAttachments = (attachments || [])
    .filter((a) => a && a.url)
    .map((a, idx) => ({
      attachment: a.url,
      name: a.name || `image_${idx + 1}.png`,
    }));

  const messageIds = [];

  // Ping optionnel (si configuré)
  const ping = (guildCfg.disposPingRoleIds || []).map((id) => `<@&${id}>`).join(" ");

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const embed = buildDayEmbed({
      weekLabel,
      dayIndex,
      guildName: guildCfg.guildName || guild.name,
      attachmentsCount: safeAttachments.length,
    });

    const row = buildButtonsRow(guildId, weekId, dayIndex);

    const content = dayIndex === 0 && ping ? ping : null;

    const msg = await channel.send({
      content,
      embeds: [embed],
      components: [row],
      files: safeAttachments.length ? safeAttachments : undefined,
    });

    messageIds.push(msg.id);
  }

  // persistance
  createWeek(guildId, weekId, {
    weekLabel,
    guildName: guildCfg.guildName || guild.name,
    channelId: channel.id,
    messageIds, // index 0..6
    attachmentsCount: safeAttachments.length,
  });

  return { weekId, messageIds };
}

module.exports = {
  renderDisposWeek,
};
