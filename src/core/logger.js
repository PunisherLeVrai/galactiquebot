// src/core/logger.js
// Logger simple

function ts() {
  return new Date().toISOString();
}

function log(...args) {
  console.log(`[${ts()}]`, ...args);
}

function warn(...args) {
  console.warn(`[${ts()}]`, ...args);
}

module.exports = { log, warn };
