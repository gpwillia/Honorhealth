import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { buildApp } from "./app.js";

const app = buildApp();

const server = app.listen(env.port, () => {
  console.log(`API listening on port ${env.port}`);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
});
