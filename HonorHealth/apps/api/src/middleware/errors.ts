import type { NextFunction, Request, Response } from "express";

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({
    code: "NOT_FOUND",
    message: "Route not found."
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const message = error instanceof Error ? error.message : "Unexpected server error";

  res.status(500).json({
    code: "INTERNAL_SERVER_ERROR",
    message
  });
}
