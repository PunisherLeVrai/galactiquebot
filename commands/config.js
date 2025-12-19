// commands/config.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder
} = require('discord.js');

const { getConfigFromInteraction, updateGuildConfig } = require('../utils/config');

const DEFAULT_COLOR = 0xff4db8;

function getEmbedColor(cfg) {
  const hex = cfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

function safeHexLabel(hex) {
  if (!hex) return '_par défaut_';
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  return /^[0-9a-fA-F]{6}$/.test(clean) ? `#${clean.toLowerCase()}` : '_invalide_';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure le bot pour ce serveur.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // /config channels
    .addSubcommand(sc =>
      sc
        .setName('channels')
        .setDescription('Configurer les salons utilisés par le bot.')
        .addChannelOption(o =>
          o.setName('logs')
            .setDescription('Salon des logs (optionnel).')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
        .addChannelOption(o =>
          o.setName('dispos')
            .setDescription('Salon principal des disponibilités.')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
        .addChannelOption(o =>
          o.setName('rapports')
            .setDescription('Salon où envoyer les rapports (12h/17h/semaine).')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )

    // /config roles
    .addSubcommand(sc =>
      sc
        .setName('roles')
        .setDescription('Configurer les rôles utilisés par le bot.')
        .addRoleOption(o =>
          o.setName('joueur')
            .setDescription('Rôle des joueurs officiels.')
            .setRequired(false)
        )
        .addRoleOption(o =>
          o.setName('essai')
            .setDescription('Rôle des joueurs en essai.')
            .setRequired(false)
        )
        .addRoleOption(o =>
          o.setName('convoque')
            .setDescription('Rôle des joueurs convoqués (compo).')
            .setRequired(false)
        )
    )

    // /config style
    .addSubcommand(sc =>
      sc
        .setName('style')
        .setDescription('Configurer le style (couleur, tag, nom du club).')
        .addStringOption(o =>
          o.setName('couleur')
            .setDescription('Hex 6 caractères (ex : ff4db8 ou #ff4db8).')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('tag')
            .setDescription('Tag (ex : XIG).')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('clubname')
            .setDescription('Nom du club (ex : INTER GALACTIQUE).')
            .setRequired(false)
        )
    )

    // /config dispos
    .addSubcommand(sc =>
      sc
        .setName('dispos')
        .setDescription('Configurer les messages de disponibilités par jour.')
        .addStringOption(o =>
          o.setName('jour')
            .setDescription('Jour à configurer')
            .setRequired(true)
            .addChoices(
              { name: 'Lundi', value: 'lundi' },
              { name: 'Mardi', value: 'mardi' },
              { name: 'Mercredi', value: 'mercredi' },
              { name: 'Jeudi', value: 'jeudi' },
              { name: 'Vendredi', value: 'vendredi' },
              { name: 'Samedi', value: 'samedi' },
              { name: 'Dimanche', value: 'dimanche' }
            )
        )
        .addStringOption(o =>
          o.setName('message_id')
            .setDescription('ID du message de disponibilités pour ce jour.')
            .setRequired(true)
        )
    )

    // /config view
    .addSubcommand(sc =>
      sc.setName('view').setDescription('Afficher la configuration actuelle.')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({ content: '❌ Utilise cette commande dans un serveur.', ephemeral: true });
    }

    const { global, guild: guildConfig } = getConfigFromInteraction(interaction) || {};
    const cfg = guildConfig || {};

    // /config view
    if (sub === 'view') {
      const rolesCfg = cfg.roles || {};
      const dispo = cfg.dispoMessages || {};

      const embed = new EmbedBuilder()
        .setColor(getEmbedColor(cfg))
        .setTitle('⚙️ Configuration du bot')
        .setDescription(
          `Serveur : **${guild.name}**\n` +
          `Bot : **${(global && global.botName) || 'GalactiqueBot'}**`
        )
        .addFields(
          {
            name: '🎨 Style',
            value: [
              `• Nom du club : ${cfg.clubName || guild.name}`,
              `• Tag : ${cfg.tag || '_non défini_'}`,
              `• Couleur embeds : ${safeHexLabel(cfg.embedColor)}`
            ].join('\n')
          },
          {
            name: '📡 Salons',
            value: [
              `• Dispos : ${cfg.mainDispoChannelId ? `<#${cfg.mainDispoChannelId}>` : '_non défini_'}`,
              `• Rapports : ${cfg.rapportChannelId ? `<#${cfg.rapportChannelId}>` : '_non défini_'}`,
              `• Logs : ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : '_non défini_'}`
            ].join('\n')
          },
          {
            name: '🎭 Rôles',
            value: [
              `• Joueur : ${rolesCfg.joueur ? `<@&${rolesCfg.joueur}>` : '_non défini_'}`,
              `• Essai : ${rolesCfg.essai ? `<@&${rolesCfg.essai}>` : '_non défini_'}`,
              `• Convoqué : ${rolesCfg.convoque ? `<@&${rolesCfg.convoque}>` : '_non défini_'}`
            ].join('\n')
          },
          {
            name: '📅 Messages de dispos',
            value: [
              `• Lundi : ${dispo.lundi ? `\`${dispo.lundi}\`` : '_—_'}`,
              `• Mardi : ${dispo.mardi ? `\`${dispo.mardi}\`` : '_—_'}`,
              `• Mercredi : ${dispo.mercredi ? `\`${dispo.mercredi}\`` : '_—_'}`,
              `• Jeudi : ${dispo.jeudi ? `\`${dispo.jeudi}\`` : '_—_'}`,
              `• Vendredi : ${dispo.vendredi ? `\`${dispo.vendredi}\`` : '_—_'}`,
              `• Samedi : ${dispo.samedi ? `\`${dispo.samedi}\`` : '_—_'}`,
              `• Dimanche : ${dispo.dimanche ? `\`${dispo.dimanche}\`` : '_—_'}`
            ].join('\n')
          }
        )
        .setFooter({ text: 'Commande : /config' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // /config channels
    if (sub === 'channels') {
      const logs = interaction.options.getChannel('logs') || null;
      const dispos = interaction.options.getChannel('dispos') || null;
      const rapports = interaction.options.getChannel('rapports') || null;

      if (!logs && !dispos && !rapports) {
        return interaction.reply({ content: 'ℹ️ Donne au moins un salon.', ephemeral: true });
      }

      const patch = {};
      const changes = [];

      if (logs) { patch.logChannelId = logs.id; changes.push(`• Logs → <#${logs.id}>`); }
      if (dispos) { patch.mainDispoChannelId = dispos.id; changes.push(`• Dispos → <#${dispos.id}>`); }
      if (rapports) { patch.rapportChannelId = rapports.id; changes.push(`• Rapports → <#${rapports.id}>`); }

      updateGuildConfig(guild.id, patch);

      return interaction.reply({
        content: ['✅ Salons mis à jour :', ...changes].join('\n'),
        ephemeral: true
      });
    }

    // /config roles
    if (sub === 'roles') {
      const joueur = interaction.options.getRole('joueur') || null;
      const essai = interaction.options.getRole('essai') || null;
      const convoque = interaction.options.getRole('convoque') || null;

      if (!joueur && !essai && !convoque) {
        return interaction.reply({ content: 'ℹ️ Donne au moins un rôle.', ephemeral: true });
      }

      const rolesPatch = {};
      const changes = [];

      if (joueur) { rolesPatch.joueur = joueur.id; changes.push(`• Joueur → <@&${joueur.id}>`); }
      if (essai) { rolesPatch.essai = essai.id; changes.push(`• Essai → <@&${essai.id}>`); }
      if (convoque) { rolesPatch.convoque = convoque.id; changes.push(`• Convoqué → <@&${convoque.id}>`); }

      updateGuildConfig(guild.id, { roles: rolesPatch });

      return interaction.reply({
        content: ['✅ Rôles mis à jour :', ...changes].join('\n'),
        ephemeral: true
      });
    }

    // /config style
    if (sub === 'style') {
      const couleurStr = interaction.options.getString('couleur') || null;
      const tag = interaction.options.getString('tag') || null;
      const clubName = interaction.options.getString('clubname') || null;

      if (!couleurStr && !tag && !clubName) {
        return interaction.reply({ content: 'ℹ️ Donne `couleur`, `tag` ou `clubname`.', ephemeral: true });
      }

      const patch = {};
      const changes = [];

      if (couleurStr) {
        const raw = couleurStr.trim();
        const clean = raw.replace(/^0x/i, '').replace('#', '');
        if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
          return interaction.reply({
            content: '❌ Couleur invalide. Ex : `ff4db8` ou `#ff4db8`.',
            ephemeral: true
          });
        }
        patch.embedColor = clean.toLowerCase();
        changes.push(`• Couleur → \`#${clean.toLowerCase()}\``);
      }

      if (tag) { patch.tag = tag.trim(); changes.push(`• Tag → \`${tag.trim()}\``); }
      if (clubName) { patch.clubName = clubName.trim(); changes.push(`• Club → **${clubName.trim()}**`); }

      updateGuildConfig(guild.id, patch);

      return interaction.reply({
        content: ['✅ Style mis à jour :', ...changes].join('\n'),
        ephemeral: true
      });
    }

    // /config dispos
    if (sub === 'dispos') {
      const jour = interaction.options.getString('jour', true);
      const messageId = interaction.options.getString('message_id', true);

      const existing = cfg.dispoMessages || {};
      updateGuildConfig(guild.id, { dispoMessages: { ...existing, [jour]: messageId } });

      return interaction.reply({
        content: `✅ Dispo **${jour.toUpperCase()}** → \`${messageId}\``,
        ephemeral: true
      });
    }
  }
};
