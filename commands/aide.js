// commands/aide.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionsBitField
} = require('discord.js');

const { getGlobalConfig, getConfigFromInteraction } = require('../utils/config');

const DEFAULT_COLOR = 0xff4db8;
const MAX_SELECT_OPTIONS = 25; // limite Discord
const MAX_COMMAND_OPTIONS_IN_MENU = MAX_SELECT_OPTIONS - 1; // -1 pour "Vue d’ensemble"

/* ---------- Couleur par serveur ---------- */
function getEmbedColorFromCfg(guildCfg) {
  const hex = guildCfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;

  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

/* ---------- Catégorisation automatique ---------- */
function detectCategory(name, description = '') {
  const n = (name || '').toLowerCase();
  const d = (description || '').toLowerCase();

  const dispoKeys = [
    'dispo', 'dispos',
    'publier_dispos', 'modifier_dispos', 'reinitialiser_dispos',
    'verrouiller_dispos', 'rouvrir_dispos',
    'rappel', 'rappel_absents',
    'rapport', 'generer_rapport',
    'verifier', 'verifiersemaine', 'verifier_semaine', 'mentionabsents'
  ];
  if (dispoKeys.some(k => n.includes(k))) return { label: '⚽️ Disponibilités', key: 'dispo' };

  if (
    n.includes('pseudo') ||
    n.includes('nick') ||
    n.includes('alias') ||
    n.includes('synchroniser_pseudos') ||
    d.includes('pseudo')
  ) {
    return { label: '👤 Gestion des joueurs', key: 'joueurs' };
  }

  const staffKeys = ['aide', 'setup', 'clean', 'status', 'config', 'reglement', 'annonce', 'communique'];
  if (staffKeys.some(k => n.includes(k))) return { label: '🛠️ Outils du staff', key: 'staff' };

  return { label: '🚀 Autres commandes', key: 'autres' };
}

/* ---------- Outils de formatage ---------- */
const typeLabel = (t) => {
  const map = {
    3: 'Texte',
    4: 'Nombre entier',
    10: 'Décimal',
    5: 'Booléen',
    6: 'Utilisateur',
    7: 'Salon',
    8: 'Rôle',
    9: 'Mentionnable',
    11: 'Fichier'
  };
  return map[t] || `Type ${t}`;
};

function permsToHuman(permBits) {
  if (!permBits) return '_Aucune (accessible à tous)_';

  try {
    const p = new PermissionsBitField(permBits);
    const names = [];

    if (p.has(PermissionsBitField.Flags.Administrator)) names.push('Administrateur');
    if (p.has(PermissionsBitField.Flags.ManageGuild)) names.push('Gérer le serveur');
    if (p.has(PermissionsBitField.Flags.ManageNicknames)) names.push('Gérer les pseudos');
    if (p.has(PermissionsBitField.Flags.ModerateMembers)) names.push('Modérer les membres');

    return names.length ? names.join(' • ') : `_Permissions : ${permBits}_`;
  } catch {
    return `_Permissions : ${permBits}_`;
  }
}

/* ---------- Construction des embeds ---------- */
function buildOverviewEmbed(commands, botLabel, color, truncated = false) {
  const categories = {};

  for (const cmd of commands) {
    const data = cmd.data?.toJSON?.() || {};
    const cat = detectCategory(data.name, data.description);
    if (!categories[cat.key]) categories[cat.key] = { label: cat.label, cmds: [] };
    categories[cat.key].cmds.push(data);
  }

  const lines = [];
  for (const cat of Object.values(categories)) {
    lines.push(`\n**${cat.label}**`);
    for (const d of cat.cmds.sort((a, b) => a.name.localeCompare(b.name, 'fr'))) {
      const perms = d.default_member_permissions
        ? `  ⟮${permsToHuman(d.default_member_permissions)}⟯`
        : '';
      lines.push(`• **/${d.name}** — ${d.description || '_Sans description_'}${perms}`);
    }
  }

  const note = truncated
    ? `\n\n⚠️ *Menu limité à ${MAX_SELECT_OPTIONS} entrées (limite Discord). Utilise la vue d’ensemble pour tout voir.*`
    : '';

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`🧭 Aide — Commandes de ${botLabel}`)
    .setDescription((lines.join('\n') || '_Aucune commande chargée_') + note)
    .setFooter({ text: `${botLabel} • Sélectionne une commande ci-dessous` })
    .setTimestamp();
}

