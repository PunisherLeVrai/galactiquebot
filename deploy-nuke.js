// deploy-nuke.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ TOKEN ou CLIENT_ID manquant dans .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('🚨 FLUSH COMPLET DES COMMANDES (GLOBAL + GUILDE)');

    /* ================= GLOBAL ================= */
    const globalCommands = await rest.get(Routes.applicationCommands(CLIENT_ID));
    console.log(`🌐 Commandes globales détectées : ${globalCommands.length}`);

    if (globalCommands.length) {
      console.log('🧹 Suppression des commandes globales…');
      for (const cmd of globalCommands) {
        await rest.delete(Routes.applicationCommand(CLIENT_ID, cmd.id));
        console.log(`   ❌ /${cmd.name} (global) supprimée`);
      }
      console.log('✅ Purge des commandes globales terminée.\n');
    } else {
      console.log('✅ Aucune commande globale à supprimer.\n');
    }

    /* ================= GUILDE ================= */
    if (!GUILD_ID) {
      console.log('ℹ️ Pas de GUILD_ID → aucune commande de guilde à purger.');
      console.log('🎯 Flush terminé.');
      return;
    }

    const guildCommands = await rest.get(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    );
    console.log(`📂 Commandes de guilde détectées : ${guildCommands.length}`);

    if (guildCommands.length) {
      console.log('🧹 Suppression des commandes de guilde…');
      for (const cmd of guildCommands) {
        await rest.delete(
          Routes.applicationGuildCommand(CLIENT_ID, GUILD_ID, cmd.id)
        );
        console.log(`   ❌ /${cmd.name} (guilde) supprimée`);
      }
      console.log('✅ Purge des commandes de guilde terminée.\n');
    } else {
      console.log('✅ Aucune commande de guilde à supprimer.\n');
    }

    console.log('🎯 Flush terminé. AUCUNE commande ne doit rester côté API.');
  } catch (err) {
    console.error('❌ Erreur lors du flush :');
    if (err?.rawError) console.error(JSON.stringify(err.rawError, null, 2));
    else console.error(err);
    process.exit(1);
  }
})();
