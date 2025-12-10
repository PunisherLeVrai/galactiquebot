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

const RAPPORTS_DIR = path.join(__dirname, '../rapports');
const DEFAULT_COLOR = 0xff4db8;

/* ---------- Couleur d’embed depuis la config ---------- */
function getEmbedColor(cfg) {
  const hex = cfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}
function addDays(d, delta) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + delta);
  return x;
}

/* ---------- Lecture snapshots compo ---------- */
function readCompoSnapshotsInRange(fromDate, toDate) {
  const snaps = [];
  if (!fs.existsSync(RAPPORTS_DIR)) return snaps;

  const files = fs.readdirSync(RAPPORTS_DIR)
    .filter(f => f.startsWith('compo-') && f.endsWith('.json'));

  for (const f of files) {
    try {
      const full = path.join(RAPPORTS_DIR, f);
      const js = JSON.parse(fs.readFileSync(full, 'utf8'));

      if (js.type !== 'compo') continue;

      const fileDate = js.date ? parseISODate(js.date) : null;
      if (!fileDate) continue;

      if (fileDate >= fromDate && fileDate <= toDate) {
        snaps.push({ file: f, date: fileDate, data: js });
      }
    } catch {
      // on ignore les fichiers cassés
    }
  }

  snaps.sort((a, b) => a.date - b.date);
  return snaps;
}

/* ---------- Commande ---------- */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('verifier_compo_semaine')
    .setDescription('Résumé sur la période : convoqués n’ayant pas validé la compo (via snapshots).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('debut')
        .setDescription('Date de début (YYYY-MM-DD). Défaut : aujourd’hui - 6 jours (Europe/Paris)')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('fin')
        .setDescription('Date de fin (YYYY-MM-DD). Défaut : aujourd’hui (Europe/Paris)')
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
    const mention = interaction.options.getBoolean('mention') ?? false;
    const includeExternal = interaction.options.getBoolean('inclure_hors_serveur') ?? true;

    // 🔧 Récup config serveur (rapportChannelId + style)
    const { guild: guildConfig } = getConfigFromInteraction(interaction) || {};
    const embedColor = getEmbedColor(guildConfig);
    const clubLabel = guildConfig?.clubName || guild.name || 'INTER GALACTIQUE';

    const rapportChannelId =
      guildConfig?.channels?.rapport ||
      guildConfig?.rapportChannelId ||
      null;

    const targetChannel =
      interaction.options.getChannel('salon') ||
      (rapportChannelId ? guild.channels.cache.get(rapportChannelId) : null) ||
      interaction.channel;

    const me = guild.members.me;
    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
    if (!targetChannel?.permissionsFor?.(me)?.has(needed)) {
      return interaction.reply({
        content: `❌ Je ne peux pas écrire dans <#${targetChannel?.id || 'inconnu'}>.`,
        ephemeral: true
      });
    }

    // Période par défaut : 7 jours (Europe/Paris)
    const nowParis = new Date(new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }));
    const defaultEnd = new Date(nowParis.getFullYear(), nowParis.getMonth(), nowParis.getDate());
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

    const snaps = readCompoSnapshotsInRange(fromDate, toDate);
    if (snaps.length === 0) {
      return interaction.followUp({
        content: `⚠️ Aucun snapshot de compo trouvé dans \`/rapports\` sur la période ${debutStr} → ${finStr}.`,
        ephemeral: true
      });
    }

    // Cache des membres actuels
    await guild.members.fetch().catch(() => {});
    const currentIds = new Set(guild.members.cache.filter(m => !m.user.bot).map(m => m.id));

    // Comptage des "non_valides" par joueur
    const misses = new Map();       // id -> nb de compo non validées
    const convocCount = new Map();  // id -> nb de compo où il était convoqué (pour info)
    let snapshotsUsed = 0;

    for (const s of snaps) {
      const data = s.data || {};
      const convoques = Array.isArray(data.convoques) ? data.convoques : null;
      const nonValid = Array.isArray(data.non_valides) ? data.non_valides : null;

      if (!convoques || !nonValid) continue;

      snapshotsUsed++;

      const nonSet = new Set(nonValid);

      for (const id of convoques) {
        const isInServer = currentIds.has(id);
        if (!isInServer && !includeExternal) continue;

        if (!convocCount.has(id)) convocCount.set(id, 0);
        convocCount.set(id, convocCount.get(id) + 1);

        if (nonSet.has(id)) {
          if (!misses.has(id)) misses.set(id, 0);
          misses.set(id, misses.get(id) + 1);
        }
      }
    }

    const entries = [...misses.entries()]
      .filter(([_, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]); // plus de compo non validées en haut

    const headerLines = [
      `📅 **Vérification des compositions (Snapshots only)**`,
      `Période : **${debutStr} → ${finStr}**`,
      `Snapshots pris en compte : **${snapshotsUsed}**`,
      includeExternal
        ? 'Portée : **Convoqués (serveur + hors serveur via snapshots)**'
        : 'Portée : **Convoqués (membres du serveur uniquement)**'
    ];

    const asLine = (id, count) => {
      const member = guild.members.cache.get(id);
      const name = member ? member.displayName : `Utilisateur ${id}`;
      const suffix = member ? '' : ' *(hors serveur)*';
      const totalConv = convocCount.get(id) || count;
      return `${member ? `<@${id}>` : `\`${name}\``}${suffix} — **${count}** compo non validée(s) sur **${totalConv}** convocation(s)`;
    };

    if (!entries.length) {
      const embedOK = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle('✅ Aucun convoqué avec compo non validée sur la période')
        .setDescription(headerLines.join('\n'))
        .setFooter({ text: `${clubLabel} ⚫ Rapport compo (snapshots)` })
        .setTimestamp();

      await targetChannel.send({ embeds: [embedOK], allowedMentions: { parse: [] } });
      return interaction.followUp({
        content: '✅ Vérification semaine compo terminée.',
        ephemeral: true
      });
    }

    // Pagination
    const entriesCopy = [...entries];
    const pageSize = 20;
    const pages = [];
    for (let i = 0; i < entriesCopy.length; i += pageSize) {
      pages.push(entriesCopy.slice(i, i + pageSize));
    }

    // Première page avec header
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

    // Pages suivantes (suite)
    for (const page of pages) {
      const chunks = [];
      let cur = [];
      let curLen = 0;
      for (const [id, n] of page) {
        const line = `• ${asLine(id, n)}\n`;
        if (curLen + line.length > 1024) {
          chunks.push(cur.join(''));
          cur = [line];
          curLen = line.length;
        } else {
          cur.push(line);
          curLen += line.length;
        }
      }
      if (cur.length) chunks.push(cur.join(''));

      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle('Suite')
        .setFooter({ text: `${clubLabel} ⚫ Rapport compo (snapshots)` })
        .setTimestamp();

      chunks.forEach((block, idx) => {
        embed.addFields({ name: idx === 0 ? 'Liste (suite)' : '…', value: block });
      });

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
