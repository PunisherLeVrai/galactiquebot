// src/core/disposWeekRenderer.js
// Rendu des embeds Dispos (jour) + Rapport (staff)
// CommonJS — discord.js v14

const { EmbedBuilder } = require("discord.js");
const { getCounts } = require("./disposWeekStore");

function safeIntColor(value, fallback = null) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function chunk(arr, size = 40) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Embed d'un jour de dispo
 */
function buildDayEmbed({ guildName, session, day, brandTitle, brandColor }) {
  const counts = getCounts(session, day.key);

  const e = new EmbedBuilder()
    .setTitle(brandTitle || "Disponibilités")
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

  const color = safeIntColor(brandColor, null);
  if (color !== null) e.setColor(color);

  // Mode image / both -> image
  if ((day.mode === "image" || day.mode === "both") && day.imageUrl) {
    e.setImage(day.imageUrl);
  }

  // Mode "image only" : on peut rendre l'embed plus léger (optionnel)
  // Ici on garde les compteurs, car tu veux voir présent/absent.
  return e;
}

/**
 * Embed de rapport staff : tout le monde présent/absent + non répondants joueurs
 * inputs:
 * - presentIds/absentIds : arrays userId
 * - nonRespondingPlayerIds : arrays userId (rôle joueur uniquement)
 */
function buildStaffReportEmbed({
  guildName,
  session,
  day,
  presentIds,
  absentIds,
  nonRespondingPlayerIds,
  brandColor,
}) {
  const presentMentions = (presentIds || []).map((id) => `<@${id}>`);
  const absentMentions = (absentIds || []).map((id) => `<@${id}>`);
  const nonMentions = (nonRespondingPlayerIds || []).map((id) => `<@${id}>`);

  const presentBlocks = presentMentions.length ? chunk(presentMentions, 35).map((c) => c.join(" ")).join("\n") : "—";
  const absentBlocks = absentMentions.length ? chunk(absentMentions, 35).map((c) => c.join(" ")).join("\n") : "—";
  const nonBlocks = nonMentions.length ? chunk(nonMentions, 35).map((c) => c.join(" ")).join("\n") : "—";

  const e = new EmbedBuilder()
    .setTitle("Rapport — Disponibilités")
    .setDescription(
      [
        `**Jour : ${day.label}**`,
        `Session : \`${session.sessionId}\``,
      ].join("\n")
    )
    .addFields(
      {
        name: `✅ Présents (tout le monde) — ${presentMentions.length}`,
        value: presentBlocks,
        inline: false,
      },
      {
        name: `❌ Absents (tout le monde) — ${absentMentions.length}`,
        value: absentBlocks,
        inline: false,
      },
      {
        name: `⏳ Non répondants (rôle Joueur) — ${nonMentions.length}`,
        value: nonBlocks,
        inline: false,
      }
    )
    .setFooter({ text: `${guildName}` });

  const color = safeIntColor(brandColor, null);
  if (color !== null) e.setColor(color);

  return e;
}

module.exports = {
  buildDayEmbed,
  buildStaffReportEmbed,
};
