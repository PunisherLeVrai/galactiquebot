const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder
} = require('discord.js');

const {
  getConfigFromInteraction,
  updateGuildConfig
} = require('../utils/config');

const COULEUR = 0xff4db8; // rose GalactiqueBot

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure GalactiqueBot pour ce serveur.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // /config channels
    .addSubcommand(sc =>
      sc
        .setName('channels')
        .setDescription('Configurer les salons utilisés par le bot.')
        .addChannelOption(o =>
          o.setName('logs')
            .setDescription('Salon des logs (démarrage / arrêt du bot).')
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
            .setDescription('Salon où envoyer les rapports (dispos, compos, etc.).')
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
            .setDescription('Rôle des joueurs convoqués (pour compo).')
            .setRequired(false)
        )
    )

    // /config view
    .addSubcommand(sc =>
      sc
        .setName('view')
        .setDescription('Afficher la configuration actuelle pour ce serveur.')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({
        content: '❌ Cette commande doit être utilisée dans un serveur.',
        ephemeral: true
      });
    }

    const { global, guild: guildConfig } = getConfigFromInteraction(interaction);

    // -----------------------------------------------------------------------
    // /config view
    // -----------------------------------------------------------------------
    if (sub === 'view') {
      const cfg = guildConfig || {};

      const fields = [];

      fields.push({
        name: '📡 Salons',
        value: [
          `• Logs : ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : '_non défini_'}`,
          `• Disponibilités : ${cfg.mainDispoChannelId ? `<#${cfg.mainDispoChannelId}>` : '_non défini_'}`,
          `• Rapports : ${cfg.rapportChannelId ? `<#${cfg.rapportChannelId}>` : '_non défini_'}`,
        ].join('\n')
      });

      const roles = cfg.roles || {};
      fields.push({
        name: '🎭 Rôles',
        value: [
          `• Joueur : ${roles.joueur ? `<@&${roles.joueur}>` : '_non défini_'}`,
          `• Essai : ${roles.essai ? `<@&${roles.essai}>` : '_non défini_'}`,
          `• Convoqué : ${roles.convoque ? `<@&${roles.convoque}>` : '_non défini_'}`,
        ].join('\n')
      });

      const embed = new EmbedBuilder()
        .setColor(COULEUR)
        .setTitle('⚙️ Configuration GalactiqueBot')
        .setDescription(
          `Serveur : **${guild.name}**\n` +
          `Bot : **${(global && global.botName) || 'GalactiqueBot'}**`
        )
        .addFields(fields)
        .setFooter({ text: 'GalactiqueBot • /config pour modifier' })
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }

    // -----------------------------------------------------------------------
    // /config channels
    // -----------------------------------------------------------------------
    if (sub === 'channels') {
      const logsChannel = interaction.options.getChannel('logs') || null;
      const dispoChannel = interaction.options.getChannel('dispos') || null;
      const rapportsChannel = interaction.options.getChannel('rapports') || null;

      if (!logsChannel && !dispoChannel && !rapportsChannel) {
        return interaction.reply({
          content: 'ℹ️ Aucun salon fourni. Merci de choisir au moins une option.',
          ephemeral: true
        });
      }

      const patch = {};
      const changes = [];

      if (logsChannel) {
        patch.logChannelId = logsChannel.id;
        changes.push(`• Logs → <#${logsChannel.id}>`);
      }
      if (dispoChannel) {
        patch.mainDispoChannelId = dispoChannel.id;
        changes.push(`• Disponibilités → <#${dispoChannel.id}>`);
      }
      if (rapportsChannel) {
        patch.rapportChannelId = rapportsChannel.id;
        changes.push(`• Rapports → <#${rapportsChannel.id}>`);
      }

      updateGuildConfig(guild.id, patch);

      return interaction.reply({
        content: [
          '✅ Configuration des **salons** mise à jour :',
          ...changes
        ].join('\n'),
        ephemeral: true
      });
    }

    // -----------------------------------------------------------------------
    // /config roles
    // -----------------------------------------------------------------------
    if (sub === 'roles') {
      const rJoueur = interaction.options.getRole('joueur') || null;
      const rEssai = interaction.options.getRole('essai') || null;
      const rConvoque = interaction.options.getRole('convoque') || null;

      if (!rJoueur && !rEssai && !rConvoque) {
        return interaction.reply({
          content: 'ℹ️ Aucun rôle fourni. Merci de choisir au moins une option.',
          ephemeral: true
        });
      }

      const rolesPatch = {};
      const changes = [];

      if (rJoueur) {
        rolesPatch.joueur = rJoueur.id;
        changes.push(`• Joueur → <@&${rJoueur.id}>`);
      }
      if (rEssai) {
        rolesPatch.essai = rEssai.id;
        changes.push(`• Essai → <@&${rEssai.id}>`);
      }
      if (rConvoque) {
        rolesPatch.convoque = rConvoque.id;
        changes.push(`• Convoqué → <@&${rConvoque.id}>`);
      }

      updateGuildConfig(guild.id, { roles: rolesPatch });

      return interaction.reply({
        content: [
          '✅ Configuration des **rôles** mise à jour :',
          ...changes
        ].join('\n'),
        ephemeral: true
      });
    }
  }
};