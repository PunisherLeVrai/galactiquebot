// deploy-nuke.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ TOKEN, CLIENT_ID ou GUILD_ID manquant dans .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('🚨 FLUSH DES COMMANDES **GUILDE** UNIQUEMENT');
    console.log(`🛰️ Application ID : ${CLIENT_ID}`);
    console.log(`🏟️ Guild ciblée : ${GUILD_ID}`);

    const guildCommands = await rest.get(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    );
    console.log(`📂 Commandes détectées : ${guildCommands.length}`);

    if (!guildCommands.length) {
      console.log('✅ Aucune commande de guilde à supprimer.');
      return;
    }

    console.log('🧹 Suppression des commandes de guilde…');
    for (const cmd of guildCommands) {
      await rest.delete(
        Routes.applicationGuildCommand(CLIENT_ID, GUILD_ID, cmd.id)
      );
      console.log(`   ❌ /${cmd.name} supprimée`);
    }

    console.log('🎯 Flush terminé. Aucune commande de guilde ne doit rester côté API.');
  } catch (err) {
    console.error('❌ Erreur lors du flush :');
    if (err?.rawError) console.error(JSON.stringify(err.rawError, null, 2));
    else console.error(err);
    process.exit(1);
  }
})();
