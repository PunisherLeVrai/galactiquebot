// src/core/disposWeekRenderer.js
// Rendu des dispos semaine : embed + image optionnelle (URL ou fichier local)

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

/**
 * Embed d'un jour (Lundi..Dimanche)
 */
function buildDayEmbed(session, dayIndex, cfg) {
  const day = session.days[dayIndex];
  const c = buildCounts(day.responses);

  const embed = new EmbedBuilder()
    .setTitle(session.title || "DISPONIBILITÉS")
    .setDescription(
      [
        `**${day.label}**`,
        session.note ? session.note : null,
      ].filter(Boolean).join("\n")
    )
    .addFields(
      { name: "✅ Présent", value: String(c.present), inline: true },
      { name: "❌ Absent", value: String(c.absent), inline: true },
      { name: "📊 Total", value: String(c.present + c.absent), inline: true }
    )
    .setFooter({ text: `Semaine • ${day.label}` });

  // Couleur si présente (facultatif)
  if (cfg?.colors?.primary != null) {
    const v = Number(cfg.colors.primary);
    if (!Number.isNaN(v)) embed.setColor(v);
  }

  return embed;
}

/**
 * Construit payload message avec:
 * - embed seul
 * - embed + image URL (upload tel/PC) => setImage(url)
 * - embed + fichier local => attachment + setImage(attachment://...)
 *
 * imageUrl: string (https://cdn.discordapp.com/....)
 * localImagePath: string (chemin local existant)
 */
function buildPayload(embed, { imageUrl = null, localImagePath = null } = {}) {
  // Cas 1: image URL (upload tel/PC)
  if (imageUrl) {
    embed.setImage(imageUrl);
    return { embeds: [embed] };
  }

  // Cas 2: fichier local (optionnel)
  if (localImagePath) {
    const abs = path.isAbsolute(localImagePath)
      ? localImagePath
      : path.join(process.cwd(), localImagePath);

    if (fs.existsSync(abs)) {
      const fileName = path.basename(abs);
      const file = new AttachmentBuilder(abs, { name: fileName });
      embed.setImage(`attachment://${fileName}`);
      return { embeds: [embed], files: [file] };
    }
  }

  // Cas 3: pas d'image
  return { embeds: [embed] };
}

module.exports = {
  buildDayEmbed,
  buildPayload,
};
