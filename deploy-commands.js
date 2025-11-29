// deploy-commands.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || null;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ TOKEN ou CLIENT_ID manquant dans .env');
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

    /* ---------------- PURGE COMMANDES GLOBALES ---------------- */
    const existingGlobal = await rest.get(Routes.applicationCommands(CLIENT_ID));
    console.log(
      `📋 Commandes globales existantes: ${
        existingGlobal.map(c => c.name).join(', ') || '(aucune)'
      }\n`
    );

    if (existingGlobal.length) {
      console.log('🧹 Suppression des commandes globales existantes…');
      for (const c of existingGlobal) {
        await rest.delete(Routes.applicationCommand(CLIENT_ID, c.id));
        console.log(`❌ Supprimée (global) : /${c.name}`);
      }
      console.log('✅ Purge globale terminée.\n');
    } else {
      console.log('✅ Aucune commande globale à supprimer.\n');
    }

    /* ---------------- PURGE COMMANDES DE GUILDE ---------------- */
    if (GUILD_ID) {
      console.log(`🧹 Purge des commandes GUILD pour ${GUILD_ID}…`);
      const existingGuild = await rest.get(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
      );

      console.log(
        `📋 Commandes de guilde existantes: ${
          existingGuild.map(c => c.name).join(', ') || '(aucune)'
        }`
      );

      if (existingGuild.length) {
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
    } else {
      console.log('ℹ️ Aucun GUILD_ID dans .env → aucune commande de guilde purgée.\n');
    }

    /* ---------------- DÉPLOIEMENT DES NOUVELLES COMMANDES (GLOBAL) ---------------- */
    console.log('🚀 Déploiement des nouvelles commandes **globales**…');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Commandes globales déployées avec succès !');

    const after = await rest.get(Routes.applicationCommands(CLIENT_ID));
    console.log(
      `🔁 Vérification: ${after.length} commande(s) désormais actives (globales): ${
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