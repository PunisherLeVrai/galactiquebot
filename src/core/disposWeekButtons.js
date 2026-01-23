// src/core/disposWeekButtons.js
// Gestion des clics sur boutons "Présent/Absent" et mise à jour des embeds.

const { EmbedBuilder } = require("discord.js");
const { canClickDispos } = require("./guildConfig");
const { getWeek, setVote, getCounts } = require("./disposWeekStore");

const FLAGS_EPHEMERAL = 64;

const DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function buildDayEmbed({ guildName, weekLabel, dayIndex, counts, imagesNote }) {
  return new EmbedBuilder()
    .setTitle(`Disponibilités — ${DAY_LABELS[dayIndex]}`)
    .setDescription(
      [
        `Semaine : **${weekLabel}**`,
        guildName ? `Serveur : **${guildName}**` : null,
        "",
        "Clique sur un bouton pour indiquer ta dispo.",
        imagesNote ? imagesNote : null,
      ].filter(Boolean).join("\n")
    )
    .addFields(
      { name: "✅ Présents", value: `**${counts.present}**`, inline: true },
      { name: "❌ Absents", value: `**${counts.absent}**`, inline: true }
    )
    .setFooter({ text: "XIG — Dispos semaine" });
}

/**
 * CustomId format (simple & stable):
 * dispo:week:<guildId>:<weekId>:<dayIndex>:<present|absent>
 */
function parseCustomId(customId) {
  const parts = String(customId).split(":");
  if (parts.length !== 6) return null;
  if (parts[0] !== "dispo" || parts[1] !== "week") return null;

  const guildId = parts[2];
  const weekId = parts[3];
  const dayIndex = Number(parts[4]);
  const action = parts[5];

  if (!guildId || !weekId) return null;
  if (![0, 1, 2, 3, 4, 5, 6].includes(dayIndex)) return null;
  if (!["present", "absent"].includes(action)) return null;

  return { guildId, weekId, dayIndex, action };
}

async function handleDispoButton(interaction, guildCfg) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  // Contrôle serveur
  if (!interaction.inGuild() || interaction.guildId !== parsed.guildId) {
    await interaction.reply({ content: "Interaction invalide.", flags: FLAGS_EPHEMERAL });
    return true;
  }

  // Autorisation clic (si tu as mis des rôles spécifiques)
  const member = interaction.member;
  if (!canClickDispos(member, guildCfg)) {
    await interaction.reply({
      content: "Tu n’as pas l’autorisation de répondre aux dispos sur ce serveur.",
      flags: FLAGS_EPHEMERAL,
    });
    return true;
  }

  // Charger la semaine
  const week = getWeek(parsed.guildId, parsed.weekId);
  if (!week) {
    await interaction.reply({
      content: "Cette semaine de disponibilités n’existe plus ou a été supprimée.",
      flags: FLAGS_EPHEMERAL,
    });
    return true;
  }

  // Enregistrer le vote
  setVote(parsed.guildId, parsed.weekId, parsed.dayIndex, interaction.user.id, parsed.action);

  // Mettre à jour l'embed du message du jour (compteurs)
  try {
    const refreshedWeek = getWeek(parsed.guildId, parsed.weekId);
    const counts = getCounts(refreshedWeek, parsed.dayIndex);

    const imagesNote =
      (refreshedWeek.attachmentsCount || 0) > 0
        ? `Images : **${refreshedWeek.attachmentsCount}** pièce(s) jointe(s).`
        : null;

    const newEmbed = buildDayEmbed({
      guildName: refreshedWeek.guildName,
      weekLabel: refreshedWeek.weekLabel,
      dayIndex: parsed.dayIndex,
      counts,
      imagesNote,
    });

    await interaction.update({ embeds: [newEmbed] });
  } catch {
    // Si update échoue (message supprimé, permissions, etc.)
    await interaction.reply({
      content: "Vote enregistré, mais impossible de mettre à jour l’affichage.",
      flags: FLAGS_EPHEMERAL,
    });
  }

  return true;
}

module.exports = {
  handleDispoButton,
};
