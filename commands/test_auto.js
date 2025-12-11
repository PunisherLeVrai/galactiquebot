// commands/test_auto.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');

const {
  sendDispoPanelIG,
  runNoonReminderIG,
  sendDetailedReportIG,
  closeDisposAt17IG,
  autoSyncNicknamesIG,
  autoVerifierCompoIG,
  autoCompoWeekReportIG,
  autoWeekDispoReportIG
} = require('../utils/scheduler');

// Même ID que dans scheduler.js
const IG_GUILD_ID = '1392639720491581551';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('test_auto')
    .setDescription('Tester manuellement les automatisations (IG uniquement).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('action')
        .setDescription('Automatisation à tester')
        .setRequired(true)
        .addChoices(
          { name: 'Panneau de disponibilités (10h/22h)', value: 'panneau' },
          { name: 'Rappel 12h (texte brut)', value: 'rappel_12h' },
          { name: 'Rapport 12h (embed détaillé)', value: 'rapport_12h' },
          { name: 'Rapport 17h (embed détaillé)', value: 'rapport_17h' },
          { name: 'Fermeture 17h (snapshot + 🔒)', value: 'fermeture_17h' },
          { name: 'Sync pseudos automatique', value: 'sync_pseudos' },
          { name: 'Vérifier compo (auto, maintenant)', value: 'verif_compo_now' },
          { name: 'Vérifier compo semaine (auto)', value: 'verif_compo_semaine_now' },
          { name: 'Vérifier semaine dispos (auto)', value: 'verif_semaine_now' }
        )
    ),

  async execute(interaction) {
    const action = interaction.options.getString('action', true);

    // Sécurité : commande utilisable uniquement sur le serveur IG
    if (interaction.guild.id !== IG_GUILD_ID) {
      return interaction.reply({
        content: '❌ Cette commande de test ne fonctionne que sur le serveur INTER GALACTIQUE.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.reply({
      content: `⏳ Lancement du test **${action}**…`,
      flags: MessageFlags.Ephemeral
    });

    try {
      switch (action) {
        case 'panneau':
          await sendDispoPanelIG(interaction.client);
          break;

        case 'rappel_12h':
          await runNoonReminderIG(interaction.client);
          break;

        case 'rapport_12h':
          await sendDetailedReportIG(interaction.client, '12h');
          break;

        case 'rapport_17h':
          await sendDetailedReportIG(interaction.client, '17h');
          break;

        case 'fermeture_17h':
          await closeDisposAt17IG(interaction.client);
          break;

        case 'sync_pseudos':
          await autoSyncNicknamesIG(interaction.client);
          break;

        case 'verif_compo_now':
          await autoVerifierCompoIG(interaction.client, 'TEST');
          break;

        case 'verif_compo_semaine_now':
          await autoCompoWeekReportIG(interaction.client);
          break;

        case 'verif_semaine_now':
          await autoWeekDispoReportIG(interaction.client);
          break;

        default:
          return interaction.editReply({
            content: '❌ Action inconnue.'
          });
      }

      await interaction.editReply({
        content: `✅ Test **${action}** exécuté. Vérifie le(s) salon(s) concernés.`
      });
    } catch (e) {
      console.error('❌ Erreur /test_auto :', e);
      await interaction.editReply({
        content: '❌ Une erreur est survenue pendant le test (voir logs).'
      });
    }
  }
};
