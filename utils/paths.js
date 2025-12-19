// utils/paths.js
const fs = require('fs');
const path = require('path');

/**
 * 📁 Gestion persistante des données
 * Priorité :
 * 1) DATA_DIR (env)
 * 2) /app/data (Railway volume)
 * 3) /data
 * 4) ./data (local / Replit)
 */

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function resolveDataBase() {
  if (process.env.DATA_DIR?.trim()) return process.env.DATA_DIR.trim();
  if (exists('/app/data')) return '/app/data';
  if (exists('/data')) return '/data';
  return path.join(process.cwd(), 'data');
}

const DATA_BASE = resolveDataBase();
const SNAPSHOT_DIR = path.join(DATA_BASE, 'snapshots');

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

module.exports = {
  DATA_BASE,
  SNAPSHOT_DIR,
  ensureSnapshotDirectory
};
