import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { dispatchQueuedNotifications } from "../services/notificationDispatcher.js";

let timer: NodeJS.Timeout | undefined;

async function tick(): Promise<void> {
  const result = await dispatchQueuedNotifications(prisma, {
    batchSize: env.notificationBatchSize,
    maxAttempts: env.notificationMaxAttempts
  });

  if (result.fetched > 0) {
    console.log(
      `notification-dispatch fetched=${result.fetched} sent=${result.sent} failed=${result.failed} skipped=${result.skipped}`
    );
  }
}

async function start(): Promise<void> {
  await tick();

  timer = setInterval(() => {
    void tick();
  }, env.notificationPollMs);

  console.log(`Notification worker started. pollMs=${env.notificationPollMs}`);
}

async function shutdown(): Promise<void> {
  if (timer) {
    clearInterval(timer);
  }

  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

void start();
