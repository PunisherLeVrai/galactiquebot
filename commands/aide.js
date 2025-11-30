// commands/aide.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionsBitField,
  MessageFlags,
} = require('discord.js');

const { getGlobalConfig, getConfigFromInteraction } = require('../utils/config');

const DEFAULT_COLOR = 0xff4db8;

/* ---------- Couleur par serveur ---------- */
function getEmbedColorFromCfg(guildCfg) {
  const hex = guildCfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;

  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

/* ---------- Catégorisation automatique (optimisée FR + snake_case) ---------- */
function detectCategory(name, description = '') {
  const n = (name || '').toLowerCase();
  const d = (description || '').toLowerCase();

  // ⚽️ Disponibilités / rapports / rappels
  const dispoKeys = [
    'dispo', 'dispos',
    'publier_dispos', 'modifier_dispos', 'reinitialiser_dispos',
    'verrouiller_dispos', 'rouvrir_dispos',
    'rappel', 'rappel_absents',
    'rapport', 'generer_rapport',
    'verifier', 'verifiersemaine', 'verifier_semaine', 'mentionabsents'
  ];
  if (dispoKeys.some(k => n.includes(k))) {
    return { label: '⚽️ Disponibilités', key: 'dispo' };
  }

  // 👤 Gestion des joueurs (pseudos / alias / synchro)
  if (
    n.includes('pseudo') ||
    n.includes('nick') ||
    n.includes('alias') ||
    n.includes('synchroniser_pseudos') ||
    d.includes('pseudo')
  ) {
    return { label: '👤 Gestion des joueurs', key: 'joueurs' };
  }

  // 🛠️ Outils du staff (aide, annonces, règlement, config)
  const staffKeys = ['aide', 'setup', 'clean', 'status', 'config', 'reglement', 'annonce', 'communique'];
  if (staffKeys.some(k => n.includes(k))) {
    return { label: '🛠️ Outils du staff', key: 'staff' };
  }

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
  const p = new PermissionsBitField(permBits);
  const names = [];
  if (p.has(PermissionsBitField.Flags.ManageGuild)) names.push('Gérer le serveur');
  if (p.has(PermissionsBitField.Flags.ManageNicknames)) names.push('Gérer les pseudos');
  if (p.has(PermissionsBitField.Flags.ModerateMembers)) names.push('Modérer les membres');
  if (p.has(PermissionsBitField.Flags.Administrator)) names.push('Administrateur');
  return names.length ? names.join(' • ') : `_Permissions : ${permBits}_`;
}

/* ---------- Construction des embeds ---------- */
function buildOverviewEmbed(commands, botLabel, color) {
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
      const perms = d.default_member_permissions ? `  ⟮${permsToHuman(d.default_member_permissions)}⟯` : '';
      lines.push(`• **/${d.name}** — ${d.description || '_Sans description_'}${perms}`);
    }
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`🧭 Aide — Commandes de ${botLabel}`)
    .setDescription(lines.join('\n') || '_Aucune commande chargée_')
    .setFooter({ text: `${botLabel} • Sélectionne une commande ci-dessous` })
    .setTimestamp();
}

