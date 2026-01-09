// commands/planning.js ✅ CHECKLIST (heures fixes + compétitions)
// - /planning show [jour]            -> affiche un jour OU toute la semaine
// - /planning edit [jour] [salon]    -> ouvre un panneau à cocher (jour OU semaine si jour absent)
// - /planning clear [jour]           -> vide un jour (ou toute la semaine si jour absent)
// - /planning post [salon] [jour]    -> poste un jour OU la semaine

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const { getConfigFromInteraction, updateGuildConfig } = require('../utils/config');

const JOURS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];

const FIXED_TIMES = [
  '21:00','21:20','21:40',
  '22:00','22:20','22:40',
  '23:00'
];

const COMPETITIONS = [
  'VPG BELGIQUE',
  'VPG SUISSE',
  'VSC'
];

function normalizeJour(j) {
  const x = String(j || '').trim().toLowerCase();
  return JOURS.includes(x) ? x : null;
}

function dayLabelFR(jour) {
  const map = {
    lundi: 'LUNDI',
    mardi: 'MARDI',
    mercredi: 'MERCREDI',
    jeudi: 'JEUDI',
    vendredi: 'VENDREDI',
    samedi: 'SAMEDI',
    dimanche: 'DIMANCHE'
  };
  return map[jour] || String(jour || '').toUpperCase();
}

function lineSep(width = 28) { return '━'.repeat(width); }

function centerText(txt, width = 28) {
  const t = String(txt || '').trim();
  if (t.length >= width) return t;
  const left = Math.floor((width - t.length) / 2);
  const right = width - t.length - left;
  return ' '.repeat(left) + t + ' '.repeat(right);
}

function getSavedPlanning(guildConfig) {
  const p = guildConfig?.planning;
  return (p && typeof p === 'object') ? p : {}; // ✅ vide par défaut
}

function normalizeDayData(dayData) {
  // dayData: { times:[], competitions:[], salonId }
  const times = Array.isArray(dayData?.times) ? dayData.times.filter(t => FIXED_TIMES.includes(t)) : [];
  const competitions = Array.isArray(dayData?.competitions) ? dayData.competitions.filter(c => COMPETITIONS.includes(c)) : [];
  const salonId = dayData?.salonId ? String(dayData.salonId) : null;
  return { times, competitions, salonId };
}

function buildEmptyDay(salonId = null) {
  return { times: [], competitions: [], salonId: salonId || null };
}

function setAllDays(nextPlanning, valueForAllDays) {
  const out = { ...(nextPlanning || {}) };
  for (const j of JOURS) out[j] = valueForAllDays;
  return out;
}

function renderChecklistBlock(title, items, selectedSet) {
  const width = 28;
  const header = [
    lineSep(width),
    centerText(title, width),
    lineSep(width)
  ];

  const body = items.map(x => `${selectedSet.has(x) ? '✅' : '⬜'} ${x}`);
  return ['```', ...header, ...body, '```'].join('\n');
}

function renderDay(jour, dayData) {
  const d = normalizeDayData(dayData);
  const timesSet = new Set(d.times);
  const compSet = new Set(d.competitions);

  const parts = [];
  parts.push(renderChecklistBlock(dayLabelFR(jour), FIXED_TIMES, timesSet));
  parts.push(renderChecklistBlock('COMPÉTITIONS', COMPETITIONS, compSet));

  if (d.salonId) parts.push(`📍 Salon : <#${d.salonId}>`);
  return parts.join('\n\n');
}

function renderWeek(planning) {
  const blocks = [];
  for (const j of JOURS) {
    blocks.push(renderDay(j, planning?.[j]));
  }
  return blocks.join('\n\n');
}

