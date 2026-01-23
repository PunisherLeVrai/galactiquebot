// src/core/disposWeekRenderer.js
const fs = require("fs");
const path = require("path");
const { EmbedBuilder, AttachmentBuilder } = require("discord.js");

function buildCounts(dayResponses) {
  const out = { present: 0, absent: 0 };
  for (const v of Object.values(dayResponses || {})) {
    if (v === "present") out.present++;
    else if (v === "absent") out.absent++;
  }
  return out;
}

function buildNoResponseCount(expectedUserIds, dayResponses) {
  if (!Array.isArray(expectedUserIds) || expectedUserIds.length === 0) return null;

  const responded = new Set(Object.keys(dayResponses || {}));
  let no = 0;
  for (const id of expectedUserIds) {
    if (!responded.has(id)) no++;
  }
  return no;
}

function buildDayEmbed(session, dayIndex, cfg) {
  const day = session.days[dayIndex];
  const c = buildCounts(day.responses);

  const embed = new EmbedBuilder()
    .setTitle(session.title || "DISPONIBILITÉS")
    .setDescription([`**${day.label}**`, session.note ? session.note : null].filter(Boolean).join("\n"))
    .addFields(
      { name: "✅ Présent", value: String(c.present), inline: true },
      { name: "❌ Absent", value: String(c.absent), inline: true },
      { name: "📊 Total réponses", value: String(c.present + c.absent), inline: true }
    )
    .setFooter({ text: `Semaine • ${day.label}` });

  // ✅ Sans réponse basé sur rôles scope (capturé à la création)
  const noResp = buildNoResponseCount(session.expectedUserIds, day.responses);
  if (noResp !== null) {
    embed.addFields({ name: "🕳️ Sans réponse", value: String(noResp), inline: true });
  }

  if (cfg?.colors?.primary != null) {
    const v = Number(cfg.colors.primary);
    if (!Number.isNaN(v)) embed.setColor(v);
  }

  return embed;
}

function buildPayload(embed, { imageUrl = null, localImagePath = null } = {}) {
  if (imageUrl) {
    embed.setImage(imageUrl);
    return { embeds: [embed] };
  }

  if (localImagePath) {
    const abs = path.isAbsolute(localImagePath) ? localImagePath : path.join(process.cwd(), localImagePath);
    if (fs.existsSync(abs)) {
      const fileName = path.basename(abs);
      const file = new AttachmentBuilder(abs, { name: fileName });
      embed.setImage(`attachment://${fileName}`);
      return { embeds: [embed], files: [file] };
    }
  }

  return { embeds: [embed] };
}

module.exports = {
  buildDayEmbed,
  buildPayload,
};
