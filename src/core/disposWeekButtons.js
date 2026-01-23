// src/core/disposWeekButtons.js
// Boutons + handler : tout le monde peut cliquer et est compté (CommonJS)

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getSession, updateSession } = require("./disposWeekStore");
const { buildDayEmbed, buildPayload } = require("./disposWeekRenderer");
const { getGuildConfig } = require("./configManager");
const { normalizeConfig } = require("./guildConfig");

const FLAGS_EPHEMERAL = 64;

function buttonsRow(rootId, dayIndex, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispoW:present:${rootId}:${dayIndex}`)
      .setLabel("Présent")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`dispoW:absent:${rootId}:${dayIndex}`)
      .setLabel("Absent")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function parseId(customId) {
  // dispoW:<status>:<rootId>:<dayIndex>
  const p = String(customId || "").split(":");
  if (p.length !== 4) return null;
  if (p[0] !== "dispoW") return null;

  const status = p[1];
  const rootId = p[2];
  const dayIndex = Number(p[3]);

  if (!["present", "absent"].includes(status)) return null;
  if (!rootId) return null;
  if (Number.isNaN(dayIndex) || dayIndex < 0 || dayIndex > 6) return null;

  return { status, rootId, dayIndex };
}

async function handleDisposWeekButton(interaction) {
  if (!interaction.inGuild()) return false;
  if (!interaction.isButton()) return false;

  const parsed = parseId(interaction.customId);
  if (!parsed) return false;

  const guildId = interaction.guildId;
  const cfg = normalizeConfig(getGuildConfig(guildId) || {});

  // Optionnel (recommandé) : forcer l’usage dans le salon dispos configuré si défini.
  // Si tu veux autoriser partout, supprime ce bloc.
  if (cfg.channels?.dispos && interaction.channelId !== cfg.channels.dispos) {
    await interaction.reply({
      content: `Utilise ces boutons dans <#${cfg.channels.dispos}>.`,
      flags: FLAGS_EPHEMERAL,
    });
    return true;
  }

  const session = getSession(guildId, parsed.rootId);
  if (!session) {
    await interaction.reply({ content: "Session introuvable.", flags: FLAGS_EPHEMERAL });
    return true;
  }

  const day = session.days?.[parsed.dayIndex];
  if (!day) {
    await interaction.reply({ content: "Jour introuvable.", flags: FLAGS_EPHEMERAL });
    return true;
  }

  // ✅ Tout le monde est compté : on enregistre directement l’utilisateur
  const responses = { ...(day.responses || {}) };
  responses[interaction.user.id] = parsed.status;

  // Sauvegarde
  session.days[parsed.dayIndex].responses = responses;
  const saved = updateSession(guildId, parsed.rootId, { days: session.days });

  // Re-render message du jour
  const embed = buildDayEmbed(saved, parsed.dayIndex, cfg);
  const imageUrl = saved.days[parsed.dayIndex].imageUrl || null;

  // Important : on "update" l’interaction pour éviter "interaction failed"
  await interaction.update({
    ...buildPayload(embed, { imageUrl }),
    components: [buttonsRow(parsed.rootId, parsed.dayIndex, false)],
  });

  return true;
}

module.exports = {
  buttonsRow,
  handleDisposWeekButton,
};
