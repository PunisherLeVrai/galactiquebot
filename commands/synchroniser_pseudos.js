// commands/synchroniser_pseudos.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');

const SEP = ' | ';
const MAX_LEN = 32;
const SLEEP_MS = 350;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * ⚠️ Seule commande autorisée à contenir des IDs en dur.
 * Adapter ces IDs aux rôles POSTE / ÉQUIPE de ton serveur si besoin.
 */
const POSTE_ROLES = [
  { id: '1429389198531498085', label: 'GK', prio: 100 },
  { id: '1429389245935779953', label: 'DC', prio: 95 },
  { id: '1429389286742036560', label: 'DG/DD', prio: 90 },
  { id: '1429389418958946346', label: 'MDC', prio: 85 },
  { id: '1429389494863532062', label: 'MC', prio: 80 },
  { id: '1429389702842290206', label: 'MG/MD', prio: 75 },
  { id: '1429389840767516794', label: 'MOC', prio: 70 },
  { id: '1429389901157236806', label: 'AG/AD', prio: 65 },
  { id: '1429389946183090377', label: 'BU', prio: 60 },
];

const TEAM_ROLES = [
  { id: '1423016118448296056', label: 'A' },
  { id: '1423016177751429191', label: 'B' },
  { id: '1423016222659706992', label: 'C' },
];

/** Détecte le numéro de maillot depuis les rôles (nom de rôle "1" à "99"). */
function getNumero(member) {
  const nums = [];
  for (const [, role] of member.roles.cache) {
    const m = role.name && role.name.match(/^([1-9]\d?)$/); // 1..99
    if (m) nums.push(parseInt(m[1], 10));
  }
  if (!nums.length) return null;
  nums.sort((a, b) => a - b); // prend le plus petit si plusieurs
  return String(nums[0]);
}

/** Récupère les postes (max 2, selon priorité) */
function getPostes(member) {
  const owned = POSTE_ROLES
    .filter(p => member.roles.cache.has(p.id))
    .sort((a, b) => (b.prio || 0) - (a.prio || 0))
    .map(p => p.label);

  const unique = [];
  for (const l of owned) {
    if (!unique.includes(l)) unique.push(l);
    if (unique.length >= 2) break;
  }
  return unique;
}

/** Récupère la team A/B/C s’il en a une */
function getTeamSuffix(member) {
  const t = TEAM_ROLES.find(tr => member.roles.cache.has(tr.id));
  return t ? t.label : null;
}

/** Nettoie le username (lettres uniquement) + Maj au début */
function cleanUsername(username, room = MAX_LEN) {
  if (!username) return 'Joueur';
  let clean = username.replace(/[^A-Za-z]/g, '');
  clean = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  if (clean.length > room) clean = clean.slice(0, room - 1) + '…';
  return clean;
}

/** Construit le pseudo final : Numéro | Pseudo | POSTE1/POSTE2 | Équipe */
function buildNick({ numero, username, postes, team }) {
  const parts = [];
  if (numero) parts.push(numero);                // Numéro
  const pseudo = cleanUsername(username, MAX_LEN);
  parts.push(pseudo);                            // Pseudo
  if (postes.length) parts.push(postes.join('/')); // POSTE1/POSTE2
  if (team) parts.push(team);                      // Équipe

  let full = parts.join(SEP);
  if (full.length > MAX_LEN) {
    const before = [];
    if (numero) before.push(numero);
    const after = [];
    if (postes.length) after.push(postes.join('/'));
    if (team) after.push(team);

    const fixedLen =
      (before.join(SEP) + (before.length ? SEP : '')).length +
      (after.length ? (SEP + after.join(SEP)).length : 0);

    const roomForPseudo = Math.max(3, MAX_LEN - fixedLen);
    const trimmedPseudo = cleanUsername(username, roomForPseudo);

    full =
      (before.length ? before.join(SEP) + SEP : '') +
      trimmedPseudo +
      (after.length ? SEP + after.join(SEP) : '');
  }
  return full;
}

