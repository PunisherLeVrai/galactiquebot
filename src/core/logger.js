// src/core/logger.js
function ts() {
  return new Date().toISOString();
}

function log(...args) {
  console.log(`[${ts()}]`, ...args);
}

function warn(...args) {
  console.warn(`[${ts()}]`, ...args);
}

function error(...args) {
  console.error(`[${ts()}]`, ...args);
}

module.exports = { log, warn, error };
