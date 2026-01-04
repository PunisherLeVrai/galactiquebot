// commands/synchroniser_pseudos.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfigFromInteraction } = require('../utils/config');
const { buildNickname } = require('../utils/nickname');

const SLEEP_MS = 350;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('synchroniser_pseudos')
    .setDescription('Synchronise les pseudos selon le format configuré dans servers.json (nickname.format)')
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

    const { guild: guildConfig } = getConfigFromInteraction(interaction) || {};
    const nicknameCfg = guildConfig?.nickname || {};

    const hasAny =
      (Array.isArray(nicknameCfg.hierarchy) && nicknameCfg.hierarchy.length) ||
      (Array.isArray(nicknameCfg.teams) && nicknameCfg.teams.length) ||
      (Array.isArray(nicknameCfg.postes) && nicknameCfg.postes.length);

    if (!hasAny) {
      return interaction.reply({
        content:
          '❌ Config pseudos manquante dans `servers.json` (`nickname.hierarchy`, `nickname.teams`, `nickname.postes`).',
        ephemeral: true
      });
    }

    const format = nicknameCfg.format || '{PSEUDO} | {MID} | {POSTES}';

    await interaction.reply({
      content: [
        simulation ? '🧪 Simulation de synchronisation en cours…' : '🔧 Synchronisation en cours…',
        `📌 Format actif : \`${format}\``
      ].join('\n'),
      ephemeral: true
    });

    await guild.members.fetch().catch(() => {});
    const members = guild.members.cache.filter(m => !m.user.bot);

    const changes = [];
    const unchanged = [];
    const blocked = [];
    const errors = [];

    for (const member of members.values()) {
      const newNick = buildNickname(member, nicknameCfg, guildConfig);
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
          await member.setNickname(newNick, 'Synchronisation pseudos (manuel)');
          await sleep(SLEEP_MS);
        } catch (e) {
          errors.push({ member, err: String(e?.message || e) });
          continue;
        }
      }

      changes.push({ member, from: current, to: newNick });
    }

    const makePreview = () => {
      const lines = changes
        .slice(0, 25)
        .map(c => `• ${c.member.user.tag} : "${c.from}" → "${c.to}"`);

      let preview = lines.join('\n') || 'Aucun pseudo modifié.';
      if (changes.length > 25) preview += `\n... (+${changes.length - 25} autres)`;
      return preview.slice(0, 1500);
    };

    await interaction.followUp({
      content: [
        simulation ? '🧪 **SIMULATION TERMINÉE**' : '✅ **SYNCHRONISATION TERMINÉE**',
        `📌 Format : \`${format}\``,
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
