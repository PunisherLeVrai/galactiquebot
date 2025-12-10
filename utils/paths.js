// utils/paths.js
const fs = require('fs');
const path = require('path');

/**
 * ------------------------------------------------------
 * 📁 GESTION PERSISTANTE DES SNAPSHOTS
 * ------------------------------------------------------
 *
 * Railway => /data/snapshots     (persiste entre builds)
 * Replit  => ./data/snapshots    (persiste dans le projet)
 * Local   => ./data/snapshots    (fallback stable)
 *
 * IMPORTANT :
 *  - AUCUN snapshot ne sera effacé
 *  - Sécurisé, silencieux si déjà existant
 *  - Compatible multi-plateforme
 * ------------------------------------------------------
 */

function resolveDataBase() {
  // Railway peut définir DATA_DIR
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim() !== '') {
    return process.env.DATA_DIR;
  }

  // Si Railway ne définit pas DATA_DIR → utiliser /data
  // (emplacement persistant dans la plupart des hébergements)
  if (fs.existsSync('/data')) {
    return '/data';
  }

  // Sinon -> fallback local
  return path.join(process.cwd(), 'data');
}

const DATA_BASE = resolveDataBase();
const SNAPSHOT_DIR = path.join(DATA_BASE, 'snapshots');

/**
 * Création automatique des dossiers nécessaires
 * Sans crash sur permissions insuffisantes
 * Et silencieux si existe déjà
 */
function ensureSnapshotDirectory() {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) {
      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
      console.log(`📁 [paths] Dossier snapshots créé : ${SNAPSHOT_DIR}`);
    }
  } catch (err) {
    console.error(`❌ [paths] Impossible de créer ${SNAPSHOT_DIR}`);
    console.error(err);
  }
}

module.exports = {
  DATA_BASE,
  SNAPSHOT_DIR,
  ensureSnapshotDirectory
};
