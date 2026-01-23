function log(...args) {
  console.log("[BOT]", ...args);
}

function warn(...args) {
  console.warn("[BOT_WARN]", ...args);
}

function error(...args) {
  console.error("[BOT_ERROR]", ...args);
}

module.exports = { log, warn, error };
