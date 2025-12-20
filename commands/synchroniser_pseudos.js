// commands/synchroniser_pseudos.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

const { getConfigFromInteraction } = require('../utils/config');

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

  if (clean.length > room) clean = clean.slice(0, room - 1) + '…';
  return clean;
}

function getHierarchy(member, hierarchyRoles = []) {
  const found = hierarchyRoles.find(r => member.roles.cache.has(r.id));
  return found ? found.label : null;
}

function getTeam(member, teamRoles = []) {
  const found = teamRoles.find(r => member.roles.cache.has(r.id));
  return found ? found.label : null;
}

function getPostes(member, posteRoles = []) {
  return posteRoles
    .filter(p => member.roles.cache.has(p.id))
    .map(p => p.label)
    .slice(0, 3);
}

/**
 * Construit le pseudo :
 * TAG RÔLE Pseudo | Poste1/Poste2/Poste3 | A/B/C
 */
function buildNickname(member, tagFromConfig, hierarchyRoles, teamRoles, posteRoles) {
  const tag = tagFromConfig || 'XIG';
  const hierarchy = getHierarchy(member, hierarchyRoles);
  const team = getTeam(member, teamRoles);
  const postes = getPostes(member, posteRoles);

  const pseudoBase = cleanPseudo(member.user.username, MAX_LEN);
  let base = `${tag}${hierarchy ? ' ' + hierarchy : ''} ${pseudoBase}`.trim();

  const suffixParts = [];
  if (postes.length) suffixParts.push(postes.join('/'));
  if (team) suffixParts.push(team);

  let full = base;
  if (suffixParts.length) full += ' | ' + suffixParts.join(' | ');

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
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({
        content: '❌ Cette commande doit être utilisée dans un serveur.',
        ephemeral: true
      });
    }

    const simulation = interaction.options.getBoolean('simulation') ?? true;

    const me = guild.members.me;
    if (!me?.permissions?.has?.(PermissionFlagsBits.ManageNicknames)) {
      return interaction.reply({
        content: '❌ Je n’ai pas la permission **Gérer les pseudos** sur ce serveur.',
        ephemeral: true
      });
    }

    // 🔧 Récupération de la config serveur (tag + mapping des rôles)
    const { guild: guildConfig } = getConfigFromInteraction(interaction) || {};
    const tag = guildConfig?.tag || 'XIG';

    const nicknameCfg = guildConfig?.nickname || {};
    const hierarchyRoles = Array.isArray(nicknameCfg.hierarchy) ? nicknameCfg.hierarchy : [];
    const teamRoles = Array.isArray(nicknameCfg.teams) ? nicknameCfg.teams : [];
    const posteRoles = Array.isArray(nicknameCfg.postes) ? nicknameCfg.postes : [];

    if (!hierarchyRoles.length && !teamRoles.length && !posteRoles.length) {
      return interaction.reply({
        content:
          '❌ La configuration des rôles pour les pseudos est manquante dans `servers.json` (`nickname.hierarchy`, `nickname.teams`, `nickname.postes`).',
        ephemeral: true
      });
    }

    await interaction.reply({
      content: simulation
        ? `🧪 Simulation de synchronisation des pseudos en cours… (tag : **${tag}**)`
        : `🔧 Synchronisation des pseudos en cours… (tag : **${tag}**)`,
      ephemeral: true
    });

    await guild.members.fetch().catch(() => {});
    const members = guild.members.cache.filter(m => !m.user.bot);

    const changes = [];
    const unchanged = [];
    const blocked = [];
    const errors = [];

    for (const member of members.values()) {
      const newNick = buildNickname(member, tag, hierarchyRoles, teamRoles, posteRoles);
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

    // ⚠️ Protection longueur message (Discord)
    const makePreview = () => {
      const lines = changes
        .slice(0, 25)
        .map(c => `• ${c.member.user.tag} : "${c.from}" → "${c.to}"`);

      let preview = lines.join('\n') || 'Aucun pseudo modifié.';
      if (changes.length > 25) preview += `\n... (+${changes.length - 25} autres)`;
      return preview.slice(0, 1500); // garde une marge
    };

    await interaction.followUp({
      content: [
        simulation ? '🧪 **SIMULATION TERMINÉE**' : '✅ **SYNCHRONISATION TERMINÉE**',
        `✅ Modifiés : ${changes.length}`,
        `⏭️ Déjà conformes : ${unchanged.length}`,
        `🔒 Non modifiables (hiérarchie / permissions) : ${blocked.length}`,
        errors.length ? `❌ Erreurs : ${errors.length}` : '',
        '',
        '```',
        makePreview(),
        '```'
      ].filter(Boolean).join('\n'),
      ephemeral: true
    });
  }
};
