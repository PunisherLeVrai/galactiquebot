// commands/test_auto.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

const {
  runNoonReminderForGuild,
  sendDetailedReportForGuild,
  closeDisposAt17ForGuild,
  autoSyncNicknamesForGuild,
  autoWeekDispoReportForGuild
} = require('../utils/scheduler');

// Même ID que dans scheduler.js
const IG_GUILD_ID = '1392639720491581551';

/**
 * Jour/date Paris (cohérent avec ton scheduler)
 */
function getParisDayAndISO() {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = fmt.formatToParts(new Date());
  const get = (type) => parts.find(p => p.type === type)?.value;

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const weekday = (get('weekday') || '').toLowerCase();

  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const mapJour = {
    'dimanche': 'dimanche',
    'lundi': 'lundi',
    'mardi': 'mardi',
    'mercredi': 'mercredi',
    'jeudi': 'jeudi',
    'vendredi': 'vendredi',
    'samedi': 'samedi'
  };

  return { jour: mapJour[weekday] || 'lundi', isoDate };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('test_auto')
    .setDescription('Tester manuellement les automatisations (IGA uniquement).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('action')
        .setDescription('Automatisation à tester')
        .setRequired(true)
        .addChoices(
          { name: 'Rappel 12h (non-répondants)', value: 'rappel_12h' },
          { name: 'Rapport 12h (embed détaillé)', value: 'rapport_12h' },
          { name: 'Rapport 17h (embed détaillé)', value: 'rapport_17h' },
          { name: 'Fermeture 17h (snapshot + 🔒 + clear réactions)', value: 'fermeture_17h' },
          { name: 'Sync pseudos automatique', value: 'sync_pseudos' },
          { name: 'Rapport semaine dispos (snapshots)', value: 'dispo_semaine' }
        )
    ),

  async execute(interaction) {
    const action = interaction.options.getString('action', true);

    // ✅ Sécurité : uniquement IGA
    if (interaction.guild?.id !== IG_GUILD_ID) {
      return interaction.reply({
        content: '❌ Cette commande de test ne fonctionne que sur le serveur **INTER GALACTIQUE**.',
        ephemeral: true
      });
    }

    const { jour, isoDate } = getParisDayAndISO();

    await interaction.reply({
      content: `⏳ Lancement du test **${action}**… (jour Paris: **${jour}**, date: **${isoDate}**)`,
      ephemeral: true
    });

    try {
      switch (action) {
        case 'rappel_12h':
          await runNoonReminderForGuild(interaction.client, IG_GUILD_ID, jour);
          break;

        case 'rapport_12h':
          await sendDetailedReportForGuild(interaction.client, IG_GUILD_ID, jour, '12h');
          break;

        case 'rapport_17h':
          await sendDetailedReportForGuild(interaction.client, IG_GUILD_ID, jour, '17h');
          break;

        case 'fermeture_17h':
          await closeDisposAt17ForGuild(interaction.client, IG_GUILD_ID, jour, isoDate);
          break;

        case 'sync_pseudos':
          await autoSyncNicknamesForGuild(interaction.client, IG_GUILD_ID);
          break;

        case 'dispo_semaine':
          await autoWeekDispoReportForGuild(interaction.client, IG_GUILD_ID);
          break;

        default:
          return interaction.editReply({ content: '❌ Action inconnue.' });
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