function buildCommandEmbed(cmd, botLabel, color) {
  const data = cmd.data?.toJSON?.() || {};

  const emb = new EmbedBuilder()
    .setColor(color)
    .setTitle(`❓ Aide — /${data.name}`)
    .setDescription(data.description || '_Sans description_')
    .addFields({
      name: 'Permissions requises',
      value: permsToHuman(data.default_member_permissions)
    })
    .setFooter({ text: `${botLabel} • /aide pour la liste complète` })
    .setTimestamp();

  const opts = data.options || [];
  if (opts.length) {
    const lines = opts.map(o => {
      const base =
        `• **${o.name}** (${typeLabel(o.type)}) ${o.required ? '— *requis*' : ''}\n` +
        `  ${o.description || '_—_'}`;

      const withChoices = (o.choices?.length)
        ? `${base}\n  Choix : ${o.choices.map(c => `\`${c.name}\``).join(', ')}`
        : base;

      const withSub = (o.options?.length)
        ? `${withChoices}\n  (Sous-options : ${o.options.map(s => `\`${s.name}\``).join(', ')})`
        : withChoices;

      return withSub;
    }).join('\n\n');

    const firstChunk = lines.slice(0, 1024) || '_—_';
    emb.addFields({ name: 'Options', value: firstChunk });

    if (lines.length > 1024) {
      const secondChunk = lines.slice(1024, 2048) || '_—_';
      emb.addFields({ name: 'Options (suite)', value: secondChunk });
    }
  } else {
    emb.addFields({ name: 'Options', value: '_Aucune_' });
  }

  return emb;
}

/* ---------- Menus et boutons ---------- */
function buildSelectMenu(commands) {
  // ⚠️ Limite Discord: 25 options max
  const truncated = commands.length > MAX_COMMAND_OPTIONS_IN_MENU;
  const list = commands.slice(0, MAX_COMMAND_OPTIONS_IN_MENU);

  const menu = new StringSelectMenuBuilder()
    .setCustomId('help_select')
    .setPlaceholder('Choisis une commande…')
    .addOptions(
      {
        label: '📜 Vue d’ensemble',
        value: 'overview',
        description: 'Liste complète des commandes'
      },
      ...list.map(c => {
        const d = c.data?.toJSON?.() || {};
        return {
          label: `/${d.name}`,
          value: d.name,
          description: (d.description || '—').slice(0, 95)
        };
      })
    );

  return { row: new ActionRowBuilder().addComponents(menu), truncated };
}

function buildButtonsRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('help_back')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('⬅️ Vue d’ensemble')
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('help_close')
      .setStyle(ButtonStyle.Danger)
      .setLabel('❌ Fermer')
      .setDisabled(disabled)
  );
}

function buildDisabledComponents(commands) {
  const { row } = buildSelectMenu(commands);
  // disable select menu
  const disabledMenuRow = ActionRowBuilder.from(row);
  disabledMenuRow.components[0].setDisabled(true);

  return [disabledMenuRow, buildButtonsRow(true)];
}

/* ---------- Commande principale ---------- */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('aide')
    .setDescription('Affiche l’aide interactive des commandes disponibles, classées automatiquement.')
    .addBooleanOption(o =>
      o
        .setName('public')
        .setDescription('Afficher publiquement (par défaut : non)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const isPublic = interaction.options.getBoolean('public') ?? false;

    const globalCfg = getGlobalConfig() || {};
    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};

    const botLabel =
      guildCfg?.clubName ||
      globalCfg.botName ||
      interaction.client.user?.username ||
      'Bot';

    const color = getEmbedColorFromCfg(guildCfg);

    const cmds = [...interaction.client.commands.values()].sort((a, b) =>
      a.data.name === 'aide'
        ? -1
        : b.data.name === 'aide'
        ? 1
        : a.data.name.localeCompare(b.data.name, 'fr')
    );

    const { row: selectRow, truncated } = buildSelectMenu(cmds);
    const rows = [selectRow, buildButtonsRow(false)];

    const msg = await interaction.reply({
      embeds: [buildOverviewEmbed(cmds, botLabel, color, truncated)],
      components: rows,
      ephemeral: !isPublic,
      fetchReply: true // ✅ IMPORTANT: récupère le Message pour créer le collector
    });

    const collector = msg.createMessageComponentCollector({
      time: 5 * 60 * 1000,
      filter: i =>
        i.user.id === interaction.user.id &&
        (i.componentType === ComponentType.Button || i.componentType === ComponentType.StringSelect)
    });

    collector.on('collect', async i => {
      try {
        if (i.customId === 'help_close') {
          await i.update({ content: '❎ Aide fermée.', embeds: [], components: [] });
          collector.stop('closed');
          return;
        }

        if (i.customId === 'help_back') {
          await i.update({
            embeds: [buildOverviewEmbed(cmds, botLabel, color, truncated)],
            components: rows
          });
          return;
        }

        if (i.customId === 'help_select') {
          const picked = i.values?.[0];
          if (!picked || picked === 'overview') {
            await i.update({
              embeds: [buildOverviewEmbed(cmds, botLabel, color, truncated)],
              components: rows
            });
            return;
          }

          const cmd = cmds.find(c => c.data?.name === picked);
          if (!cmd) return i.deferUpdate().catch(() => {});

          await i.update({
            embeds: [buildCommandEmbed(cmd, botLabel, color)],
            components: rows
          });
          return;
        }

        await i.deferUpdate().catch(() => {});
      } catch {
        // ignore
      }
    });

    collector.on('end', async () => {
      try {
        await msg.edit({ components: buildDisabledComponents(cmds) });
      } catch {
        // ignore
      }
    });
  }
};
