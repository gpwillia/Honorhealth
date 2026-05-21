import cors from "cors";
import express from "express";
import { mockAuth } from "./middleware/auth.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { notificationRouter } from "./routes/notifications.js";
import { healthRouter } from "./routes/health.js";
import { shiftRouter } from "./routes/shifts.js";
import { tradeRequestRouter } from "./routes/tradeRequests.js";

export function buildApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(mockAuth);

  app.use(healthRouter);
  app.use("/api", shiftRouter);
  app.use("/api", tradeRequestRouter);
  app.use("/api", notificationRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
