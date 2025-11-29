// deploy-nuke.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
// Optionnel : mets l’ID de ta guilde dans .env si tu veux aussi purger les commandes de guilde
// GUILD_ID=1392639720491581551 par ex.
const GUILD_ID = process.env.GUILD_ID || null;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ TOKEN ou CLIENT_ID manquant dans .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('🚨 LANCEMENT DU FLUSH COMPLET DES COMMANDES SLASH');
    console.log(`🛰️ Application ID : ${CLIENT_ID}`);
    if (GUILD_ID) console.log(`🏟️ Guild ciblée pour purge locale : ${GUILD_ID}`);
    else console.log('🏟️ Aucun GUILD_ID fourni : purge uniquement des commandes **globales**.');

    // 1) Récupération des commandes globales
    const globalCommands = await rest.get(Routes.applicationCommands(CLIENT_ID));
    console.log(`🌐 Commandes globales détectées : ${globalCommands.length}`);

    // 2) Suppression des commandes globales
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

    // 3) Optionnel : purge des commandes de guilde
    if (GUILD_ID) {
      const guildCommands = await rest.get(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
      );
      console.log(`📂 Commandes de guilde détectées pour ${GUILD_ID} : ${guildCommands.length}`);

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
    }

    console.log('🎯 Flush terminé. Aucune commande slash ne doit rester côté API.');
    console.log('👉 Tu peux maintenant relancer ton script normal : `node deploy-commands.js`');
  } catch (err) {
    console.error('❌ Erreur lors du flush des commandes :');
    if (err?.rawError) console.error(JSON.stringify(err.rawError, null, 2));
    else console.error(err);
    process.exit(1);
  }
})();