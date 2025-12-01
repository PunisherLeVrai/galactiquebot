// deploy-commands.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // ⚠️ OBLIGATOIRE maintenant

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ TOKEN, CLIENT_ID ou GUILD_ID manquant dans .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

// Charge toutes les commandes du dossier ./commands
function loadCommands() {
  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');
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

    // ---------------- PURGE COMMANDES DE GUILDE UNIQUEMENT ----------------
    const existingGuild = await rest.get(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    );
    console.log(
      `📋 Commandes de guilde existantes: ${
        existingGuild.map(c => c.name).join(', ') || '(aucune)'
      }`
    );

    if (existingGuild.length) {
      console.log('🧹 Suppression des commandes de guilde existantes…');
      for (const c of existingGuild) {
        await rest.delete(
          Routes.applicationGuildCommand(CLIENT_ID, GUILD_ID, c.id)
        );
        console.log(`❌ Supprimée (guild) : /${c.name}`);
      }
      console.log('✅ Purge guild terminée.\n');
    } else {
      console.log('✅ Aucune commande de guilde à supprimer.\n');
    }

    // ---------------- DÉPLOIEMENT DES NOUVELLES COMMANDES (GUILDE) ----------------
    console.log('🚀 Déploiement des nouvelles commandes **GUILDE**…');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('✅ Commandes de guilde déployées avec succès !');

  } catch (err) {
    console.error('❌ Erreur lors du déploiement :');
    if (err?.rawError) console.error(JSON.stringify(err.rawError, null, 2));
    else console.error(err);
    process.exit(1);
  }
})();
