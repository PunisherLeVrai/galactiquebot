const { EmbedBuilder, AttachmentBuilder } = require("discord.js");

function buildCounts(dayResponses) {
  const out = { present: 0, absent: 0 };
  for (const v of Object.values(dayResponses || {})) {
    if (v === "present") out.present++;
    else if (v === "absent") out.absent++;
  }
  return out;
}

function buildDayEmbed(session, dayIndex, cfg) {
  const day = session.days[dayIndex];
  const c = buildCounts(day.responses);

  const embed = new EmbedBuilder()
    .setTitle(session.title || "DISPONIBILITÉS")
    .setDescription(`**${day.label}**\n${session.note || ""}`.trim())
    .addFields(
      { name: "✅ Présent", value: String(c.present), inline: true },
      { name: "❌ Absent", value: String(c.absent), inline: true },
      { name: "📊 Total", value: String(c.present + c.absent), inline: true }
    )
    .setFooter({ text: `Semaine • ${day.label}` });

  if (cfg?.colors?.primary) {
    const v = Number(cfg.colors.primary);
    if (!Number.isNaN(v)) embed.setColor(v);
  }

  return embed;
}

function buildPayloadWithOptionalImage(embed, imageUrl, fileNameForAttachment) {
  // imageUrl = URL Discord déjà hébergée (issue d’une pièce jointe envoyée sur un message)
  // On peut directement faire setImage(url)
  if (imageUrl) embed.setImage(imageUrl);
  return { embeds: [embed] };
}

module.exports = { buildDayEmbed, buildPayloadWithOptionalImage };
