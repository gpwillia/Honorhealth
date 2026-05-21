import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { mockAuth } from "./middleware/auth.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { notificationRouter } from "./routes/notifications.js";
import { healthRouter } from "./routes/health.js";
import { shiftRouter } from "./routes/shifts.js";
import { tradeRequestRouter } from "./routes/tradeRequests.js";

function resolveWebDistPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "../web/dist"),
    path.resolve(process.cwd(), "apps/web/dist")
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return null;
}

export function buildApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(mockAuth);

  app.use(healthRouter);
  app.use("/api", shiftRouter);
  app.use("/api", tradeRequestRouter);
  app.use("/api", notificationRouter);

  const webDistPath = resolveWebDistPath();
  if (webDistPath) {
    app.use(express.static(webDistPath));
    app.get(/^\/(?!api).*/, (_req, res) => {
      res.sendFile(path.join(webDistPath, "index.html"));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
