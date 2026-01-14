// commands/synchroniser_pseudos.js
// ✅ Synchroniser Pseudos — VERSION OPTIMISÉE, SIMPLE, INTUITIVE
//
// Objectif : synchroniser les pseudos selon servers.json (nickname.*) + buildNickname()
// Points clés :
// - Simulation par défaut (sécurisé).
// - Options claires : simulation, limite, délai, ignorer membres non gérables, sortie détaillée.
// - Vérifie permissions + hiérarchie (member.manageable).
// - Résumé + aperçu (preview) + logs d’erreurs propres.
// - Rate-limit basique via delay configurable.
//
// Dépendances :
// - utils/config -> getConfigFromInteraction
// - utils/nickname -> buildNickname

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField
} = require('discord.js');

const { getConfigFromInteraction } = require('../utils/config');
const { buildNickname } = require('../utils/nickname');

/* ===================== Constantes ===================== */
const DEFAULT_SLEEP_MS = 350;
const DEFAULT_LIMIT = 0; // 0 = illimité
const PREVIEW_MAX_LINES = 25;
const PREVIEW_MAX_CHARS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ===================== Helpers ===================== */
function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function safeStr(s) {
  return String(s ?? '').trim();
}

function canManageNicknames(me) {
  return me?.permissions?.has?.(PermissionFlagsBits.ManageNicknames);
}

function hasNicknameConfig(nicknameCfg) {
  return !!(
    (Array.isArray(nicknameCfg?.hierarchy) && nicknameCfg.hierarchy.length) ||
    (Array.isArray(nicknameCfg?.teams) && nicknameCfg.teams.length) ||
    (Array.isArray(nicknameCfg?.postes) && nicknameCfg.postes.length)
  );
}

function buildPreview(changes) {
  const lines = changes.slice(0, PREVIEW_MAX_LINES).map(c => {
    const tag = c.member?.user?.tag || c.member?.id || 'unknown';
    return `• ${tag} : "${c.from}" → "${c.to}"`;
  });

  let out = lines.join('\n') || 'Aucun pseudo modifié.';
  if (changes.length > PREVIEW_MAX_LINES) {
    out += `\n... (+${changes.length - PREVIEW_MAX_LINES} autres)`;
  }
  if (out.length > PREVIEW_MAX_CHARS) out = out.slice(0, PREVIEW_MAX_CHARS - 1) + '…';
  return out;
}

/**
 * Renvoie le "pseudo actuel" comparable :
 * - nickname si défini sinon username
 */
function currentDisplayName(member) {
  return member.nickname || member.user.username;
}

/**
 * Contrôle permissions minimales dans le salon où la commande est lancée (optionnel mais utile)
 * Ici on se contente des permissions globales du bot pour ManageNicknames,
 * mais on valide aussi qu'il peut voir le serveur et que me existe.
 */
async function fetchMeSafe(guild) {
  return guild.members.me || (await guild.members.fetchMe().catch(() => null));
}

