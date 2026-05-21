import type { NextFunction, Request, Response } from "express";
import type { RequestUser, UserRole } from "../domain/types.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: RequestUser;
  }
}

const generatedOfficers = Array.from({ length: 20 }, (_, i) => {
  const officerNumber = i + 1;
  return {
    id: `officer${officerNumber}`,
    role: "Officer" as const,
    name: `Officer ${officerNumber}`
  };
});

const userDirectory: Record<string, RequestUser> = {
  ...Object.fromEntries(generatedOfficers.map((officer) => [officer.id, officer])),
  officerA: { id: "officerA", role: "Officer", name: "Officer A" },
  officerB: { id: "officerB", role: "Officer", name: "Officer B" },
  supervisor1: { id: "supervisor1", role: "Supervisor", name: "Darren Viner" }
};

export function mockAuth(req: Request, _res: Response, next: NextFunction): void {
  const userId = (req.header("x-user-id") ?? "officer1").trim();
  req.user = userDirectory[userId] ?? userDirectory.officer1;
  next();
}

export function requireRole(allowed: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.user?.role;

    if (!role || !allowed.includes(role)) {
      res.status(403).json({
        code: "FORBIDDEN",
        message: "You do not have permission to access this resource."
      });
      return;
    }

    next();
  };
}
