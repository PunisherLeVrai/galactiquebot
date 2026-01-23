function now() {
  return new Date().toISOString();
}

function log(...args) {
  console.log(`[${now()}]`, ...args);
}

function warn(...args) {
  console.warn(`[${now()}]`, ...args);
}

function error(...args) {
  console.error(`[${now()}]`, ...args);
}

module.exports = { log, warn, error };
