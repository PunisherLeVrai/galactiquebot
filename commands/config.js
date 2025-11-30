// commands/config.js
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

const DEFAULT_COLOR = 0xff4db8; // couleur par défaut si aucune couleur définie en config

function getEmbedColor(cfg) {
  const hex = cfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;
  // hex peut être "ff4db8" ou "#ff4db8" ou "0xff4db8"
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

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

    // /config style (couleur, tag, nom du club)
    .addSubcommand(sc =>
      sc
        .setName('style')
        .setDescription('Configurer le style du bot (couleur des embeds, tag, nom du club).')
        .addStringOption(o =>
          o.setName('couleur')
            .setDescription('Couleur des embeds au format hexadécimal (ex : ff4db8 ou #ff4db8).')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('tag')
            .setDescription('Tag utilisé dans certains messages (ex : XIG).')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('clubname')
            .setDescription('Nom du club (ex : INTER GALACTIQUE).')
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
    const cfg = guildConfig || {};

    // -----------------------------------------------------------------------
    // /config view
    // -----------------------------------------------------------------------
    if (sub === 'view') {
      const fields = [];

      // Style (couleur / tag / clubName)
      fields.push({
        name: '🎨 Style',
        value: [
          `• Nom du club : ${cfg.clubName || guild.name}`,
          `• Tag : ${cfg.tag || '_non défini_'}`,
          `• Couleur embeds : ${cfg.embedColor ? `#${cfg.embedColor}` : '_par défaut_'}`
        ].join('\n')
      });

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
        .setColor(getEmbedColor(cfg))
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

    // -----------------------------------------------------------------------
    // /config style
    // -----------------------------------------------------------------------
    if (sub === 'style') {
      const couleurStr = interaction.options.getString('couleur') || null;
      const tag = interaction.options.getString('tag') || null;
      const clubName = interaction.options.getString('clubname') || null;

      if (!couleurStr && !tag && !clubName) {
        return interaction.reply({
          content: 'ℹ️ Aucun paramètre fourni. Tu peux définir `couleur`, `tag` ou `clubname`.',
          ephemeral: true
        });
      }

      const patch = {};
      const changes = [];

      if (couleurStr) {
        const raw = couleurStr.trim();
        const clean = raw.replace(/^0x/i, '').replace('#', '');
        const validHex = /^[0-9a-fA-F]{6}$/.test(clean);

        if (!validHex) {
          return interaction.reply({
            content: '❌ Couleur invalide. Utilise un hex sur 6 caractères, ex : `ff4db8` ou `#ff4db8`.',
            ephemeral: true
          });
        }

        patch.embedColor = clean.toLowerCase();
        changes.push(`• Couleur des embeds → \`#${clean.toLowerCase()}\``);
      }

      if (tag) {
        patch.tag = tag.trim();
        changes.push(`• Tag → \`${tag.trim()}\``);
      }

      if (clubName) {
        patch.clubName = clubName.trim();
        changes.push(`• Nom du club → **${clubName.trim()}**`);
      }

      updateGuildConfig(guild.id, patch);

      return interaction.reply({
        content: [
          '✅ Configuration du **style** mise à jour :',
          ...changes
        ].join('\n'),
        ephemeral: true
      });
    }
  }
};
