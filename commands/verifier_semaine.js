// commands/verifier_semaine.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const { getConfigFromInteraction } = require('../utils/config');
const { SNAPSHOT_DIR } = require('../utils/paths');

const DEFAULT_COLOR = 0xff4db8;

// ✅ format scheduler : dispos-jour-YYYY-MM-DD.json
const DISPO_SNAP_REGEX =
  /^dispos-(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)-(\d{4}-\d{2}-\d{2})\.json$/i;

/* ------------------------- Couleur depuis config ------------------------- */
function getEmbedColor(cfg) {
  const hex = cfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

function isValidId(id) {
  return !!id && id !== '0';
}

/* ------------------------- Utils dates ------------------------- */
function parseISODate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return new Date(y, mo - 1, da, 0, 0, 0, 0);
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, delta) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + delta);
  return x;
}

/**
 * Aujourd’hui à 00:00 en Europe/Paris (fiable, pas de toLocaleString hack)
 */
function getParisTodayDate() {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t)?.value;

  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/* --------------------- Lecture snapshots (persistants) ----------------------- */
function readDispoSnapshotsInRange(fromDate, toDate, guildId) {
  const snaps = [];
  if (!fs.existsSync(SNAPSHOT_DIR)) return snaps;

  const files = fs.readdirSync(SNAPSHOT_DIR).filter(f => DISPO_SNAP_REGEX.test(f));

  for (const f of files) {
    const m = DISPO_SNAP_REGEX.exec(f);
    if (!m) continue;

    const fileDate = parseISODate(m[2]);
    if (!fileDate) continue;

    if (fileDate >= fromDate && fileDate <= toDate) {
      try {
        const js = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8'));
        // ✅ filtre guildId
        if (guildId && String(js?.guildId || '') !== String(guildId)) continue;

        snaps.push({ file: f, date: fileDate, data: js });
      } catch {
        // ignore fichiers corrompus
      }
    }
  }

  snaps.sort((a, b) => a.date - b.date);
  return snaps;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verifier_semaine')
    .setDescription('Outils basés sur les snapshots des disponibilités (persistants).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    /* --------------- Sous-commande : analyse ---------------- */
    .addSubcommand(sc =>
      sc
        .setName('analyse')
        .setDescription('Analyse les snapshots : jours sans réaction par membre.')
        .addStringOption(o =>
          o.setName('debut')
            .setDescription('Date début YYYY-MM-DD (défaut : aujourd’hui - 6 jours, Europe/Paris).')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('fin')
            .setDescription('Date fin YYYY-MM-DD (défaut : aujourd’hui, Europe/Paris).')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('mention')
            .setDescription('Mentionner les membres trouvés (si encore sur le serveur). Défaut : non')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('inclure_hors_serveur')
            .setDescription('Inclure les membres hors serveur. Défaut : oui')
            .setRequired(false)
        )
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon où envoyer le rapport (défaut : salon des rapports ou salon courant).')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )

    /* --------------- Sous-commande : reset ---------------- */
    .addSubcommand(sc =>
      sc
        .setName('reset')
        .setDescription('Supprime les snapshots dispos (persistants).')
        .addStringOption(o =>
          o.setName('avant')
            .setDescription('Supprimer les snapshots antérieurs ou égaux à cette date (YYYY-MM-DD).')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('simulation')
            .setDescription('Afficher uniquement la liste sans supprimer (défaut : oui).')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    /* ===============================================================
       /verifier_semaine analyse
    =============================================================== */
    if (sub === 'analyse') {
      const guild = interaction.guild;
      if (!guild) return;

      const mention = interaction.options.getBoolean('mention') ?? false;
      const includeExternal = interaction.options.getBoolean('inclure_hors_serveur') ?? true;

      const { guild: guildConfig } = getConfigFromInteraction(interaction) || {};
      const cfg = guildConfig || {};
      const embedColor = getEmbedColor(cfg);
      const clubLabel = cfg?.clubName || guild.name || 'INTER GALACTIQUE';

      const rapportChannelId = cfg?.rapportChannelId || null;

      const targetChannel =
        interaction.options.getChannel('salon') ||
        (isValidId(rapportChannelId) ? guild.channels.cache.get(rapportChannelId) : null) ||
        interaction.channel;

      const me = guild.members.me;
      if (!targetChannel?.permissionsFor?.(me)?.has(['ViewChannel', 'SendMessages'])) {
        return interaction.reply({
          content: `❌ Je n’ai pas la permission d’écrire dans <#${targetChannel?.id || 'inconnu'}>.`,
          ephemeral: true
        });
      }

      // Période défaut : 7 jours Paris
      const defaultEnd = getParisTodayDate();
      const defaultStart = addDays(defaultEnd, -6);

      const debutStr = interaction.options.getString('debut') || toISO(defaultStart);
      const finStr   = interaction.options.getString('fin')   || toISO(defaultEnd);

      const fromDate = parseISODate(debutStr);
      const toDate   = parseISODate(finStr);

      if (!fromDate || !toDate || fromDate > toDate) {
        return interaction.reply({
          content: '❌ Dates invalides. Format attendu : YYYY-MM-DD.',
          ephemeral: true
        });
      }

      await interaction.reply({
        content: `🔍 Analyse des snapshots dispos du **${debutStr}** au **${finStr}**…`,
        ephemeral: true
      });

      const snaps = readDispoSnapshotsInRange(fromDate, toDate, guild.id);
      if (!snaps.length) {
        return interaction.followUp({
          content: `⚠️ Aucun snapshot trouvé dans \`${SNAPSHOT_DIR}\` pour cette période.`,
          ephemeral: true
        });
      }

      await guild.members.fetch().catch(() => {});
      const currentIds = new Set(guild.members.cache.filter(m => !m.user.bot).map(m => m.id));

      const misses = new Map();     // id -> nb jours sans réaction
      const daysCount = new Map();  // id -> nb jours où il était éligible
      let snapshotsUsed = 0;
      let snapshotsSkipped = 0;

      for (const s of snaps) {
        const data = s.data || {};
        const reacted = new Set(Array.isArray(data.reacted) ? data.reacted : []);
        const eligibles = Array.isArray(data.eligibles) ? data.eligibles : null;

        if (!eligibles?.length) {
          snapshotsSkipped++;
          continue;
        }

        snapshotsUsed++;

        for (const id of eligibles) {
          const isInServer = currentIds.has(id);
          if (!isInServer && !includeExternal) continue;

          daysCount.set(id, (daysCount.get(id) || 0) + 1);
          if (!reacted.has(id)) misses.set(id, (misses.get(id) || 0) + 1);
        }
      }

      const entries = [...misses.entries()]
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]);

      const headerLines = [
        '📅 **Analyse disponibilités (Snapshots)**',
        `🗓️ Période : **${debutStr} → ${finStr}**`,
        `📂 Snapshots utilisés : **${snapshotsUsed}**`,
        snapshotsSkipped ? `⚠️ Ignorés : **${snapshotsSkipped}** (incomplets)` : '',
        includeExternal
          ? '🌐 Portée : membres du serveur + hors serveur'
          : '👥 Portée : membres du serveur uniquement'
      ].filter(Boolean);

      const asLine = (id, n) => {
        const m = guild.members.cache.get(id);
        const total = daysCount.get(id) || n;

        if (m) return `<@${id}> — **${n}** jour(s) sans réaction sur **${total}** jour(s)`;
        return `\`${id}\` *(hors serveur)* — **${n}** jour(s) sans réaction sur **${total}** jour(s)`;
      };

      if (!entries.length) {
        const embedOK = new EmbedBuilder()
          .setColor(embedColor)
          .setTitle('✅ Tous ont réagi au moins une fois')
          .setDescription(headerLines.join('\n'))
          .setFooter({ text: `${clubLabel} • Rapport snapshots dispos` })
          .setTimestamp();

        await targetChannel.send({ embeds: [embedOK], allowedMentions: { parse: [] } });
        return interaction.followUp({ content: '📨 Rapport envoyé.', ephemeral: true });
      }

      // Pagination
      const pageSize = 20;
      const pages = [];
      for (let i = 0; i < entries.length; i += pageSize) {
        pages.push(entries.slice(i, i + pageSize));
      }

      // Première page
      const first = pages.shift();
      const firstEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`⏳ Membres n’ayant pas réagi (total : ${entries.length})`)
        .setDescription(headerLines.join('\n'))
        .addFields({
          name: 'Liste',
          value: first.map(([id, n]) => `• ${asLine(id, n)}`).join('\n').slice(0, 1024)
        })
        .setFooter({ text: `${clubLabel} • Rapport snapshots dispos` })
        .setTimestamp();

      const firstMentions =
        mention ? first.map(([id]) => id).filter(id => guild.members.cache.has(id)) : [];

      await targetChannel.send({
        embeds: [firstEmbed],
        allowedMentions: mention ? { users: firstMentions, parse: [] } : { parse: [] }
      });

      // Pages suivantes
      for (const page of pages) {
        const embed = new EmbedBuilder()
          .setColor(embedColor)
          .setTitle('Suite')
          .addFields({
            name: 'Liste (suite)',
            value: page.map(([id, n]) => `• ${asLine(id, n)}`).join('\n').slice(0, 1024)
          })
          .setFooter({ text: `${clubLabel} • Rapport snapshots dispos` })
          .setTimestamp();

        const mentions =
          mention ? page.map(([id]) => id).filter(id => guild.members.cache.has(id)) : [];

        await targetChannel.send({
          embeds: [embed],
          allowedMentions: mention ? { users: mentions, parse: [] } : { parse: [] }
        });
      }

      return interaction.followUp({
        content: `📨 Rapport envoyé dans <#${targetChannel.id}>.`,
        ephemeral: true
      });
    }

    /* ===============================================================
       /verifier_semaine reset
    =============================================================== */
    if (sub === 'reset') {
      const simulation = interaction.options.getBoolean('simulation') ?? true;
      const avantStr = interaction.options.getString('avant') || null;
      const avantDate = avantStr ? parseISODate(avantStr) : null;

      if (avantStr && !avantDate) {
        return interaction.reply({
          content: '❌ Format de date invalide. Attendu : YYYY-MM-DD.',
          ephemeral: true
        });
      }

      await interaction.reply({
        content: '🧹 Analyse des snapshots dispos en cours…',
        ephemeral: true
      });

      if (!fs.existsSync(SNAPSHOT_DIR)) {
        return interaction.editReply({
          content: `ℹ️ Le dossier \`${SNAPSHOT_DIR}\` est vide — rien à supprimer.`
        });
      }

      const files = fs.readdirSync(SNAPSHOT_DIR).filter(f => DISPO_SNAP_REGEX.test(f));

      const toDelete = files.filter(f => {
        if (!avantDate) return true;
        const m = DISPO_SNAP_REGEX.exec(f);
        const fileDate = parseISODate(m?.[2]);
        return fileDate && fileDate <= avantDate;
      });

      if (!toDelete.length) {
        return interaction.editReply({
          content: `✅ Aucun fichier à supprimer${avantDate ? ` (≤ ${avantStr})` : ''}.`
        });
      }

      if (simulation) {
        const preview = toDelete.slice(0, 25).join('\n');
        return interaction.editReply({
          content: [
            `🧪 **Simulation** — ${toDelete.length} fichier(s) seraient supprimés.`,
            '```',
            preview,
            toDelete.length > 25 ? `\n... (+${toDelete.length - 25} autres)` : '',
            '```',
            'ℹ️ Relance avec `simulation:false` pour confirmer.'
          ].join('\n')
        });
      }

      let ok = 0;
      let fail = 0;
      const errors = [];

      for (const f of toDelete) {
        try {
          fs.unlinkSync(path.join(SNAPSHOT_DIR, f));
          ok++;
        } catch (e) {
          fail++;
          errors.push(`${f}: ${e?.message || e}`);
        }
      }

      return interaction.editReply({
        content: [
          `🗑️ Suppression terminée : **${ok}** fichier(s) supprimés.`,
          fail ? `❌ Erreurs (${fail}) :\n\`\`\`\n${errors.join('\n')}\n\`\`\`` : ''
        ].filter(Boolean).join('\n')
      });
    }
  }
};
