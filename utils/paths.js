// utils/paths.js
const fs = require('fs');
const path = require('path');

/**
 * ------------------------------------------------------
 * 📁 GESTION PERSISTANTE DES SNAPSHOTS
 * ------------------------------------------------------
 * Railway => /app/data/snapshots (volume monté)
 * (fallback) => /data/snapshots
 * Replit/Local => ./data/snapshots
 * ------------------------------------------------------
 */

function safeExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function resolveDataBase() {
  // 1) Priorité: variable d'env explicite
  if (process.env.DATA_DIR && String(process.env.DATA_DIR).trim() !== '') {
    return String(process.env.DATA_DIR).trim();
  }

  // 2) Railway le plus fréquent : volume monté dans /app/data
  if (safeExists('/app/data')) return '/app/data';

  // 3) Fallback: certains environnements utilisent /data
  if (safeExists('/data')) return '/data';

  // 4) Local / Replit
  return path.join(process.cwd(), 'data');
}

const DATA_BASE = resolveDataBase();
const SNAPSHOT_DIR = path.join(DATA_BASE, 'snapshots');

/**
 * Création automatique des dossiers nécessaires
 * Silencieux si existe déjà
 */
function ensureSnapshotDirectory() {
  try {
    if (!safeExists(DATA_BASE)) {
      fs.mkdirSync(DATA_BASE, { recursive: true });
      console.log(`📁 [paths] Dossier data créé : ${DATA_BASE}`);
    }

    if (!safeExists(SNAPSHOT_DIR)) {
      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
      console.log(`📁 [paths] Dossier snapshots créé : ${SNAPSHOT_DIR}`);
    }
  } catch (err) {
    console.error(`❌ [paths] Impossible de créer les dossiers data/snapshots`);
    console.error(err);
  }
}

module.exports = {
  DATA_BASE,
  SNAPSHOT_DIR,
  ensureSnapshotDirectory
};
