require("dotenv").config();

const { createClient } = require("./core/client");
const { loadAll } = require("./core/loader");

async function bootstrap() {
  const client = createClient();
  await loadAll(client);

  if (!process.env.TOKEN) {
    throw new Error("TOKEN manquant dans les variables d'environnement.");
  }

  await client.login(process.env.TOKEN);
}

bootstrap().catch((err) => {
  console.error("[BOOTSTRAP_ERROR]", err);
  process.exit(1);
});
