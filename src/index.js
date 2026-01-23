require("dotenv").config();

const { createClient } = require("./core/client");
const { loadAll } = require("./core/loader");
const { log } = require("./core/logger");

async function bootstrap() {
  if (!process.env.TOKEN) {
    console.error("[FATAL] TOKEN manquant dans les variables Railway.");
    process.exit(1);
  }

  const client = createClient();

  await loadAll(client);

  await client.login(process.env.TOKEN);
  log("Login lancé (en attente du ready)...");
}

bootstrap().catch((err) => {
  console.error("[BOOTSTRAP_ERROR]", err);
  process.exit(1);
});
