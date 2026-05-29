import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { requireRole } from "../middleware/auth.js";

const createTradeBoardPostSchema = z.object({
  shiftId: z.string().min(1)
});

const tradeBoardQuerySchema = z.object({
  roleRequired: z.string().optional(),
  location: z.string().optional(),
  date: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const shiftRouter = Router();

shiftRouter.get("/my-shifts", requireRole(["Officer", "Supervisor"]), async (req, res) => {
  const officerId = req.user!.id;
  const now = new Date();

  const shifts = await prisma.shift.findMany({
    where: {
      currentOfficerId: officerId,
      endAt: { gte: now }
    },
    orderBy: { startAt: "asc" }
  });

  const payload = shifts.map((shift) => ({
    ...shift,
    canPost: shift.status === "Assigned",
    reason: shift.status === "Assigned" ? null : "Shift already posted or traded"
  }));

  res.json(payload);
});

shiftRouter.post("/trade-board/posts", requireRole(["Officer"]), async (req, res) => {
  const parsed = createTradeBoardPostSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.message });
    return;
  }

  const shift = await prisma.shift.findUnique({ where: { id: parsed.data.shiftId } });

  if (!shift) {
    res.status(404).json({ code: "SHIFT_NOT_FOUND", message: "Shift not found." });
    return;
  }

  if (shift.currentOfficerId !== req.user!.id) {
    res.status(403).json({ code: "FORBIDDEN", message: "You can only post your own shift." });
    return;
  }

  if (shift.status !== "Assigned") {
    res.status(409).json({ code: "INVALID_SHIFT_STATE", message: "Shift is not eligible for posting." });
    return;
  }

  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: { status: "Posted" }
  });

  await prisma.auditLog.create({
    data: {
      requestId: null,
      actorId: req.user!.id,
      action: "SHIFT_POSTED",
      fromStatus: "Assigned",
      toStatus: "Posted",
      metadata: JSON.stringify({ shiftId: shift.id })
    }
  });

  res.status(201).json(updated);
});

shiftRouter.get("/trade-board/posts", requireRole(["Officer", "Supervisor"]), async (req, res) => {
  const parsed = tradeBoardQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const whereClause = {
    status: "Posted",
    roleRequired: data.roleRequired,
    location: data.location,
    ...(data.date
      ? {
          startAt: {
            gte: new Date(`${data.date}T00:00:00.000Z`),
            lt: new Date(`${data.date}T23:59:59.999Z`)
          }
        }
      : {})
  } as const;

  const skip = (data.page - 1) * data.pageSize;

  const total = await prisma.shift.count({ where: whereClause });

  const shifts = await prisma.shift.findMany({
    where: whereClause,
    orderBy: { startAt: "asc" },
    skip,
    take: data.pageSize
  });

  res.setHeader("x-total-count", String(total));
  res.setHeader("x-page", String(data.page));
  res.setHeader("x-page-size", String(data.pageSize));

  res.json(shifts);
});
