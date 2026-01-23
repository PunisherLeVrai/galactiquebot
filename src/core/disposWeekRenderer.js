// src/core/disposWeekRenderer.js
const { EmbedBuilder } = require("discord.js");

function countVotes(session, dayKey) {
  const v = session.votes?.[dayKey] || { present: [], absent: [] };
  return {
    present: v.present?.length || 0,
    absent: v.absent?.length || 0,
  };
}

function buildDayEmbed({ guildName, session, day, brandTitle }) {
  const { present, absent } = countVotes(session, day.key);

  const e = new EmbedBuilder()
    .setTitle(brandTitle || "Disponibilités")
    .setDescription(`**Jour : ${day.label}**\nClique sur un bouton pour indiquer ta dispo.`)
    .addFields(
      { name: "✅ Présents", value: `${present}`, inline: true },
      { name: "❌ Absents", value: `${absent}`, inline: true },
      { name: "Statut", value: session.closed ? "🔒 Fermé" : "🟢 Ouvert", inline: true }
    )
    .setFooter({ text: `${guildName} • Session ${session.sessionId}` });

  // Image si mode = image/both
  if ((day.mode === "image" || day.mode === "both") && day.imageUrl) {
    e.setImage(day.imageUrl);
  }

  return e;
}

function buildStaffReportEmbed({ guildName, session, day, playersNonRespondingMentions }) {
  const v = session.votes?.[day.key] || { present: [], absent: [] };

  const presentMentions = (v.present || []).map((id) => `<@${id}>`);
  const absentMentions = (v.absent || []).map((id) => `<@${id}>`);

  const chunk = (arr, max = 50) => {
    const out = [];
    for (let i = 0; i < arr.length; i += max) out.push(arr.slice(i, i + max));
    return out;
  };

  const e = new EmbedBuilder()
    .setTitle("Rapport — Disponibilités")
    .setDescription(`**Jour : ${day.label}**\nSession: \`${session.sessionId}\``)
    .addFields(
      {
        name: `✅ Présents (tout le monde) — ${presentMentions.length}`,
        value: presentMentions.length ? chunk(presentMentions, 40).map((c) => c.join(" ")).join("\n") : "—",
        inline: false,
      },
      {
        name: `❌ Absents (tout le monde) — ${absentMentions.length}`,
        value: absentMentions.length ? chunk(absentMentions, 40).map((c) => c.join(" ")).join("\n") : "—",
        inline: false,
      },
      {
        name: `⏳ Non répondants (rôle Joueur) — ${playersNonRespondingMentions.length}`,
        value: playersNonRespondingMentions.length
          ? chunk(playersNonRespondingMentions, 40).map((c) => c.join(" ")).join("\n")
          : "—",
        inline: false,
      }
    )
    .setFooter({ text: `${guildName}` });

  return e;
}

module.exports = {
  buildDayEmbed,
  buildStaffReportEmbed,
};
