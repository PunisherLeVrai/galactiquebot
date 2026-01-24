// src/index.js
require("dotenv").config();

const { createClient } = require("./core/client");
const { loadAll } = require("./core/loader");
const { log, error } = require("./core/logger");

async function bootstrap() {
  const client = createClient();

  await loadAll(client);

  if (!process.env.TOKEN) {
    throw new Error("TOKEN manquant dans .env / Railway variables.");
  }

  await client.login(process.env.TOKEN);
  log("Login lancé (en attente du ready)...");
}

bootstrap().catch((err) => {
  error("[BOOTSTRAP_ERROR]", err);
  process.exit(1);
});