function chunkMessage(str, limit = 1900) {
  const parts = [];
  let cur = '';
  for (const line of String(str || '').split('\n')) {
    if ((cur + '\n' + line).length > limit) {
      parts.push(cur);
      cur = line;
    } else {
      cur = cur ? (cur + '\n' + line) : line;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

function makeTimeMenu(selectedTimes) {
  return new StringSelectMenuBuilder()
    .setCustomId('planning_times')
    .setPlaceholder('✅ Horaires (21h→23h / 20min) — coche/décoche')
    .setMinValues(0)
    .setMaxValues(FIXED_TIMES.length)
    .addOptions(
      FIXED_TIMES.map(t => ({
        label: t,
        value: t,
        default: selectedTimes.has(t)
      }))
    );
}

function makeCompMenu(selectedComps) {
  return new StringSelectMenuBuilder()
    .setCustomId('planning_comps')
    .setPlaceholder('🏆 Compétitions — coche/décoche')
    .setMinValues(0)
    .setMaxValues(COMPETITIONS.length)
    .addOptions(
      COMPETITIONS.map(c => ({
        label: c,
        value: c,
        default: selectedComps.has(c)
      }))
    );
}

function makeButtons() {
  return [
    new ButtonBuilder().setCustomId('planning_save').setLabel('Enregistrer').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('planning_clear').setLabel('Tout décocher').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('planning_cancel').setLabel('Annuler').setStyle(ButtonStyle.Danger)
  ];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('planning')
    .setDescription('Planning (cases à cocher) — horaires + compétitions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sc =>
      sc
        .setName('show')
        .setDescription('Affiche le planning (jour ou semaine).')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Optionnel : afficher un seul jour')
            .setRequired(false)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
    )

    .addSubcommand(sc =>
      sc
        .setName('edit')
        .setDescription('Édite le planning avec des cases à cocher (jour ou semaine).')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Optionnel : modifier un seul jour (sinon applique à toute la semaine)')
            .setRequired(false)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon lié (optionnel, enregistré avec le planning)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )

    .addSubcommand(sc =>
      sc
        .setName('clear')
        .setDescription('Vide le planning (jour ou semaine).')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Optionnel : vider un seul jour (sinon toute la semaine)')
            .setRequired(false)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
    )

    .addSubcommand(sc =>
      sc
        .setName('post')
        .setDescription('Poste le planning dans un salon (jour ou semaine).')
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon cible (défaut: salon actuel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Optionnel : poster un seul jour')
            .setRequired(false)
            .addChoices(...JOURS.map(j => ({ name: dayLabelFR(j), value: j })))
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const { guild: guildConfig } = getConfigFromInteraction(interaction) || {};

    const savedPlanning = getSavedPlanning(guildConfig);

    // ---------------- SHOW ----------------
    if (sub === 'show') {
      const jourOpt = normalizeJour(interaction.options.getString('jour'));

      const content = jourOpt
        ? renderDay(jourOpt, savedPlanning[jourOpt])
        : renderWeek(savedPlanning);

      const chunks = chunkMessage(content);
      await interaction.reply({ content: chunks[0], ephemeral: false });
      for (const extra of chunks.slice(1)) {
        await interaction.followUp({ content: extra, ephemeral: false }).catch(() => {});
      }
      return;
    }

    // ---------------- CLEAR ----------------
    if (sub === 'clear') {
      const jourOpt = normalizeJour(interaction.options.getString('jour'));
      const next = { ...savedPlanning };

      if (jourOpt) {
        next[jourOpt] = buildEmptyDay(next[jourOpt]?.salonId || null);
      } else {
        const keepSalonId = null;
        const empty = buildEmptyDay(keepSalonId);
        for (const j of JOURS) next[j] = empty;
      }

      updateGuildConfig(guild.id, { planning: next });

      return interaction.reply({
        content: jourOpt
          ? `🗑️ **${dayLabelFR(jourOpt)}** : tout décoché.`
          : '🗑️ **Semaine** : tout décoché.',
        ephemeral: true
      });
    }

    // ---------------- POST ----------------
    if (sub === 'post') {
      const targetChannel = interaction.options.getChannel('salon') || interaction.channel;
      const jourOpt = normalizeJour(interaction.options.getString('jour'));

      const me = guild.members.me;
      const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
      if (!targetChannel?.permissionsFor?.(me)?.has(needed)) {
        return interaction.reply({
          content: `❌ Je ne peux pas écrire dans <#${targetChannel?.id || 'inconnu'}>.`,
          ephemeral: true
        });
      }

      const content = jourOpt
        ? renderDay(jourOpt, savedPlanning[jourOpt])
        : renderWeek(savedPlanning);

      for (const part of chunkMessage(content)) {
        await targetChannel.send({ content: part }).catch(() => {});
      }

      return interaction.reply({
        content: `📌 Planning posté dans <#${targetChannel.id}>${jourOpt ? ` (**${dayLabelFR(jourOpt)}**)` : ''}.`,
        ephemeral: true
      });
    }

    // ---------------- EDIT (cases à cocher) ----------------
    if (sub === 'edit') {
      const jourOpt = normalizeJour(interaction.options.getString('jour')); // null => semaine
      const salon = interaction.options.getChannel('salon');
      const salonId = salon?.id || null;

      // Base à éditer :
      // - si jour => dayData existant ou vide
      // - si semaine => on prend le jour "lundi" comme base si existe, sinon vide
      const baseDay = jourOpt
        ? normalizeDayData(savedPlanning[jourOpt])
        : normalizeDayData(savedPlanning.lundi);

      // si salon fourni, on l’applique dans l’éditeur (mais pas obligatoire)
      if (salonId) baseDay.salonId = salonId;

      // Sélections en mémoire pendant l’édition
      const selectedTimes = new Set(baseDay.times);
      const selectedComps = new Set(baseDay.competitions);

      const scopeLabel = jourOpt ? dayLabelFR(jourOpt) : 'SEMAINE';

      const preview = () => {
        const temp = {
          ...(jourOpt ? { [jourOpt]: { times: [...selectedTimes], competitions: [...selectedComps], salonId: baseDay.salonId || null } } : {})
        };

        // mini aperçu texte (pas de titre global)
        const dayText = jourOpt
          ? renderDay(jourOpt, temp[jourOpt])
          : [
              renderChecklistBlock(scopeLabel, FIXED_TIMES, selectedTimes),
              renderChecklistBlock('COMPÉTITIONS', COMPETITIONS, selectedComps),
              baseDay.salonId ? `📍 Salon : <#${baseDay.salonId}>` : ''
            ].filter(Boolean).join('\n\n');

        return dayText;
      };

      const row1 = new ActionRowBuilder().addComponents(makeTimeMenu(selectedTimes));
      const row2 = new ActionRowBuilder().addComponents(makeCompMenu(selectedComps));
      const row3 = new ActionRowBuilder().addComponents(...makeButtons());

      await interaction.reply({
        content: `📌 **Édition PLANNING — ${scopeLabel}**\n\n${preview()}`,
        components: [row1, row2, row3],
        ephemeral: true
      });

      const msg = await interaction.fetchReply();

      const refresh = async () => {
        const r1 = new ActionRowBuilder().addComponents(makeTimeMenu(selectedTimes));
        const r2 = new ActionRowBuilder().addComponents(makeCompMenu(selectedComps));
        const r3 = new ActionRowBuilder().addComponents(...makeButtons());

        await interaction.editReply({
          content: `📌 **Édition PLANNING — ${scopeLabel}**\n\n${preview()}`,
          components: [r1, r2, r3]
        }).catch(() => {});
      };

      const filter = (i) => i.user.id === interaction.user.id && i.message.id === msg.id;

      // boucle d’édition (menus + boutons)
      while (true) {
        let i;
        try {
          i = await msg.awaitMessageComponent({ filter, time: 5 * 60 * 1000 });
        } catch {
          // timeout -> on ferme
          await interaction.editReply({ content: '⏱️ Édition expirée.', components: [] }).catch(() => {});
          return;
        }

        // Menus
        if (i.isStringSelectMenu()) {
          if (i.customId === 'planning_times') {
            selectedTimes.clear();
            for (const v of i.values) selectedTimes.add(v);
            await i.deferUpdate().catch(() => {});
            await refresh();
            continue;
          }

          if (i.customId === 'planning_comps') {
            selectedComps.clear();
            for (const v of i.values) selectedComps.add(v);
            await i.deferUpdate().catch(() => {});
            await refresh();
            continue;
          }
        }

        // Boutons
        if (i.isButton()) {
          if (i.customId === 'planning_clear') {
            selectedTimes.clear();
            selectedComps.clear();
            await i.deferUpdate().catch(() => {});
            await refresh();
            continue;
          }

          if (i.customId === 'planning_cancel') {
            await i.update({ content: '❌ Annulé.', components: [] }).catch(() => {});
            return;
          }

          if (i.customId === 'planning_save') {
            const next = { ...savedPlanning };

            const payload = {
              times: [...selectedTimes],
              competitions: [...selectedComps],
              salonId: baseDay.salonId || null
            };

            if (jourOpt) {
              next[jourOpt] = payload;
            } else {
              // applique à toute la semaine
              for (const j of JOURS) next[j] = payload;
            }

            updateGuildConfig(guild.id, { planning: next });

            await i.update({
              content: `✅ Enregistré sur **${scopeLabel}**.\n\n${jourOpt ? renderDay(jourOpt, payload) : preview()}`,
              components: []
            }).catch(() => {});
            return;
          }
        }

        // fallback
        await i.deferUpdate().catch(() => {});
      }
    }
  }
};