function buildCommandEmbed(cmd, botLabel, color) {
  const data = cmd.data?.toJSON?.() || {};
  const emb = new EmbedBuilder()
    .setColor(color)
    .setTitle(`❓ Aide — /${data.name}`)
    .setDescription(data.description || '_Sans description_')
    .addFields({ name: 'Permissions requises', value: permsToHuman(data.default_member_permissions) })
    .setFooter({ text: `${botLabel} • /aide pour la liste complète` })
    .setTimestamp();

  const opts = data.options || [];
  if (opts.length) {
    const lines = opts.map(o => {
      const base = `• **${o.name}** (${typeLabel(o.type)}) ${o.required ? '— *requis*' : ''}\n  ${o.description || '_—_'}`;
      const withChoices = (o.choices?.length)
        ? `${base}\n  Choix : ${o.choices.map(c => `\`${c.name}\``).join(', ')}`
        : base;
      const withSub = (o.options?.length)
        ? `${withChoices}\n  (Sous-options : ${o.options.map(s => `\`${s.name}\``).join(', ')})`
        : withChoices;
      return withSub;
    }).join('\n\n');

    emb.addFields({ name: 'Options', value: lines.slice(0, 1024) || '_—_' });
    if (lines.length > 1024) emb.addFields({ name: 'Options (suite)', value: lines.slice(1024, 2048) });
  } else {
    emb.addFields({ name: 'Options', value: '_Aucune_' });
  }
  return emb;
}

/* ---------- Menus et boutons ---------- */
function buildSelectMenu(commands) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('help_select')
    .setPlaceholder('Choisis une commande…')
    .addOptions(
      { label: '📜 Vue d’ensemble', value: 'overview', description: 'Liste complète des commandes' },
      ...commands.map(c => {
        const d = c.data?.toJSON?.() || {};
        return { label: `/${d.name}`, value: d.name, description: (d.description || '—').slice(0, 95) };
      })
    );
  return new ActionRowBuilder().addComponents(menu);
}

function buildButtonsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('help_back').setStyle(ButtonStyle.Secondary).setLabel('⬅️ Vue d’ensemble'),
    new ButtonBuilder().setCustomId('help_close').setStyle(ButtonStyle.Danger).setLabel('❌ Fermer')
  );
}

/* ---------- Commande principale ---------- */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('aide')
    .setDescription('Affiche l’aide interactive des commandes disponibles, classées automatiquement.')
    .addBooleanOption(o =>
      o.setName('public').setDescription('Afficher publiquement (par défaut : non)').setRequired(false)
    ),

  async execute(interaction) {
    const isPublic = interaction.options.getBoolean('public') ?? false;

    // Récupération des infos depuis la config
    const globalCfg = getGlobalConfig() || {};
    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};

    // Label utilisé dans les embeds : clubName > botName global > nom du bot
    const botLabel =
      guildCfg?.clubName ||
      globalCfg.botName ||
      interaction.client.user?.username ||
      'GalactiqueBot';

    // Couleur spécifique à ce serveur
    const color = getEmbedColorFromCfg(guildCfg);

    const cmds = [...interaction.client.commands.values()]
      .sort((a, b) =>
        (a.data.name === 'aide' ? -1
          : b.data.name === 'aide' ? 1
          : a.data.name.localeCompare(b.data.name, 'fr'))
      );

    const overview = buildOverviewEmbed(cmds, botLabel, color);
    const rows = [buildSelectMenu(cmds), buildButtonsRow()];

    const replyOpts = { embeds: [overview], components: rows };
    if (!isPublic) replyOpts.flags = MessageFlags.Ephemeral;

    const msg = await interaction.reply(replyOpts);

    const collector = msg.createMessageComponentCollector({
      time: 5 * 60 * 1000,
      filter: i =>
        i.user.id === interaction.user.id &&
        (i.componentType === ComponentType.Button || i.componentType === ComponentType.StringSelect)
    });

    collector.on('collect', async (i) => {
      try {
        if (i.customId === 'help_close') {
          await i.update({ content: '❎ Aide fermée.', embeds: [], components: [] });
          collector.stop('closed');
          return;
        }

        if (i.customId === 'help_back') {
          await i.update({ embeds: [buildOverviewEmbed(cmds, botLabel, color)], components: rows });
          return;
        }

        if (i.customId === 'help_select') {
          const picked = i.values?.[0];
          if (!picked || picked === 'overview') {
            await i.update({ embeds: [buildOverviewEmbed(cmds, botLabel, color)], components: rows });
            return;
          }
          const cmd = cmds.find(c => c.data?.name === picked);
          if (!cmd) { await i.deferUpdate(); return; }
          await i.update({ embeds: [buildCommandEmbed(cmd, botLabel, color)], components: rows });
          return;
        }

        await i.deferUpdate();
      } catch {
        // ignore
      }
    });

    collector.on('end', async () => {
      try {
        const disabled = rows.map(r => {
          const clone = ActionRowBuilder.from(r);
          for (const c of clone.components) c.setDisabled(true);
          return clone;
        });
        await msg.edit({ components: disabled });
      } catch {
        // ignore
      }
    });
  }
};
