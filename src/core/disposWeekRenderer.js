// src/core/disposWeekRenderer.js
// Rendu embeds Dispo (jour) + Rapport staff — CommonJS

const { EmbedBuilder } = require("discord.js");
const { getCounts } = require("./disposWeekStore");

function chunk(arr, size = 35) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildDayEmbed({ guildName, session, day }) {
  const counts = getCounts(session, day.key);

  const e = new EmbedBuilder()
    .setTitle("Disponibilités")
    .setDescription(
      [
        `**Jour : ${day.label}**`,
        session?.meta?.note ? `\n${session.meta.note}` : "",
        "",
        "Clique sur un bouton pour indiquer ta disponibilité.",
      ].join("\n")
    )
    .addFields(
      { name: "✅ Présents", value: `${counts.present}`, inline: true },
      { name: "❌ Absents", value: `${counts.absent}`, inline: true },
      { name: "Statut", value: session.closed ? "🔒 Fermé" : "🟢 Ouvert", inline: true }
    )
    .setFooter({ text: `${guildName} • Session ${session.sessionId}` });

  if ((day.mode === "image" || day.mode === "both") && day.imageUrl) {
    e.setImage(day.imageUrl);
  }

  return e;
}

function buildStaffReportEmbed({
  guildName,
  session,
  day,
  presentIds,
  absentIds,
  nonRespondingPlayerIds,
}) {
  const presentMentions = (presentIds || []).map((id) => `<@${id}>`);
  const absentMentions = (absentIds || []).map((id) => `<@${id}>`);
  const nonMentions = (nonRespondingPlayerIds || []).map((id) => `<@${id}>`);

  const presentBlocks = presentMentions.length
    ? chunk(presentMentions).map((c) => c.join(" ")).join("\n")
    : "—";
  const absentBlocks = absentMentions.length
    ? chunk(absentMentions).map((c) => c.join(" ")).join("\n")
    : "—";
  const nonBlocks = nonMentions.length
    ? chunk(nonMentions).map((c) => c.join(" ")).join("\n")
    : "—";

  return new EmbedBuilder()
    .setTitle("Rapport — Disponibilités")
    .setDescription([`**Jour : ${day.label}**`, `Session : \`${session.sessionId}\``].join("\n"))
    .addFields(
      { name: `✅ Présents (tout le monde) — ${presentMentions.length}`, value: presentBlocks, inline: false },
      { name: `❌ Absents (tout le monde) — ${absentMentions.length}`, value: absentBlocks, inline: false },
      { name: `⏳ Non répondants (rôle Joueur) — ${nonMentions.length}`, value: nonBlocks, inline: false }
    )
    .setFooter({ text: guildName });
}

module.exports = {
  buildDayEmbed,
  buildStaffReportEmbed,
};