/* ===================== Commande ===================== */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('synchroniser_pseudos')
    .setDescription('Synchronise les pseudos selon le format configuré dans servers.json (nickname.format).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)

    .addBooleanOption(o =>
      o.setName('simulation')
        .setDescription('Simulation uniquement (défaut : oui).')
        .setRequired(false)
    )

    .addIntegerOption(o =>
      o.setName('limite')
        .setDescription('Nombre maximum de pseudos à modifier (0 = illimité).')
        .setMinValue(0)
        .setMaxValue(5000)
        .setRequired(false)
    )

    .addIntegerOption(o =>
      o.setName('delai_ms')
        .setDescription('Délai entre chaque modification (anti rate-limit). Défaut: 350ms.')
        .setMinValue(0)
        .setMaxValue(2000)
        .setRequired(false)
    )

    .addBooleanOption(o =>
      o.setName('inclure_non_manageable')
        .setDescription('Inclure les membres non modifiables dans le rapport (défaut : oui).')
        .setRequired(false)
    )

    .addBooleanOption(o =>
      o.setName('details')
        .setDescription('Afficher aussi un aperçu des changements (défaut : oui).')
        .setRequired(false)
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({
        content: '❌ Cette commande doit être utilisée dans un serveur.',
        ephemeral: true
      }).catch(() => {});
    }

    const simulation = interaction.options.getBoolean('simulation') ?? true;
    const limit = clampInt(interaction.options.getInteger('limite'), 0, 5000, DEFAULT_LIMIT);
    const sleepMs = clampInt(interaction.options.getInteger('delai_ms'), 0, 2000, DEFAULT_SLEEP_MS);
    const includeBlocked = interaction.options.getBoolean('inclure_non_manageable') ?? true;
    const showDetails = interaction.options.getBoolean('details') ?? true;

    const me = await fetchMeSafe(guild);
    if (!me || !canManageNicknames(me)) {
      return interaction.reply({
        content: '❌ Je n’ai pas la permission **Gérer les pseudos** sur ce serveur.',
        ephemeral: true
      }).catch(() => {});
    }

    // (Optionnel) Vérifie la permission du bot au niveau guilde
    // La permission ManageNicknames peut être bloquée par la hiérarchie des rôles côté membre (member.manageable)
    // => on gère plus bas.

    const cfgPack = getConfigFromInteraction(interaction) || {};
    const guildConfig = cfgPack.guild || {};
    const nicknameCfg = guildConfig.nickname || {};

    if (!hasNicknameConfig(nicknameCfg)) {
      return interaction.reply({
        content:
          '❌ Config pseudos manquante dans `servers.json`.\n' +
          'Attendu au minimum : `nickname.hierarchy` et/ou `nickname.teams` et/ou `nickname.postes`.',
        ephemeral: true
      }).catch(() => {});
    }

    const format = safeStr(nicknameCfg.format) || '{PSEUDO} | {MID} | {POSTES}';

    await interaction.reply({
      content: [
        simulation ? '🧪 Simulation de synchronisation en cours…' : '🔧 Synchronisation en cours…',
        `📌 Format actif : \`${format}\``,
        limit ? `🧩 Limite : ${limit}` : '🧩 Limite : illimitée',
        `⏱️ Délai : ${sleepMs}ms`
      ].join('\n'),
      ephemeral: true
    }).catch(() => {});

    // Fetch members pour fiabiliser la cache
    await guild.members.fetch().catch(() => {});

    const members = guild.members.cache.filter(m => !m.user.bot);

    const changes = [];
    const unchanged = [];
    const blocked = [];
    const errors = [];

    let processed = 0;

    for (const member of members.values()) {
      // limite (uniquement pour les changements)
      if (limit > 0 && changes.length >= limit) break;

      processed++;

      let newNick = '';
      try {
        newNick = buildNickname(member, nicknameCfg, guildConfig);
      } catch (e) {
        errors.push({ member, err: `buildNickname() : ${String(e?.message || e)}` });
        continue;
      }

      newNick = safeStr(newNick);
      if (!newNick) {
        // si buildNickname renvoie vide, on n'applique rien (sécurité)
        unchanged.push(member);
        continue;
      }

      const current = currentDisplayName(member);

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
          await member.setNickname(newNick, 'Synchronisation pseudos (manuel)');
          if (sleepMs) await sleep(sleepMs);
        } catch (e) {
          errors.push({ member, err: String(e?.message || e) });
          continue;
        }
      }

      changes.push({ member, from: current, to: newNick });
    }

    const header = simulation ? '🧪 **SIMULATION TERMINÉE**' : '✅ **SYNCHRONISATION TERMINÉE**';

    const lines = [
      header,
      `📌 Format : \`${format}\``,
      `👥 Membres analysés : ${members.size}`,
      `✅ À modifier : ${changes.length}`,
      `⏭️ Déjà conformes : ${unchanged.length}`,
      includeBlocked ? `🔒 Non modifiables : ${blocked.length}` : null,
      errors.length ? `❌ Erreurs : ${errors.length}` : null
    ].filter(Boolean);

    // Avertissement si limit stop
    if (limit > 0 && changes.length >= limit) {
      lines.push(`⚠️ Limite atteinte (${limit}). Relance la commande si besoin.`);
    }

    // Détails (preview)
    if (showDetails) {
      lines.push('');
      lines.push('```');
      lines.push(buildPreview(changes));
      lines.push('```');
    }

    // On ajoute une mini note si blocked masqué
    if (!includeBlocked && blocked.length) {
      lines.push('');
      lines.push(`ℹ️ ${blocked.length} membre(s) non modifiable(s) existent mais sont masqués (option inclure_non_manageable=false).`);
    }

    return interaction.followUp({
      content: lines.join('\n'),
      ephemeral: true
    }).catch(() => {});
  }
};
