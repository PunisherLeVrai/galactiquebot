// commands/synchroniser_pseudos.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');

/* =========================
   CONFIG ROLES (TES IDS)
========================= */

// Rôles hiérarchiques (un seul sera pris)
const ROLE_HIERARCHY = [
  { id: '1393784275853246666', label: 'PRÉSIDENT' },
  { id: '1393891243368386641', label: 'GM' },
  { id: '1393891684752031814', label: 'coGM' },
  { id: '1393892611382575185', label: 'STAFF' },
  { id: '1393892474170114169', label: 'HoF' },
  { id: '1393892334613172275', label: 'DEP' },
  { id: '1393785087132172429', label: 'NEW' },
  { id: '1393784530124668988', label: 'IGA' },
  { id: '1393784904809975850', label: 'TEST' }
];

// Équipes
const TEAM_ROLES = [
  { id: '1423016118448296056', label: 'A' },
  { id: '1423016177751429191', label: 'B' },
  { id: '1423016222659706992', label: 'C' }
];

// Postes (max 3)
const POSTE_ROLES = [
  { id: '1429389198531498085', label: 'GK' },
  { id: '1429389245935779953', label: 'DC' },
  { id: '1429389286742036560', label: 'DG' },
  { id: '1444317466468810854', label: 'DD' },
  { id: '1429389418958946346', label: 'MDC' },
  { id: '1429389494863532062', label: 'MC' },
  { id: '1429389702842290206', label: 'MG' },
  { id: '1444317534084923392', label: 'MD' },
  { id: '1429389840767516794', label: 'MOC' },
  { id: '1429389901157236806', label: 'AG' },
  { id: '1444317591781769217', label: 'AD' },
  { id: '1429389946183090377', label: 'BU' },
  { id: '1444317669859004518', label: 'ATG' },
  { id: '1444317741505974333', label: 'ATD' }
];

/* =========================
   UTILITAIRES
========================= */

function getHierarchy(member) {
  const found = ROLE_HIERARCHY.find(r => member.roles.cache.has(r.id));
  return found ? found.label : null;
}

function getTeam(member) {
  const found = TEAM_ROLES.find(r => member.roles.cache.has(r.id));
  return found ? found.label : null;
}

function getPostes(member) {
  return POSTE_ROLES
    .filter(p => member.roles.cache.has(p.id))
    .map(p => p.label)
    .slice(0, 3);
}

function cleanUsername(username) {
  return username.replace(/[^A-Za-z0-9]/g, '');
}

function buildNickname(member) {
  const hierarchy = getHierarchy(member);
  const team = getTeam(member);
  const postes = getPostes(member);
  const pseudo = cleanUsername(member.user.username);

  const parts = [];

  parts.push('XIG');

  if (hierarchy) parts.push(hierarchy);
  parts.push(pseudo);

  if (postes.length) parts.push(`| ${postes.join('/')}`);
  if (team) parts.push(`| ${team}`);

  return parts.join(' ').slice(0, 32); // limite Discord
}

/* =========================
   COMMANDE
========================= */

module.exports = {
  data: new SlashCommandBuilder()
    .setName('synchroniser_pseudos')
    .setDescription('Synchronise les pseudos au format XIG RÔLE Pseudo | Poste | Team')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addBooleanOption(o =>
      o.setName('simulation')
        .setDescription('Simulation seulement (true par défaut)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const simulation = interaction.options.getBoolean('simulation') ?? true;

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return interaction.reply({
        content: '❌ Je n’ai pas la permission de gérer les pseudos.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.reply({
      content: simulation ? '🧪 Simulation en cours…' : '🔧 Synchronisation en cours…',
      flags: MessageFlags.Ephemeral
    });

    await interaction.guild.members.fetch();

    const members = interaction.guild.members.cache.filter(m => !m.user.bot);

    let changes = [];
    let unchanged = [];
    let blocked = [];

    for (const member of members.values()) {
      const newNick = buildNickname(member);
      const current = member.nickname || member.user.username;

      if (current === newNick) {
        unchanged.push(member);
        continue;
      }

      if (!member.manageable) {
        blocked.push(member);
        continue;
      }

      if (!simulation) {
        try {
          await member.setNickname(newNick, 'Synchronisation XIG');
        } catch {
          blocked.push(member);
          continue;
        }
      }

      changes.push(`${member.user.tag} → ${newNick}`);
    }

    return interaction.followUp({
      content: [
        simulation ? '🧪 **SIMULATION TERMINÉE**' : '✅ **SYNCHRONISATION TERMINÉE**',
        `✅ Modifiés : ${changes.length}`,
        `⏭️ Déjà conformes : ${unchanged.length}`,
        `🔒 Non modifiables : ${blocked.length}`,
        '',
        changes.slice(0, 20).join('\n')
      ].join('\n'),
      flags: MessageFlags.Ephemeral
    });
  }
};
