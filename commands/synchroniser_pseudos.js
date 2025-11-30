// commands/synchroniser_pseudos.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');

const { getConfigFromInteraction } = require('../utils/config');

/* =========================
   CONFIG ROLES (TES IDS)
========================= */

// Rôles hiérarchiques (du plus haut au plus bas)
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

// Postes
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

const MAX_LEN = 32;
const SLEEP_MS = 350;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* =========================
   UTILITAIRES
========================= */

// Pseudo : première lettre en majuscule, pas de chiffres/caractères spéciaux
function cleanPseudo(username, room = MAX_LEN) {
  if (!username) return 'Joueur';

  // Supprime tout sauf lettres
  let clean = username.replace(/[^A-Za-z]/g, '');
  if (!clean.length) return 'Joueur';

  clean = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();

  if (clean.length > room) {
    clean = clean.slice(0, room - 1) + '…';
  }
  return clean;
}

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

/**
 * Construit le pseudo :
 * TAG RÔLE Pseudo | Poste1/Poste2/Poste3 | A/B/C
 */
function buildNickname(member, tagFromConfig) {
  const tag = tagFromConfig || 'XIG';
  const hierarchy = getHierarchy(member);
  const team = getTeam(member);
  const postes = getPostes(member);

  // On prépare d'abord sans se soucier de la taille
  const pseudoBase = cleanPseudo(member.user.username, MAX_LEN);
  let base = `${tag}${hierarchy ? ' ' + hierarchy : ''} ${pseudoBase}`.trim();

  let suffixParts = [];
  if (postes.length) suffixParts.push(postes.join('/'));
  if (team) suffixParts.push(team);

  let full = base;
  if (suffixParts.length) {
    full += ' | ' + suffixParts.join(' | ');
  }

  // Si on dépasse 32, on réduit le pseudo en priorité
  if (full.length > MAX_LEN) {
    const fixedPrefix = `${tag}${hierarchy ? ' ' + hierarchy : ''}`.trim();
    const suffix = suffixParts.length ? ' | ' + suffixParts.join(' | ') : '';

    const roomForPseudo = Math.max(
      3,
      MAX_LEN - (fixedPrefix.length ? fixedPrefix.length + 1 : 0) - suffix.length
    );

    const trimmedPseudo = cleanPseudo(member.user.username, roomForPseudo);
    full = fixedPrefix.length
      ? `${fixedPrefix} ${trimmedPseudo}${suffix}`
      : `${trimmedPseudo}${suffix}`;
  }

  return full.slice(0, MAX_LEN);
}

/* =========================
   COMMANDE
========================= */

module.exports = {
  data: new SlashCommandBuilder()
    .setName('synchroniser_pseudos')
    .setDescription('Synchronise les pseudos au format : TAG RÔLE Pseudo | Poste1/Poste2/Poste3 | A/B/C')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addBooleanOption(o =>
      o.setName('simulation')
        .setDescription('Simulation uniquement (par défaut : oui)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const simulation = interaction.options.getBoolean('simulation') ?? true;

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return interaction.reply({
        content: '❌ Je n’ai pas la permission **Gérer les pseudos** sur ce serveur.',
        flags: MessageFlags.Ephemeral
      });
    }

    // Récupération du tag via la config serveur (servers.json)
    const { guild: guildConfig } = getConfigFromInteraction(interaction) || {};
    const tag = guildConfig?.tag || 'XIG';

    await interaction.reply({
      content: simulation
        ? `🧪 Simulation de synchronisation des pseudos en cours… (tag : **${tag}**)`
        : `🔧 Synchronisation des pseudos en cours… (tag : **${tag}**)`,
      flags: MessageFlags.Ephemeral
    });

    await interaction.guild.members.fetch().catch(() => {});
    const members = interaction.guild.members.cache.filter(m => !m.user.bot);

    const changes = [];
    const unchanged = [];
    const blocked = [];
    const errors = [];

    for (const member of members.values()) {
      const newNick = buildNickname(member, tag);
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
          await member.setNickname(newNick, 'Synchronisation pseudos XIG');
          await sleep(SLEEP_MS);
        } catch (e) {
          errors.push({ member, err: String(e?.message || e) });
          continue;
        }
      }

      changes.push({ member, from: current, to: newNick });
    }

    const preview = changes
      .slice(0, 25)
      .map(c => `• ${c.member.user.tag} : "${c.from}" → "${c.to}"`)
      .join('\n') || 'Aucun pseudo modifié.';

    await interaction.followUp({
      content: [
        simulation ? '🧪 **SIMULATION TERMINÉE**' : '✅ **SYNCHRONISATION TERMINÉE**',
        `✅ Modifiés : ${changes.length}`,
        `⏭️ Déjà conformes : ${unchanged.length}`,
        `🔒 Non modifiables (hiérarchie / permissions) : ${blocked.length}`,
        errors.length ? `❌ Erreurs : ${errors.length}` : '',
        '',
        '```',
        preview,
        changes.length > 25 ? `\n... (+${changes.length - 25} autres)` : '',
        '```'
      ].filter(Boolean).join('\n'),
      flags: MessageFlags.Ephemeral
    });
  }
};
