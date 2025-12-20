// commands/verifier_compo_semaine.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const { getConfigFromInteraction } = require('../utils/config');
const { SNAPSHOT_DIR } = require('../utils/paths');

const DEFAULT_COLOR = 0xff4db8;

/* ---------- Couleur d’embed depuis la config ---------- */
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

/* ---------- Utils dates ---------- */
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

/**
 * Date “aujourd’hui” en Europe/Paris (00:00)
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

/* ---------- Lecture snapshots compo (persistants) ---------- */
function readCompoSnapshotsInRange(fromDate, toDate, guildId) {
  const snaps = [];
  if (!fs.existsSync(SNAPSHOT_DIR)) return snaps;

  const files = fs.readdirSync(SNAPSHOT_DIR)
    .filter(f => f.startsWith('compo-') && f.endsWith('.json'));

  for (const f of files) {
    try {
      const full = path.join(SNAPSHOT_DIR, f);
      const js = JSON.parse(fs.readFileSync(full, 'utf8'));

      if (js?.type !== 'compo') continue;
      if (guildId && String(js.guildId || '') !== String(guildId)) continue;

      const fileDate = js.date ? parseISODate(js.date) : null;
      if (!fileDate) continue;

      if (fileDate >= fromDate && fileDate <= toDate) {
        snaps.push({ file: f, date: fileDate, data: js });
      }
    } catch {
      // ignore fichiers cassés
    }
  }

  snaps.sort((a, b) => a.date - b.date);
  return snaps;
}

/* ---------- Commande ---------- */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('verifier_compo_semaine')
    .setDescription('Résumé : convoqués n’ayant pas validé la compo (via snapshots persistants).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('debut')
        .setDescription('Date début (YYYY-MM-DD). Défaut : aujourd’hui - 6 jours (Europe/Paris)')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('fin')
        .setDescription('Date fin (YYYY-MM-DD). Défaut : aujourd’hui (Europe/Paris)')
        .setRequired(false)
    )
    .addBooleanOption(o =>
      o.setName('mention')
        .setDescription('Mentionner les joueurs trouvés (si encore sur le serveur). Défaut : non')
        .setRequired(false)
    )
    .addBooleanOption(o =>
      o.setName('inclure_hors_serveur')
        .setDescription('Inclure aussi les convoqués qui ont quitté le serveur. Défaut : oui')
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName('salon')
        .setDescription('Salon où envoyer le rapport (défaut : salon des rapports ou salon courant)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return;

    const mention = interaction.options.getBoolean('mention') ?? false;
    const includeExternal = interaction.options.getBoolean('inclure_hors_serveur') ?? true;

    // 🔧 Config serveur
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
        content: `❌ Je ne peux pas écrire dans <#${targetChannel?.id || 'inconnu'}>.`,
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
        content: '❌ Dates invalides. Utilise `YYYY-MM-DD` et assure-toi que début ≤ fin.',
        ephemeral: true
      });
    }

    await interaction.reply({
      content: `🔎 Analyse des **snapshots de compo** du **${debutStr}** au **${finStr}**…`,
      ephemeral: true
    });

    const snaps = readCompoSnapshotsInRange(fromDate, toDate, guild.id);
    if (!snaps.length) {
      return interaction.followUp({
        content: `⚠️ Aucun snapshot de compo trouvé dans \`${SNAPSHOT_DIR}\` sur ${debutStr} → ${finStr}.`,
        ephemeral: true
      });
    }

    // Cache membres actuels
    await guild.members.fetch().catch(() => {});
    const currentIds = new Set(guild.members.cache.filter(m => !m.user.bot).map(m => m.id));

    // Comptage
    const misses = new Map();       // id -> nb non validées
    const convocCount = new Map();  // id -> nb convocations
    let snapshotsUsed = 0;

    for (const s of snaps) {
      const data = s.data || {};
      const convoques = Array.isArray(data.convoques) ? data.convoques : null;
      const nonValid  = Array.isArray(data.non_valides) ? data.non_valides : null;

      if (!convoques || !nonValid) continue;
      snapshotsUsed++;

      const nonSet = new Set(nonValid);

      for (const id of convoques) {
        const inServer = currentIds.has(id);
        if (!inServer && !includeExternal) continue;

        convocCount.set(id, (convocCount.get(id) || 0) + 1);
        if (nonSet.has(id)) misses.set(id, (misses.get(id) || 0) + 1);
      }
    }

    const entries = [...misses.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);

    const headerLines = [
      `📅 **Vérification des compositions (Snapshots)**`,
      `🗓️ Période : **${debutStr} → ${finStr}**`,
      `📂 Snapshots pris en compte : **${snapshotsUsed}**`,
      includeExternal
        ? 'Portée : **Convoqués (serveur + hors serveur via snapshots)**'
        : 'Portée : **Convoqués (membres du serveur uniquement)**'
    ];

    const asLine = (id, count) => {
      const member = guild.members.cache.get(id);
      const totalConv = convocCount.get(id) || count;

      if (member) {
        return `<@${id}> — **${count}** compo non validée(s) sur **${totalConv}** convocation(s)`;
      }
      return `\`${id}\` *(hors serveur)* — **${count}** compo non validée(s) sur **${totalConv}** convocation(s)`;
    };

    if (!entries.length) {
      const embedOK = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle('✅ Aucun convoqué avec compo non validée sur la période')
        .setDescription(headerLines.join('\n'))
        .setFooter({ text: `${clubLabel} ⚫ Rapport compo (snapshots)` })
        .setTimestamp();

      await targetChannel.send({ embeds: [embedOK], allowedMentions: { parse: [] } });
      return interaction.followUp({ content: '✅ Vérification semaine compo terminée.', ephemeral: true });
    }

    // Pagination
    const pageSize = 20;
    const pages = [];
    for (let i = 0; i < entries.length; i += pageSize) {
      pages.push(entries.slice(i, i + pageSize));
    }

    // 1ère page
    const first = pages.shift();
    const firstEmbed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`⏳ Convoqués n’ayant pas validé (total ${entries.length})`)
      .setDescription(headerLines.join('\n'))
      .addFields({
        name: 'Liste',
        value: first.map(([id, n]) => `• ${asLine(id, n)}`).join('\n').slice(0, 1024)
      })
      .setFooter({ text: `${clubLabel} ⚫ Rapport compo (snapshots)` })
      .setTimestamp();

    const firstMentionIds = mention
      ? first.map(([id]) => id).filter(id => guild.members.cache.has(id))
      : [];

    await targetChannel.send({
      embeds: [firstEmbed],
      allowedMentions: mention ? { users: firstMentionIds, parse: [] } : { parse: [] }
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
        .setFooter({ text: `${clubLabel} ⚫ Rapport compo (snapshots)` })
        .setTimestamp();

      const mentionIds = mention
        ? page.map(([id]) => id).filter(id => guild.members.cache.has(id))
        : [];

      await targetChannel.send({
        embeds: [embed],
        allowedMentions: mention ? { users: mentionIds, parse: [] } : { parse: [] }
      });
    }

    await interaction.followUp({
      content: `✅ Vérification semaine compo envoyée dans <#${targetChannel.id}>.`,
      ephemeral: true
    });
  }
};
