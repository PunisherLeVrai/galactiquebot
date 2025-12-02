// deploy-commands.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // ton serveur INTER GALACTIQUE

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ TOKEN, CLIENT_ID ou GUILD_ID manquant dans .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

// Charge toutes les commandes du dossier ./commands
function loadCommands() {
  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');

  if (!fs.existsSync(commandsPath)) {
    console.error('❌ Dossier ./commands introuvable');
    process.exit(1);
  }

  const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const cmd = require(path.join(commandsPath, file));
    if (!cmd?.data?.toJSON) {
      console.warn(`⚠️ Ignoré: ${file} (pas de data.toJSON)`);
      continue;
    }
    commands.push(cmd.data.toJSON());
  }

  return commands;
}

(async () => {
  try {
    const commands = loadCommands();
    console.log(`🔎 ${commands.length} commande(s) trouvée(s) à déployer.`);

    console.log(`🚀 Déploiement des commandes **GUILDE** pour ${GUILD_ID}…`);

    // PUT remplace TOUTES les commandes de guilde par celles du body
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log('✅ Commandes de guilde déployées avec succès !');

    const after = await rest.get(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    );
    console.log(
      `📋 Commandes actives sur la guilde : ${
        after.map(c => c.name).join(', ') || '(aucune)'
      }`
    );
  } catch (err) {
    console.error('❌ Erreur lors du déploiement :');
    if (err?.rawError) console.error(JSON.stringify(err.rawError, null, 2));
    else console.error(err);
    process.exit(1);
  }
})();
