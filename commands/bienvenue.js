// commands/bienvenue.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

const { getConfigFromInteraction } = require('../utils/config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bienvenue')
    .setDescription('Souhaite la bienvenue avec un message professionnel du club.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // 👤 Membre ciblé
    .addUserOption(o =>
      o.setName('utilisateur')
        .setDescription('Membre à accueillir')
        .setRequired(true)
    )

    // 🧵 Salon où envoyer le message
    .addChannelOption(o =>
      o.setName('salon')
        .setDescription('Salon où envoyer le message (défaut : salon courant)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )

    // 📘 Salons optionnels pour les étapes
    .addChannelOption(o =>
      o.setName('reglement')
        .setDescription('Salon du règlement')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName('presentation')
        .setDescription('Salon des présentations')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName('disponibilites')
        .setDescription('Salon des disponibilités')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser('utilisateur', true);

    // 🔧 Récup clubName + config serveur
    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};
    const clubName =
      guildCfg?.clubName ||
      interaction.guild?.name ||
      'INTER GALACTIQUE';

    // Salon cible : option "salon" OU salon actuel
    let channel =
      interaction.options.getChannel('salon') ||
      interaction.channel;

    const reglementChan    = interaction.options.getChannel('reglement') || null;
    const presentationChan = interaction.options.getChannel('presentation') || null;

    // Pour les dispos : option > config > null
    let disposChan = interaction.options.getChannel('disponibilites') || null;
    if (!disposChan && guildCfg?.mainDispoChannelId) {
      const fetched = await interaction.guild.channels
        .fetch(guildCfg.mainDispoChannelId)
        .catch(() => null);
      if (fetched && fetched.isTextBased()) {
        disposChan = fetched;
      }
    }

    // 🔐 Vérifie les permissions d’écriture dans le salon cible
    const me = interaction.guild.members.me;
    if (!channel || !channel.isTextBased()) {
      return interaction.reply({
        content: '❌ Salon cible introuvable ou non textuel. Utilise cette commande dans un salon texte valide ou précise un salon.',
        ephemeral: true
      });
    }

    if (!channel.permissionsFor?.(me)?.has(['ViewChannel', 'SendMessages'])) {
      return interaction.reply({
        content: `❌ Je ne peux pas écrire dans ${channel}.`,
        ephemeral: true
      });
    }

    // Construction des lignes "étapes" dynamiquement selon ce qui est fourni
    const lignesEtapes = [];

    if (reglementChan) {
      lignesEtapes.push(`1️⃣ Consulter le règlement 👉 ${reglementChan}`);
    } else {
      lignesEtapes.push('1️⃣ Consulter le règlement du serveur ✅');
    }

    if (presentationChan) {
      lignesEtapes.push(`2️⃣ Faire ta présentation 👉 ${presentationChan}`);
    } else {
      lignesEtapes.push('2️⃣ Faire ta présentation dans le salon prévu ✅');
    }

    if (disposChan) {
      lignesEtapes.push(`3️⃣ Indiquer tes disponibilités 👉 ${disposChan}`);
    } else {
      lignesEtapes.push('3️⃣ Indiquer tes disponibilités dans le salon dédié ✅');
    }

    const contenu =
`# 🪐 ${clubName} — NOUVEL ARRIVANT

Bienvenue ${user} dans la galaxie **${clubName}** ! 🌌  
Ta présence marque une nouvelle étape pour l’équipe.

### 📘 Étapes essentielles
${lignesEtapes.join('\n')}

⚫ **Honore le maillot.**`;

    try {
      await channel.send({
        content: contenu,
        allowedMentions: { users: [user.id] }
      });

      await interaction.reply({
        content: `✅ Message de bienvenue envoyé dans ${channel}.`,
        ephemeral: true
      });
    } catch (e) {
      console.error('Erreur envoi bienvenue :', e);
      return interaction.reply({
        content: '❌ Impossible d’envoyer le message de bienvenue.',
        ephemeral: true
      });
    }
  }
};
