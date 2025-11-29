// commands/bienvenue.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bienvenue')
    .setDescription('Souhaite la bienvenue avec un message professionnel INTER GALACTIQUE.')
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
    const channel =
      interaction.options.getChannel('salon') ||
      interaction.channel;

    const reglementChan     = interaction.options.getChannel('reglement') || null;
    const presentationChan  = interaction.options.getChannel('presentation') || null;
    const disposChan        = interaction.options.getChannel('disponibilites') || null;

    // 🔐 Vérifie les permissions d’écriture
    const me = interaction.guild.members.me;
    if (!channel.permissionsFor?.(me)?.has(['ViewChannel', 'SendMessages'])) {
      return interaction.reply({
        content: `❌ Je ne peux pas écrire dans ${channel}.`,
        flags: MessageFlags.Ephemeral
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
`# 🪐 INTER GALACTIQUE — NOUVEL ARRIVANT

Bienvenue ${user} dans la galaxie ! 🌌  
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
        flags: MessageFlags.Ephemeral
      });

    } catch (e) {
      console.error('Erreur envoi bienvenue :', e);
      return interaction.reply({
        content: '❌ Impossible d’envoyer le message de bienvenue.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};