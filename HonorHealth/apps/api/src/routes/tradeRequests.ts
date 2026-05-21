import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { evaluateTradeRequest } from "../services/validationEngine.js";

const createRequestSchema = z.object({
  shiftId: z.string().min(1)
});

const denyRequestSchema = z.object({
  reason: z.string().max(500).optional()
});

const tradeRequestQuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const tradeRequestRouter = Router();

tradeRequestRouter.post("/trade-requests", requireRole(["Officer"]), async (req, res) => {
  const parsed = createRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.message });
    return;
  }

  const shift = await prisma.shift.findUnique({ where: { id: parsed.data.shiftId } });

  if (!shift || shift.status !== "Posted") {
    res.status(404).json({ code: "SHIFT_NOT_POSTED", message: "Posted shift not found." });
    return;
  }

  if (shift.currentOfficerId === req.user!.id) {
    res.status(400).json({ code: "SELF_REQUEST_NOT_ALLOWED", message: "Cannot request your own shift." });
    return;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const request = await tx.tradeRequest.create({
        data: {
          shiftId: shift.id,
          postingOfficerId: shift.currentOfficerId,
          requestingOfficerId: req.user!.id,
          status: "PendingApproval"
        }
      });

      const validation = await evaluateTradeRequest(tx, shift, req.user!.id);

      await tx.validationResult.create({
        data: {
          requestId: request.id,
          armedCheck: validation.armedCheck,
          roleCheck: validation.roleCheck,
          restOtCheck: validation.restOtCheck,
          overallPass: validation.overallPass,
          details: validation.details
        }
      });

      await tx.auditLog.create({
        data: {
          requestId: request.id,
          actorId: req.user!.id,
          action: "REQUEST_CREATED",
          fromStatus: "Posted",
          toStatus: "PendingApproval",
          metadata: JSON.stringify({ shiftId: shift.id })
        }
      });

      return request;
    });

    res.status(201).json(result);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      res.status(409).json({
        code: "REQUEST_CONFLICT",
        message: "A pending request already exists for this shift."
      });
      return;
    }

    if (error instanceof Error) {
      res.status(409).json({ code: "REQUEST_CONFLICT", message: error.message });
      return;
    }

    throw error;
  }
});

tradeRequestRouter.get(
  "/trade-requests",
  requireRole(["Officer", "Supervisor"]),
  async (req, res) => {
    const parsed = tradeRequestQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.message });
      return;
    }

    const { status, page, pageSize } = parsed.data;
    const skip = (page - 1) * pageSize;
    const whereClause = {
      ...(status ? { status } : {}),
      ...(req.user!.role === "Officer"
        ? {
            OR: [
              { postingOfficerId: req.user!.id },
              { requestingOfficerId: req.user!.id }
            ]
          }
        : {})
    };

    const total = await prisma.tradeRequest.count({ where: whereClause });

    const requests = await prisma.tradeRequest.findMany({
      where: whereClause,
      include: {
        shift: true,
        validations: true
      },
      orderBy: { submittedAt: "desc" },
      skip,
      take: pageSize
    });

    res.setHeader("x-total-count", String(total));
    res.setHeader("x-page", String(page));
    res.setHeader("x-page-size", String(pageSize));

    res.json(requests);
  }
);

tradeRequestRouter.get(
  "/trade-requests/:id",
  requireRole(["Officer", "Supervisor"]),
  async (req, res) => {
    const request = await prisma.tradeRequest.findUnique({
      where: { id: req.params.id },
      include: {
        shift: true,
        validations: true,
        auditLogs: { orderBy: { timestamp: "asc" } }
      }
    });

    if (!request) {
      res.status(404).json({ code: "NOT_FOUND", message: "Trade request not found." });
      return;
    }

    if (
      req.user!.role === "Officer" &&
      request.postingOfficerId !== req.user!.id &&
      request.requestingOfficerId !== req.user!.id
    ) {
      res.status(403).json({ code: "FORBIDDEN", message: "Access denied for this request." });
      return;
    }

    res.json(request);
  }
);

