import { Router } from "express";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { dispatchQueuedNotifications } from "../services/notificationDispatcher.js";

export const notificationRouter = Router();

notificationRouter.post(
  "/notifications/dispatch",
  requireRole(["Supervisor"]),
  async (_req, res) => {
    const result = await dispatchQueuedNotifications(prisma, {
      batchSize: env.notificationBatchSize,
      maxAttempts: env.notificationMaxAttempts
    });

    res.json(result);
  }
);
