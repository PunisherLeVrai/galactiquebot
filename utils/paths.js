// utils/paths.js
const fs = require('fs');
const path = require('path');

/**
 * 📁 Gestion persistante des données (Railway / Local)
 *
 * Priorité :
 * 1) DATA_DIR (env)
 * 2) /mnt/storage      ✅ Railway Volume (ACTUEL)
 * 3) /app/data         (ancien / fallback)
 * 4) /data
 * 5) ./data (local / dev)
 */

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function resolveDataBase() {
  if (process.env.DATA_DIR?.trim()) return process.env.DATA_DIR.trim();
  if (exists('/mnt/storage')) return '/mnt/storage'; // ✅ TON VOLUME
  if (exists('/app/data')) return '/app/data';
  if (exists('/data')) return '/data';
  return path.join(process.cwd(), 'data');
}

const DATA_BASE = resolveDataBase();

// 📂 Dossiers persistants
const SNAPSHOT_DIR = path.join(DATA_BASE, 'snapshots');
const RAPPORTS_DIR = path.join(DATA_BASE, 'rapports');
const DATA_DIR = path.join(DATA_BASE, 'data'); // absences, stats, etc.

function ensureDir(dir) {
  try {
    if (!exists(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error(`❌ [paths] mkdir failed: ${dir}`, e);
  }
}

function ensureSnapshotDirectory() {
  ensureDir(DATA_BASE);
  ensureDir(SNAPSHOT_DIR);
}

function ensureRapportsDirectory() {
  ensureDir(DATA_BASE);
  ensureDir(RAPPORTS_DIR);
}

function ensureDataDirectory() {
  ensureDir(DATA_BASE);
  ensureDir(DATA_DIR);
}

module.exports = {
  DATA_BASE,
  SNAPSHOT_DIR,
  RAPPORTS_DIR,
  DATA_DIR,
  ensureSnapshotDirectory,
  ensureRapportsDirectory,
  ensureDataDirectory
};