/** Sélectionne les membres à traiter selon la cible / rôles fournis */
function selectTargets(guild, cible, roleFilterId, roleJoueurId, roleEssaiId) {
  let members = guild.members.cache.filter(m => !m.user.bot);

  if (cible === 'tout_le_monde') return members;

  if (cible === 'par_role' && roleFilterId) {
    return members.filter(m => m.roles.cache.has(roleFilterId));
  }

  if (cible === 'joueurs_essai' && (roleJoueurId || roleEssaiId)) {
    return members.filter(m =>
      (roleJoueurId && m.roles.cache.has(roleJoueurId)) ||
      (roleEssaiId && m.roles.cache.has(roleEssaiId))
    );
  }

  // Sécurité : si mauvaise config → on ne filtre pas
  return members;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('synchroniser_pseudos')
    .setDescription('Met à jour les pseudos : Numéro | Pseudo | POSTE1/POSTE2 | Équipe (max 32).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addBooleanOption(o =>
      o.setName('simulation')
        .setDescription('Aperçu sans modifier (par défaut : oui)')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('cible')
        .setDescription('Qui traiter ?')
        .addChoices(
          { name: 'Tout le monde (hors bots) — défaut', value: 'tout_le_monde' },
          { name: 'Joueurs + Essai (via rôles fournis)', value: 'joueurs_essai' },
          { name: 'Membres d’un rôle précis', value: 'par_role' }
        )
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('role_cible')
        .setDescription('Rôle à traiter si cible = par_role')
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('role_joueur')
        .setDescription('Rôle Joueur pour cible = Joueurs + Essai')
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('role_essai')
        .setDescription('Rôle Essai pour cible = Joueurs + Essai')
        .setRequired(false)
    ),

  async execute(interaction) {
    const simulation = interaction.options.getBoolean('simulation') ?? true;
    const cible = interaction.options.getString('cible') || 'tout_le_monde';
    const roleCible = interaction.options.getRole('role_cible') || null;
    const roleJoueur = interaction.options.getRole('role_joueur') || null;
    const roleEssai = interaction.options.getRole('role_essai') || null;

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return interaction.reply({
        content: '❌ Permission manquante : **Gérer les pseudos**.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (cible === 'par_role' && !roleCible) {
      return interaction.reply({
        content: '❌ `cible: par_role` nécessite de renseigner `role_cible`.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (cible === 'joueurs_essai' && !roleJoueur && !roleEssai) {
      return interaction.reply({
        content: '❌ Pour `cible: joueurs_essai`, fournis au moins `role_joueur` ou `role_essai`.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.reply({
      content: `${simulation ? '🧪 **Simulation**' : '🔧 **Mise à jour**'} des pseudos en cours…`,
      flags: MessageFlags.Ephemeral
    });

    await interaction.guild.members.fetch().catch(() => {});
    const targets = selectTargets(
      interaction.guild,
      cible,
      roleCible?.id,
      roleJoueur?.id,
      roleEssai?.id
    );

    const changes = [];
    const noChange = [];
    const unmanageable = [];
    const errors = [];

    for (const m of targets.values()) {
      const username = m.user.username || '';
      const numero = getNumero(m);
      const postes = getPostes(m);
      const team = getTeamSuffix(m);

      const newNick = buildNick({ numero, username, postes, team });
      const current = m.nickname || m.user.username;

      if (current === newNick) {
        noChange.push(m);
        continue;
      }
      changes.push({ member: m, from: current, to: newNick });
    }

    // MODE SIMULATION
    if (simulation) {
      const preview = changes
        .slice(0, 25)
        .map(c => `• ${c.member.user.tag} : "${c.from}" → "${c.to}"`)
        .join('\n') || 'Aucun changement';

      await interaction.followUp({
        content: [
          `🧪 **Simulation** — ${changes.length} pseudo(s) changeraient (${targets.size} cibles).`,
          `🔁 Déjà conformes : ${noChange.length}`,
          '```',
          preview,
          changes.length > 25 ? `\n... (+${changes.length - 25} autres)` : '',
          '```'
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // APPLICATION RÉELLE
    let ok = 0, fail = 0;
    for (const c of changes) {
      try {
        if (!c.member.manageable) {
          unmanageable.push(c.member);
          continue;
        }
        await c.member.setNickname(c.to, 'Synchronisation pseudos — INTER GALACTIQUE');
        ok++;
        await sleep(SLEEP_MS);
      } catch (e) {
        errors.push({ member: c.member, err: String(e?.message || e) });
        fail++;
      }
    }

    const lines = [
      `✅ Modifiés : ${ok}`,
      `⏭️ Déjà conformes : ${noChange.length}`,
      `🔒 Ignorés (hiérarchie) : ${unmanageable.length}`,
      `❌ Erreurs : ${fail}`,
    ];

    if (unmanageable.length) {
      lines.push('\n🔒 **Non gérables :**');
      lines.push(unmanageable.map(m => `- ${m.user.tag}`).join('\n'));
    }
    if (errors.length) {
      lines.push('\n❌ **Erreurs :**');
      lines.push(errors.map(e => `- ${e.member.user.tag}: ${e.err}`).join('\n'));
    }

    await interaction.followUp({
      content: lines.join('\n'),
      flags: MessageFlags.Ephemeral
    });
  }
};