// commands/effectif.js
// ✅ /effectif : 1 seul embed, Présidence+Staff ensemble, Joueurs & Tests séparés
// ✅ Mentions <@id> uniquement + Total unique sans doublon
// ✅ Source config: servers.json via utils/config.getGuildConfig
// - Staff = rôles déclarés dans cfg.nickname.hierarchy (ex: PRÉSIDENT/GM/coGM/STAFF)
// - Joueurs = cfg.roles.joueur
// - Tests = cfg.roles.essai
// ⚠️ Aucun ping automatique (allowedMentions: { parse: [] })

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getGuildConfig } = require('../utils/config');

const DEFAULT_COLOR = 0xff4db8;

function isValidId(id) {
  return !!id && id !== '0';
}

function getEmbedColorFromConfig(cfg) {
  const hex = cfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function mentionsBlock(ids, emptyLabel = '• _Aucun_') {
  const clean = uniq(ids).sort(); // tri stable (IDs)
  if (!clean.length) return emptyLabel;
  // 4096 max en description, on reste safe avec 25-80 membres; si énorme, on tronque
  const lines = clean.map(id => `• <@${id}>`);
  const out = lines.join('\n');
  return out.length > 1800 ? (out.slice(0, 1799) + '…') : out;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('effectif')
    .setDescription('Affiche l’effectif (Staff + Joueurs + Tests) en 1 seul embed.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ Commande utilisable uniquement sur un serveur.', ephemeral: true });
    }

    const cfg = getGuildConfig(guild.id);
    if (!cfg) {
      return interaction.reply({
        content: '❌ Configuration serveur introuvable (servers.json).',
        ephemeral: true
      });
    }

    // Rôles de base
    const roleJoueurId = cfg?.roles?.joueur;
    const roleEssaiId = cfg?.roles?.essai;

    // Staff = hierarchy dans nickname
    const hierarchy = Array.isArray(cfg?.nickname?.hierarchy) ? cfg.nickname.hierarchy : [];
    const staffRoleIds = hierarchy.map(r => r?.id).filter(isValidId);

    // Fetch membres (pour avoir cache complet)
    await guild.members.fetch().catch(() => {});

    // Sets
    const staffSet = new Set();
    const joueursSet = new Set();
    const testsSet = new Set();
    const totalSet = new Set();

    // Helpers rôles
    const roleJoueur = isValidId(roleJoueurId) ? guild.roles.cache.get(roleJoueurId) : null;
    const roleEssai = isValidId(roleEssaiId) ? guild.roles.cache.get(roleEssaiId) : null;

    // 1) Staff (présidence + staff dans le même bloc)
    if (staffRoleIds.length) {
      const roleObjs = staffRoleIds
        .map(id => guild.roles.cache.get(id))
        .filter(Boolean);

      for (const r of roleObjs) {
        for (const m of r.members.values()) {
          if (m.user?.bot) continue;
          staffSet.add(m.id);
          totalSet.add(m.id);
        }
      }
    }

    // 2) Joueurs (exclure ceux déjà comptés staff)
    if (roleJoueur) {
      for (const m of roleJoueur.members.values()) {
        if (m.user?.bot) continue;
        if (staffSet.has(m.id)) continue; // anti-doublon (staff prioritaire)
        joueursSet.add(m.id);
        totalSet.add(m.id);
      }
    }

    // 3) Tests (exclure ceux déjà staff ou joueur)
    if (roleEssai) {
      for (const m of roleEssai.members.values()) {
        if (m.user?.bot) continue;
        if (staffSet.has(m.id)) continue;
        if (joueursSet.has(m.id)) continue;
        testsSet.add(m.id);
        totalSet.add(m.id);
      }
    }

    const color = getEmbedColorFromConfig(cfg);
    const clubName = cfg?.clubName || guild.name || 'Club';
    const tag = String(cfg?.tag || '').trim();

    const title = tag ? `📋 EFFECTIF — ${tag} ${clubName}` : `📋 EFFECTIF — ${clubName}`;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(
        [
          `👑 **Présidence & Staff** (**${staffSet.size}**)`,
          mentionsBlock([...staffSet]),
          '',
          `⚽ **Joueurs** (**${joueursSet.size}**)`,
          mentionsBlock([...joueursSet]),
          '',
          `🧪 **Tests** (**${testsSet.size}**)`,
          mentionsBlock([...testsSet]),
          '',
          `📊 **Total unique : ${totalSet.size}**`
        ].join('\n')
      )
      .setFooter({ text: `${clubName} • Effectif officiel` })
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      allowedMentions: { parse: [] } // ✅ ne ping pas automatiquement
    });
  }
};
