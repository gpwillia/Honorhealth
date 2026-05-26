import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { requireRole, userDirectory } from "../middleware/auth.js";

const scheduleQuerySchema = z.object({
  officerId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  location: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

const createScheduleSchema = z.object({
  officerId: z.string().min(1),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  location: z.string().min(1),
  roleRequired: z.string().min(1).default("Security Officer"),
  armedRequired: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
  sourceType: z.string().max(64).optional()
});

const updateScheduleSchema = z
  .object({
    officerId: z.string().min(1).optional(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    location: z.string().min(1).optional(),
    roleRequired: z.string().min(1).optional(),
    armedRequired: z.boolean().optional(),
    status: z.enum(["Assigned", "Posted"]).optional(),
    notes: z.string().max(1000).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one update field must be provided."
  });

function ensureOfficerExists(officerId: string): boolean {
  return Boolean(userDirectory[officerId] && userDirectory[officerId].role === "Officer");
}

export const scheduleRouter = Router();

scheduleRouter.get("/officers", requireRole(["Officer", "Supervisor"]), async (_req, res) => {
  const officers = Object.values(userDirectory)
    .filter((user) => user.role === "Officer")
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json(officers);
});

scheduleRouter.get("/schedule", requireRole(["Officer", "Supervisor"]), async (req, res) => {
  const parsed = scheduleQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.message });
    return;
  }

  const { officerId, from, to, location, page, pageSize } = parsed.data;
  const whereClause = {
    ...(req.user!.role === "Officer" ? { currentOfficerId: req.user!.id } : {}),
    ...(officerId ? { currentOfficerId: officerId } : {}),
    ...(location ? { location } : {}),
    ...(from || to
      ? {
          AND: [
            ...(from ? [{ endAt: { gte: from } }] : []),
            ...(to ? [{ startAt: { lte: to } }] : [])
          ]
        }
      : {})
  };

  const skip = (page - 1) * pageSize;
  const total = await prisma.shift.count({ where: whereClause });

  const shifts = await prisma.shift.findMany({
    where: whereClause,
    orderBy: { startAt: "asc" },
    skip,
    take: pageSize
  });

  res.setHeader("x-total-count", String(total));
  res.setHeader("x-page", String(page));
  res.setHeader("x-page-size", String(pageSize));
  res.json(shifts);
});

scheduleRouter.post("/schedule", requireRole(["Supervisor"]), async (req, res) => {
  const parsed = createScheduleSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.message });
    return;
  }

  const payload = parsed.data;

  if (!ensureOfficerExists(payload.officerId)) {
    res.status(400).json({ code: "INVALID_OFFICER", message: "Target officer is not valid." });
    return;
  }

  if (payload.endAt <= payload.startAt) {
    res.status(400).json({ code: "INVALID_TIME_RANGE", message: "endAt must be after startAt." });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const shift = await tx.shift.create({
      data: {
        currentOfficerId: payload.officerId,
        startAt: payload.startAt,
        endAt: payload.endAt,
        location: payload.location,
        roleRequired: payload.roleRequired,
        armedRequired: payload.armedRequired,
        status: "Assigned",
        scheduledById: req.user!.id,
        sourceType: payload.sourceType ?? "SupervisorCreated",
        notes: payload.notes,
        lastSyncedAt: new Date()
      }
    });

    await tx.auditLog.create({
      data: {
        requestId: null,
        actorId: req.user!.id,
        action: "SCHEDULE_CREATED",
        fromStatus: null,
        toStatus: shift.status,
        metadata: JSON.stringify({ shiftId: shift.id, officerId: shift.currentOfficerId })
      }
    });

    return shift;
  });

  res.status(201).json(result);
});

scheduleRouter.patch("/schedule/:id", requireRole(["Supervisor"]), async (req, res) => {
  const parsed = updateScheduleSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.message });
    return;
  }

  const existing = await prisma.shift.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ code: "SHIFT_NOT_FOUND", message: "Scheduled shift not found." });
    return;
  }

  if (parsed.data.officerId && !ensureOfficerExists(parsed.data.officerId)) {
    res.status(400).json({ code: "INVALID_OFFICER", message: "Target officer is not valid." });
    return;
  }

  const startAt = parsed.data.startAt ?? existing.startAt;
  const endAt = parsed.data.endAt ?? existing.endAt;

  if (endAt <= startAt) {
    res.status(400).json({ code: "INVALID_TIME_RANGE", message: "endAt must be after startAt." });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.shift.update({
      where: { id: existing.id },
      data: {
        currentOfficerId: parsed.data.officerId,
        startAt: parsed.data.startAt,
        endAt: parsed.data.endAt,
        location: parsed.data.location,
        roleRequired: parsed.data.roleRequired,
        armedRequired: parsed.data.armedRequired,
        status: parsed.data.status,
        notes: parsed.data.notes,
        lastSyncedAt: new Date()
      }
    });

    await tx.auditLog.create({
      data: {
        requestId: null,
        actorId: req.user!.id,
        action: "SCHEDULE_UPDATED",
        fromStatus: existing.status,
        toStatus: updated.status,
        metadata: JSON.stringify({ shiftId: updated.id, officerId: updated.currentOfficerId })
      }
    });

    return updated;
  });

  res.json(result);
});
