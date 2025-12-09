// deploy-commands.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ TOKEN ou CLIENT_ID manquant dans .env');
  process.exit(1);
}

console.log('🔧 Utilisation :');
console.log(`   CLIENT_ID = ${CLIENT_ID}`);
console.log('   (doit être l’ID de l’application du bot dans le portail Discord)');

const rest = new REST({ version: '10' }).setToken(TOKEN);

// Charge toutes les commandes du dossier ./commands
function loadCommands() {
  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');

  console.log(`📁 Lecture du dossier de commandes : ${commandsPath}`);

  if (!fs.existsSync(commandsPath)) {
    console.error('❌ Dossier ./commands introuvable');
    process.exit(1);
  }

  const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

  if (!files.length) {
    console.warn('⚠️ Aucun fichier .js trouvé dans ./commands');
  } else {
    console.log(`🧩 Fichiers de commandes détectés : ${files.join(', ')}`);
  }

  for (const file of files) {
    const cmdPath = path.join(commandsPath, file);

    try {
      const cmd = require(cmdPath);

      if (!cmd?.data?.toJSON) {
        console.warn(`⚠️ Ignoré: ${file} (pas de data.toJSON)`);
        continue;
      }

      const json = cmd.data.toJSON();
      console.log(`   ➕ Commande chargée: /${json.name} (depuis ${file})`);
      commands.push(json);
    } catch (err) {
      console.error(`❌ Erreur en important ${file} :`);
      console.error(err);
      // IMPORTANT : on continue, on ne stoppe pas tout
    }
  }

  return commands;
}

(async () => {
  try {
    const commands = loadCommands();

    console.log(`\n🔎 ${commands.length} commande(s) prête(s) à déployer.`);

    if (!commands.length) {
      console.error('❌ Aucune commande prête → rien à déployer. Vérifie tes fichiers dans ./commands.');
      process.exit(1);
    }

    console.log('\n🚀 Déploiement des commandes **GLOBALES**…');

    // PUT = remplace TOUTES les commandes globales par celles du body
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log('✅ Commandes globales déployées avec succès !');

    const after = await rest.get(Routes.applicationCommands(CLIENT_ID));
    console.log(
      `📋 Commandes globales actives côté API : ${
        after.map(c => c.name).join(', ') || '(aucune)'
      }`
    );
    console.log('🎯 Fin du déploiement.');
  } catch (err) {
    console.error('❌ Erreur lors du déploiement :');
    if (err?.rawError) console.error(JSON.stringify(err.rawError, null, 2));
    else console.error(err);
    process.exit(1);
  }
})();
