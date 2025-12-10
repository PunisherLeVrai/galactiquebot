// utils/paths.js
const fs = require('fs');
const path = require('path');

/**
 * 📁 CHEMIN PERSISTANT POUR LES SNAPSHOTS
 * ----------------------------------------------------
 * - En LOCAL : crée ./data/snapshots
 * - SUR RAILWAY : écrit automatiquement dans /data/snapshots
 *   (Railway ne supprime pas /data à chaque redéploiement)
 *
 * 👉 Aucun fichier snapshot ne sera effacé entre deux builds
 */

const DATA_BASE =
  process.env.DATA_DIR        // Si Railway définit une variable
  || '/data'                  // Sinon emplacement persistant par défaut
  || path.join(process.cwd(), 'data');  // fallback local (jamais utilisé sur Railway)

const SNAPSHOT_DIR = path.join(DATA_BASE, 'snapshots');

// 🔧 Vérification + création automatique
try {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    console.log(`📁 Dossier snapshots créé : ${SNAPSHOT_DIR}`);
  }
} catch (err) {
  console.error("❌ Impossible de créer le dossier snapshots :", SNAPSHOT_DIR);
  console.error(err);
}

module.exports = {
  SNAPSHOT_DIR
};
