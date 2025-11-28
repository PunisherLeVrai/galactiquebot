// commands/verifier_semaine.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');

const fs = require('fs');
const path = require('path');
const { getConfigFromInteraction } = require('../utils/config');

const RAPPORTS_DIR = path.join(__dirname, '../rapports');
const COULEUR = 0xff4db8;
const SNAP_REGEX = /^snapshot-(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)-(\d{4}-\d{2}-\d{2})\.json$/i;

/* ------------------------- Utils dates ------------------------- */
function parseISODate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
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

/* --------------------- Lecture snapshots ----------------------- */
function readSnapshotsInRange(fromDate, toDate) {
  const snaps = [];
  if (!fs.existsSync(RAPPORTS_DIR)) return snaps;

  const files = fs.readdirSync(RAPPORTS_DIR)
    .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'));

  for (const f of files) {
    const m = SNAP_REGEX.exec(f);
    if (!m) continue;

    const fileDate = parseISODate(m[2]);
    if (!fileDate) continue;

    if (fileDate >= fromDate && fileDate <= toDate) {
      try {
        const js = JSON.parse(fs.readFileSync(path.join(RAPPORTS_DIR, f), 'utf8'));
        snaps.push({ file: f, date: fileDate, data: js });
      } catch {}
    }
  }

  snaps.sort((a, b) => a.date - b.date);
  return snaps;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verifier_semaine')
    .setDescription('Outils basés sur les snapshots des disponibilités.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    /* --------------- Sous-commande : analyse ---------------- */
    .addSubcommand(sc =>
      sc
        .setName('analyse')
        .setDescription('Analyse les snapshots : jours sans réaction par membre.')

        // STRING d'abord (ordre Discord correct)
        .addStringOption(o =>
          o.setName('debut')
            .setDescription('Date début YYYY-MM-DD (défaut : aujourd’hui - 6 jours).')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('fin')
            .setDescription('Date fin YYYY-MM-DD (défaut : aujourd’hui).')
            .setRequired(false)
        )

        // Puis BOOLEAN
        .addBooleanOption(o =>
          o.setName('mention')
            .setDescription('Mentionner les membres trouvés.')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('inclure_hors_serveur')
            .setDescription('Inclure les membres hors serveur.')
            .setRequired(false)
        )

        // CHANNEL toujours en dernier
        .addChannelOption(o =>
          o.setName('salon')
            .setDescription('Salon où envoyer le rapport.')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )

    /* --------------- Sous-commande : reset ---------------- */
    .addSubcommand(sc =>
      sc
        .setName('reset')
        .setDescription('Supprime les snapshots /rapports.')

        // STRING AVANT BOOLEAN (ordre Discord obligatoire)
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

  /* --------------------------------------------------------------- */
  /*                          EXECUTION                              */
  /* --------------------------------------------------------------- */
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    /* ===============================================================
       /verifier_semaine analyse
    =============================================================== */
    if (sub === 'analyse') {
      const guild = interaction.guild;

      const mention = interaction.options.getBoolean('mention') ?? false;
      const includeExternal = interaction.options.getBoolean('inclure_hors_serveur') ?? true;

      // Charge config dynamique
      const { guild: guildConfig } = getConfigFromInteraction(interaction) || {};
      const rapportChannelId =
        guildConfig?.channels?.rapport ||
        guildConfig?.rapportChannelId ||
        null;

      // Canal cible
      const targetChannel =
        interaction.options.getChannel('salon') ||
        (rapportChannelId ? guild.channels.cache.get(rapportChannelId) : null) ||
        interaction.channel;

      // Permissions
      const me = guild.members.me;
      if (!targetChannel?.permissionsFor?.(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        return interaction.reply({
          content: `❌ Je n’ai pas la permission d’écrire dans <#${targetChannel.id}>.`,
          flags: MessageFlags.Ephemeral
        });
      }

      /* -- Période -- */
      const nowParis = new Date(new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }));
      const defaultEnd = new Date(nowParis.getFullYear(), nowParis.getMonth(), nowParis.getDate());
      const defaultStart = addDays(defaultEnd, -6);

      const debutStr = interaction.options.getString('debut') || toISO(defaultStart);
      const finStr   = interaction.options.getString('fin') || toISO(defaultEnd);

      const fromDate = parseISODate(debutStr);
      const toDate   = parseISODate(finStr);

      if (!fromDate || !toDate || fromDate > toDate) {
        return interaction.reply({
          content: '❌ Dates invalides. Format attendu : YYYY-MM-DD.',
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.reply({
        content: `🔍 Analyse des snapshots du **${debutStr}** au **${finStr}**…`,
        flags: MessageFlags.Ephemeral
      });

      const snaps = readSnapshotsInRange(fromDate, toDate);
      if (snaps.length === 0) {
        return interaction.followUp({
          content: `⚠️ Aucun snapshot trouvé dans /rapports pour cette période.`,
          flags: MessageFlags.Ephemeral
        });
      }

      await guild.members.fetch().catch(() => {});
      const currentIds = new Set(guild.members.cache.filter(m => !m.user.bot).map(m => m.id));

      /* -- Analyse réactions -- */
      const misses = new Map();
      const daysCount = new Map();
      let snapshotsUsed = 0;
      let snapshotsSkipped = 0;

      for (const s of snaps) {
        const reacted = new Set(Array.isArray(s.data?.reacted) ? s.data.reacted : []);
        const eligibles = Array.isArray(s.data?.eligibles) ? s.data.eligibles : null;

        if (!eligibles || eligibles.length === 0) {
          snapshotsSkipped++;
          continue;
        }

        snapshotsUsed++;

        for (const id of eligibles) {
          const isInServer = currentIds.has(id);
          if (!isInServer && !includeExternal) continue;

          if (!misses.has(id)) misses.set(id, 0);
          if (!daysCount.has(id)) daysCount.set(id, 0);

          daysCount.set(id, daysCount.get(id) + 1);
          if (!reacted.has(id)) misses.set(id, misses.get(id) + 1);
        }
      }

      const entries = [...misses.entries()]
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]);

      const headerLines = [
        `📅 **Analyse disponibilités (Snapshots)**`,
        `🗓️ Période : **${debutStr} → ${finStr}**`,
        `📂 Snapshots utilisés : **${snapshotsUsed}**`,
        snapshotsSkipped ? `⚠️ Ignorés : **${snapshotsSkipped}** (incomplets)` : '',
        includeExternal
          ? '🌐 Portée : membres du serveur + hors serveur'
          : '👥 Portée : membres du serveur uniquement'
      ].filter(Boolean);

      const asLine = (id, n) => {
        const m = guild.members.cache.get(id);
        return m
          ? `<@${id}> — **${n}** jour(s) sans réaction`
          : `\`${id}\` *(hors serveur)* — **${n}** jour(s)`;
      };

      if (entries.length === 0) {
        const embedOK = new EmbedBuilder()
          .setColor(COULEUR)
          .setTitle('✅ Tous ont réagi au moins une fois')
          .setDescription(headerLines.join('\n'))
          .setFooter({ text: 'INTER GALACTIQUE • Rapport snapshots' })
          .setTimestamp();

        await targetChannel.send({ embeds: [embedOK], allowedMentions: { parse: [] } });
        return interaction.followUp({ content: '📨 Rapport envoyé.', flags: MessageFlags.Ephemeral });
      }

      /* -- Pagination -- */
      const pageSize = 20;
      const pages = [];
      for (let i = 0; i < entries.length; i += pageSize)
        pages.push(entries.slice(i, i + pageSize));

      /* Première page */
      const first = pages.shift();
      const firstEmbed = new EmbedBuilder()
        .setColor(COULEUR)
        .setTitle(`⏳ Membres n’ayant pas réagi (total : ${entries.length})`)
        .setDescription(headerLines.join('\n'))
        .addFields({
          name: 'Liste',
          value: first.map(([id, n]) => `• ${asLine(id, n)}`).join('\n').slice(0, 1024)
        })
        .setFooter({ text: 'INTER GALACTIQUE • Rapport snapshots' })
        .setTimestamp();

      const firstMentions =
        mention ? first.map(([id]) => id).filter(id => guild.members.cache.has(id)) : [];

      await targetChannel.send({
        embeds: [firstEmbed],
        allowedMentions: mention ? { users: firstMentions } : { parse: [] }
      });

      /* Pages suivantes */
      for (const page of pages) {
        const chunks = [];
        let cur = [];
        let len = 0;

        for (const [id, n] of page) {
          const line = `• ${asLine(id, n)}\n`;
          if (len + line.length > 1024) {
            chunks.push(cur.join(''));
            cur = [line];
            len = line.length;
          } else {
            cur.push(line);
            len += line.length;
          }
        }
        if (cur.length) chunks.push(cur.join(''));

        const embed = new EmbedBuilder()
          .setColor(COULEUR)
          .setTitle('Suite')
          .setFooter({ text: 'INTER GALACTIQUE • Rapport snapshots' })
          .setTimestamp();

        chunks.forEach((c, i) => {
          embed.addFields({ name: i === 0 ? 'Liste (suite)' : '…', value: c });
        });

        const mentions =
          mention ? page.map(([id]) => id).filter(id => guild.members.cache.has(id)) : [];

        await targetChannel.send({
          embeds: [embed],
          allowedMentions: mention ? { users: mentions } : { parse: [] }
        });
      }

      return interaction.followUp({
        content: `📨 Rapport envoyé dans <#${targetChannel.id}>.`,
        flags: MessageFlags.Ephemeral
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
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.reply({
        content: '🧹 Analyse des snapshots en cours…',
        flags: MessageFlags.Ephemeral
      });

      if (!fs.existsSync(RAPPORTS_DIR)) {
        return interaction.editReply({
          content: 'ℹ️ Le dossier `/rapports` est vide — rien à supprimer.'
        });
      }

      const files = fs.readdirSync(RAPPORTS_DIR)
        .filter(f => SNAP_REGEX.test(f));

      const toDelete = files.filter(f => {
        if (!avantDate) return true;
        const m = SNAP_REGEX.exec(f);
        const fileDate = parseISODate(m?.[2]);
        return fileDate && fileDate <= avantDate;
      });

      if (toDelete.length === 0) {
        return interaction.editReply({
          content: `✅ Aucun fichier à supprimer${avantDate ? ` (≤ ${avantStr})` : ''}.`
        });
      }

      if (simulation) {
        const preview = toDelete.slice(0, 20).join('\n');
        return interaction.editReply({
          content: [
            `🧪 **Simulation** — ${toDelete.length} fichier(s) seraient supprimés.`,
            '```',
            preview,
            toDelete.length > 20 ? `\n... (+${toDelete.length - 20} autres)` : '',
            '```',
            `ℹ️ Relance avec \`simulation:false\` pour confirmer.`
          ].join('\n')
        });
      }

      let ok = 0, fail = 0;
      const errors = [];

      for (const f of toDelete) {
        try {
          fs.unlinkSync(path.join(RAPPORTS_DIR, f));
          ok++;
        } catch (e) {
          fail++;
          errors.push(`${f}: ${e?.message}`);
        }
      }

      return interaction.editReply({
        content: [
          `🗑️ Suppression terminée : **${ok}** fichier(s) supprimés.`,
          fail
            ? `❌ Erreurs (${fail}) :\n\`\`\`\n${errors.join('\n')}\n\`\`\``
            : ''
        ].join('\n')
      });
    }
  }
};