tradeRequestRouter.post(
  "/trade-requests/:id/approve",
  requireRole(["Supervisor"]),
  async (req, res) => {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const request = await tx.tradeRequest.findUnique({ where: { id: req.params.id } });

        if (!request || request.status !== "PendingApproval") {
          throw new Error("Pending request not found.");
        }

        const shift = await tx.shift.findUnique({ where: { id: request.shiftId } });

        if (!shift || shift.status !== "Posted") {
          throw new Error("Shift is no longer posted.");
        }

        const validationComputation = await evaluateTradeRequest(
          tx,
          shift,
          request.requestingOfficerId
        );

        await tx.validationResult.create({
          data: {
            requestId: request.id,
            armedCheck: validationComputation.armedCheck,
            roleCheck: validationComputation.roleCheck,
            restOtCheck: validationComputation.restOtCheck,
            overallPass: validationComputation.overallPass,
            details: validationComputation.details
          }
        });

        if (!validationComputation.overallPass) {
          throw new Error("Validation failed. Approval blocked.");
        }

        await tx.shift.update({
          where: { id: request.shiftId },
          data: {
            currentOfficerId: request.requestingOfficerId,
            status: "Assigned"
          }
        });

        const approved = await tx.tradeRequest.update({
          where: { id: request.id },
          data: {
            status: "Approved",
            reviewedAt: new Date(),
            reviewedBy: req.user!.id
          }
        });

        await tx.auditLog.create({
          data: {
            requestId: request.id,
            actorId: req.user!.id,
            action: "REQUEST_APPROVED",
            fromStatus: "PendingApproval",
            toStatus: "Approved",
            metadata: JSON.stringify({ shiftId: request.shiftId })
          }
        });

        await tx.notification.createMany({
          data: [
            {
              recipientId: request.postingOfficerId,
              channel: "IN_APP",
              template: "RequestApproved",
              deliveryStatus: "Queued"
            },
            {
              recipientId: request.requestingOfficerId,
              channel: "IN_APP",
              template: "RequestApproved",
              deliveryStatus: "Queued"
            }
          ]
        });

        return approved;
      });

      res.json(result);
    } catch (error) {
      if (error instanceof Error) {
        res.status(409).json({ code: "APPROVAL_FAILED", message: error.message });
        return;
      }

      throw error;
    }
  }
);

tradeRequestRouter.post(
  "/trade-requests/:id/deny",
  requireRole(["Supervisor"]),
  async (req, res) => {
    const parsed = denyRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.message });
      return;
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const request = await tx.tradeRequest.findUnique({ where: { id: req.params.id } });

        if (!request || request.status !== "PendingApproval") {
          throw new Error("Pending request not found.");
        }

        const denied = await tx.tradeRequest.update({
          where: { id: request.id },
          data: {
            status: "Denied",
            reviewedAt: new Date(),
            reviewedBy: req.user!.id,
            denialReason: parsed.data.reason
          }
        });

        await tx.auditLog.create({
          data: {
            requestId: request.id,
            actorId: req.user!.id,
            action: "REQUEST_DENIED",
            fromStatus: "PendingApproval",
            toStatus: "Denied",
            metadata: JSON.stringify({ reason: parsed.data.reason ?? null })
          }
        });

        await tx.notification.createMany({
          data: [
            {
              recipientId: request.postingOfficerId,
              channel: "IN_APP",
              template: "RequestDenied",
              deliveryStatus: "Queued"
            },
            {
              recipientId: request.requestingOfficerId,
              channel: "IN_APP",
              template: "RequestDenied",
              deliveryStatus: "Queued"
            }
          ]
        });

        return denied;
      });

      res.json(result);
    } catch (error) {
      if (error instanceof Error) {
        res.status(409).json({ code: "DENIAL_FAILED", message: error.message });
        return;
      }

      throw error;
    }
  }
);
