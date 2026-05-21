import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT ?? 4000),
  notificationPollMs: Number(process.env.NOTIFICATION_POLL_MS ?? 5000),
  notificationBatchSize: Number(process.env.NOTIFICATION_BATCH_SIZE ?? 25),
  notificationMaxAttempts: Number(process.env.NOTIFICATION_MAX_ATTEMPTS ?? 3)
};
