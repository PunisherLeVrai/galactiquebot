const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');

const SEP_MAIN = ' ';
const SEP_PARTS = ' | ';
const MAX_LEN = 32;
const SLEEP_MS = 350;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* =========================
   RÔLES HIÉRARCHIQUES XIG
========================= */
const HIERARCHY_ROLES = [
  { id: '1393784275853246666', label: 'PRÉSIDENT', prio: 100 },
  { id: '1393891243368386641', label: 'GM', prio: 95 },
  { id: '1393891684752031814', label: 'coGM', prio: 90 },
  { id: '1393892611382575185', label: 'STAFF', prio: 80 },
  { id: '1393892474170114169', label: 'HoF', prio: 70 },
  { id: '1393892334613172275', label: 'DEP', prio: 60 },
  { id: '1393785087132172429', label: 'NEW', prio: 50 },
  { id: '1393784530124668988', label: 'IGA', prio: 40 },
  { id: '1393784904809975850', label: 'TEST', prio: 30 }
];

/* =========================
   RÔLES ÉQUIPES A / B / C
========================= */
const TEAM_ROLES = [
  { id: '1423016118448296056', label: 'A' },
  { id: '1423016177751429191', label: 'B' },
  { id: '1423016222659706992', label: 'C' }
];

/* =========================
   RÔLES POSTES (MAX 3)
========================= */
const POSTE_ROLES = [
  { id: '1429389198531498085', label: 'GK', prio: 100 },
  { id: '1429389245935779953', label: 'DC', prio: 95 },
  { id: '1429389286742036560', label: 'DG', prio: 90 },
  { id: '1444317466468810854', label: 'DD', prio: 90 },
  { id: '1429389418958946346', label: 'MDC', prio: 85 },
  { id: '1429389494863532062', label: 'MC', prio: 80 },
  { id: '1429389702842290206', label: 'MG', prio: 75 },
  { id: '1444317534084923392', label: 'MD', prio: 75 },
  { id: '1429389840767516794', label: 'MOC', prio: 70 },
  { id: '1429389901157236806', label: 'AG', prio: 65 },
  { id: '1444317591781769217', label: 'AD', prio: 65 },
  { id: '1429389946183090377', label: 'BU', prio: 60 },
  { id: '1444317669859004518', label: 'ATG', prio: 55 },
  { id: '1444317741505974333', label: 'ATD', prio: 55 }
];

/* =========================
   OUTILS
========================= */
function getHighestRole(member) {
  return HIERARCHY_ROLES
    .filter(r => member.roles.cache.has(r.id))
    .sort((a, b) => b.prio - a.prio)[0]?.label || 'JOUEUR';
}

function getTeam(member) {
  return TEAM_ROLES.find(t => member.roles.cache.has(t.id))?.label || null;
}

function getPostes(member) {
  const postes = POSTE_ROLES
    .filter(p => member.roles.cache.has(p.id))
    .sort((a, b) => b.prio - a.prio)
    .slice(0, 3)
    .map(p => p.label);
  return postes;
}

function cleanUsername(username, room) {
  let clean = username.replace(/[^A-Za-z]/g, '');
  clean = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  if (clean.length > room) clean = clean.slice(0, room - 1);
  return clean || 'XIG';
}

function buildNick({ role, username, postes, team }) {
  const base = `XIG${SEP_MAIN}${role}`;
  const after = [
    postes.length ? postes.join('/') : null,
    team
  ].filter(Boolean).join(SEP_PARTS);

  const fixedLen = base.length + SEP_MAIN.length + SEP_PARTS.length + after.length;
  const roomForPseudo = Math.max(3, MAX_LEN - fixedLen);
  const pseudo = cleanUsername(username, roomForPseudo);

  return `${base}${SEP_MAIN}${pseudo}${SEP_PARTS}${after}`.slice(0, MAX_LEN);
}

/* =========================
   COMMANDE
========================= */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('synchroniser_pseudos')
    .setDescription('Synchronise les pseudos au format XIG RÔLE Pseudo | Postes | A/B/C')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addBooleanOption(o =>
      o.setName('simulation')
        .setDescription('Aperçu sans appliquer (défaut : oui)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const simulation = interaction.options.getBoolean('simulation') ?? true;
    await interaction.reply({
      content: simulation ? '🧪 Simulation en cours…' : '🔧 Synchronisation en cours…',
      flags: MessageFlags.Ephemeral
    });

    await interaction.guild.members.fetch().catch(() => {});
    const members = interaction.guild.members.cache.filter(m => !m.user.bot);

    const changes = [];
    let ok = 0;

    for (const m of members.values()) {
      const role = getHighestRole(m);
      const team = getTeam(m);
      const postes = getPostes(m);
      if (!team || !postes.length) continue;

      const newNick = buildNick({
        role,
        username: m.user.username,
        postes,
        team
      });

      const current = m.nickname || m.user.username;
      if (current !== newNick) {
        changes.push({ member: m, from: current, to: newNick });
      }
    }

    if (simulation) {
      const preview = changes.slice(0, 20)
        .map(c => `• ${c.member.user.tag} → ${c.to}`)
        .join('\n') || 'Aucun changement';

      return interaction.followUp({
        content: `🧪 ${changes.length} pseudos seraient modifiés\n\`\`\`\n${preview}\n\`\`\``,
        flags: MessageFlags.Ephemeral
      });
    }

    for (const c of changes) {
      if (!c.member.manageable) continue;
      try {
        await c.member.setNickname(c.to, 'Sync pseudos XIG');
        ok++;
        await sleep(SLEEP_MS);
      } catch {}
    }

    return interaction.followUp({
      content: `✅ Synchronisation terminée — ${ok} pseudos modifiés.`,
      flags: MessageFlags.Ephemeral
    });
  }
};
