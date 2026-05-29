import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { getOfficerProfile } from "../domain/officerProfiles.js";
import { requireRole } from "../middleware/auth.js";

const analyticsQuerySchema = z.object({
  location: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  view: z.enum(["weekly", "monthly", "yearly", "custom"]).default("monthly")
});

function percentile(values: number[], target: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(target * sorted.length) - 1;
  return Number(sorted[Math.max(0, index)].toFixed(2));
}

function median(values: number[]): number | null {
  return percentile(values, 0.5);
}

function hoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

function startOfWeekSundayUtc(value: Date): Date {
  const start = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start;
}

function startOfMonthUtc(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function monthLabel(value: Date): string {
  return value.toISOString().slice(0, 7);
}

type DenialBucket = Record<string, number>;
type LocationCountBucket = Record<string, number>;

interface DenialAggregation {
  count: number;
  locationCounts: LocationCountBucket;
}

function resolveAnalyticsRange(
  view: "weekly" | "monthly" | "yearly" | "custom",
  from?: Date,
  to?: Date
): { from: Date; to: Date } {
  const now = new Date();

  if (view === "custom") {
    const customFrom = from ? new Date(from) : new Date(now.getTime() - 1000 * 60 * 60 * 24 * 28);
    const customTo = to ? new Date(to) : now;
    return { from: customFrom, to: customTo };
  }

  if (view === "weekly") {
    return { from: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 7), to: now };
  }

  if (view === "yearly") {
    return { from: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 365), to: now };
  }

  return { from: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30), to: now };
}

function getTrendBucket(value: Date, view: "weekly" | "monthly" | "yearly" | "custom"): string {
  if (view === "weekly") {
    return value.toISOString().slice(0, 10);
  }

  if (view === "yearly") {
    return monthLabel(startOfMonthUtc(value));
  }

  return startOfWeekSundayUtc(value).toISOString().slice(0, 10);
}

function policyFromValidationDetails(details?: string | null): string {
  if (!details) {
    return "Supervisor Discretion / Other";
  }

  try {
    const parsed = JSON.parse(details) as {
      armedRequired?: boolean;
      officerArmedQualified?: boolean;
      roleRequired?: string;
      officerRoles?: string[];
      totalHours?: number;
      maxHours?: number;
      hasOverlap?: boolean;
    };

    if (parsed.armedRequired && parsed.officerArmedQualified === false) {
      return "Armed Qualification Policy";
    }

    if (parsed.roleRequired && Array.isArray(parsed.officerRoles) && !parsed.officerRoles.includes(parsed.roleRequired)) {
      return "Role Qualification Policy";
    }

    if (parsed.hasOverlap || (parsed.totalHours ?? 0) > (parsed.maxHours ?? 12)) {
      return "Rest / OT Policy";
    }
  } catch {
    return "Supervisor Discretion / Other";
  }

  return "Supervisor Discretion / Other";
}

function classifyDenialReason(input: {
  denialReason?: string | null;
  details?: string | null;
}): string {
  const denialReason = input.denialReason?.trim();
  if (denialReason) {
    return denialReason;
  }

  if (!input.details) {
    return "Manual review / policy decision";
  }

  try {
    const parsed = JSON.parse(input.details) as {
      armedRequired?: boolean;
      officerArmedQualified?: boolean;
      roleRequired?: string;
      officerRoles?: string[];
      totalHours?: number;
      maxHours?: number;
      hasOverlap?: boolean;
    };

    if (parsed.armedRequired && parsed.officerArmedQualified === false) {
      return "Armed qualification mismatch";
    }

    if (parsed.roleRequired && Array.isArray(parsed.officerRoles) && !parsed.officerRoles.includes(parsed.roleRequired)) {
      return "Role qualification mismatch";
    }

    if (parsed.hasOverlap || (parsed.totalHours ?? 0) > (parsed.maxHours ?? 12)) {
      return "Rest / OT limit";
    }
  } catch {
    return "Policy / validation rule";
  }

  return "Policy / validation rule";
}

export const analyticsRouter = Router();

analyticsRouter.get("/analytics", requireRole(["Supervisor"]), async (req, res) => {
  const parsed = analyticsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.message });
    return;
  }

  const view = parsed.data.view;
  const resolvedRange = resolveAnalyticsRange(view, parsed.data.from, parsed.data.to);
  const from = resolvedRange.from;
  const to = resolvedRange.to;
  const location = parsed.data.location;

  const shiftWhere = {
    ...(location ? { location } : {}),
    startAt: { gte: from, lte: to }
  };

  const shifts = await prisma.shift.findMany({
    where: shiftWhere,
    include: {
      tradeRequests: {
        include: {
          validations: {
            orderBy: { evaluatedAt: "desc" }
          }
        }
      }
    }
  });

  const shiftIds = shifts.map((shift) => shift.id);

  const postedAuditLogs = shiftIds.length
    ? await prisma.auditLog.findMany({
        where: {
          action: "SHIFT_POSTED",
          timestamp: { gte: from, lte: to }
        },
        orderBy: { timestamp: "asc" }
      })
    : [];

  const postedAtByShiftId = new Map<string, Date>();
  for (const log of postedAuditLogs) {
    try {
      const metadata = log.metadata ? JSON.parse(log.metadata) as { shiftId?: string } : {};
      if (metadata.shiftId && shiftIds.includes(metadata.shiftId) && !postedAtByShiftId.has(metadata.shiftId)) {
        postedAtByShiftId.set(metadata.shiftId, log.timestamp);
      }
    } catch {
      continue;
    }
  }

  const postedShifts = shifts.filter((shift) => postedAtByShiftId.has(shift.id) || shift.status === "Posted");
  const approvedRequests = shifts.flatMap((shift) =>
    shift.tradeRequests.filter((request) => request.status === "Approved")
  );
  const deniedRequests = shifts.flatMap((shift) =>
    shift.tradeRequests.filter((request) => request.status === "Denied")
  );
  const reviewedRequests = shifts.flatMap((shift) =>
    shift.tradeRequests.filter((request) => request.reviewedAt)
  );

  const timeToFillHours = approvedRequests
    .map((request) => {
      const postedAt = postedAtByShiftId.get(request.shiftId);
      if (!postedAt || !request.reviewedAt) {
        return null;
      }

      return hoursBetween(postedAt, request.reviewedAt);
    })
    .filter((value): value is number => value !== null && value >= 0);

  const approvalCycleHours = reviewedRequests.map((request) =>
    hoursBetween(request.submittedAt, request.reviewedAt!)
  );

  const denialBucket: DenialBucket = {};
  const policyDenials: Record<string, DenialAggregation> = {};
  for (const request of deniedRequests) {
    const latestValidation = request.validations[0];
    const category = classifyDenialReason({
      denialReason: request.denialReason,
      details: latestValidation?.details
    });
    denialBucket[category] = (denialBucket[category] ?? 0) + 1;

    const policy = policyFromValidationDetails(latestValidation?.details);
    const bucket = policyDenials[policy] ?? { count: 0, locationCounts: {} };
    bucket.count += 1;

    const deniedLocation = shifts.find((shift) => shift.id === request.shiftId)?.location ?? "Unknown";
    bucket.locationCounts[deniedLocation] = (bucket.locationCounts[deniedLocation] ?? 0) + 1;
    policyDenials[policy] = bucket;
  }

  const pickupByOfficer = new Map<string, number>();
  for (const request of approvedRequests) {
    pickupByOfficer.set(
      request.requestingOfficerId,
      (pickupByOfficer.get(request.requestingOfficerId) ?? 0) + 1
    );
  }

  const trendMap = new Map<string, { posted: number; filled: number; unfilled: number }>();
  const trendByLocationMap = new Map<string, Map<string, { posted: number; filled: number; unfilled: number }>>();
  for (const shift of postedShifts) {
    const bucket = getTrendBucket(shift.startAt, view);
    const existing = trendMap.get(bucket) ?? { posted: 0, filled: 0, unfilled: 0 };
    existing.posted += 1;
    const hasApproved = shift.tradeRequests.some((request) => request.status === "Approved");
    if (hasApproved) {
      existing.filled += 1;
    }
    if (shift.status === "Posted") {
      existing.unfilled += 1;
    }
    trendMap.set(bucket, existing);

    const byLocation = trendByLocationMap.get(shift.location) ?? new Map<string, { posted: number; filled: number; unfilled: number }>();
    const locationBucket = byLocation.get(bucket) ?? { posted: 0, filled: 0, unfilled: 0 };
    locationBucket.posted += 1;
    if (hasApproved) {
      locationBucket.filled += 1;
    }
    if (shift.status === "Posted") {
      locationBucket.unfilled += 1;
    }
    byLocation.set(bucket, locationBucket);
    trendByLocationMap.set(shift.location, byLocation);
  }

  const overallTrend = Array.from(trendMap.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, value]) => ({
      period,
      posted: value.posted,
      filled: value.filled,
      unfilled: value.unfilled,
      fillRate: value.posted > 0 ? Number(((value.filled / value.posted) * 100).toFixed(1)) : 0
    }));

  const trendByLocation = Array.from(trendByLocationMap.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([locationName, locationMap]) => ({
      location: locationName,
      points: Array.from(locationMap.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([period, value]) => ({
          period,
          posted: value.posted,
          filled: value.filled,
          unfilled: value.unfilled,
          fillRate: value.posted > 0 ? Number(((value.filled / value.posted) * 100).toFixed(1)) : 0
        }))
    }));

  const postedShiftCount = postedShifts.length;
  const filledShiftIds = new Set(approvedRequests.map((request) => request.shiftId));
  const filledShiftCount = filledShiftIds.size;
  const unfilledShiftCount = postedShifts.filter((shift) => shift.status === "Posted").length;

  const locationCoverage = shifts.reduce((acc, shift) => {
    const existing = acc.get(shift.location) ?? {
      shiftCount: 0,
      postedCount: 0,
      filledCount: 0,
      unfilledCount: 0,
      armedOfficerIds: new Set<string>(),
      unarmedOfficerIds: new Set<string>()
    };

    existing.shiftCount += 1;
    const hasPostedEvent = postedAtByShiftId.has(shift.id) || shift.status === "Posted";
    if (hasPostedEvent) {
      existing.postedCount += 1;
    }

    const isFilled = shift.tradeRequests.some((request) => request.status === "Approved");
    if (isFilled) {
      existing.filledCount += 1;
    }

    if (shift.status === "Posted") {
      existing.unfilledCount += 1;
    }

    const profile = getOfficerProfile(shift.currentOfficerId);
    if (profile?.armedQualified) {
      existing.armedOfficerIds.add(shift.currentOfficerId);
    } else {
      existing.unarmedOfficerIds.add(shift.currentOfficerId);
    }

    acc.set(shift.location, existing);
    return acc;
  }, new Map<string, {
    shiftCount: number;
    postedCount: number;
    filledCount: number;
    unfilledCount: number;
    armedOfficerIds: Set<string>;
    unarmedOfficerIds: Set<string>;
  }>());

  const locationCoverageRows = Array.from(locationCoverage.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([locationName, item]) => {
      const armedOfficerCount = item.armedOfficerIds.size;
      const unarmedOfficerCount = item.unarmedOfficerIds.size;
      const ratio = unarmedOfficerCount === 0 ? `${armedOfficerCount}:0` : `${armedOfficerCount}:${unarmedOfficerCount}`;

      return {
        location: locationName,
        shiftCount: item.shiftCount,
        postedCount: item.postedCount,
        filledCount: item.filledCount,
        unfilledCount: item.unfilledCount,
        armedOfficerCount,
        unarmedOfficerCount,
        armedToUnarmedRatio: ratio
      };
    });

  res.json({
    filters: {
      location: location ?? null,
      from: from.toISOString(),
      to: to.toISOString(),
      view
    },
    metrics: {
      postedShiftCount,
      filledShiftCount,
      unfilledShiftCount,
      shiftFillRate: postedShiftCount > 0 ? Number(((filledShiftCount / postedShiftCount) * 100).toFixed(1)) : 0,
      medianTimeToFillHours: median(timeToFillHours),
      p90TimeToFillHours: percentile(timeToFillHours, 0.9),
      medianApprovalCycleHours: median(approvalCycleHours)
    },
    locationCoverage: locationCoverageRows,
    policyDenials: Object.entries(policyDenials)
      .sort((left, right) => right[1].count - left[1].count)
      .map(([policy, value]) => ({
        policy,
        count: value.count,
        locationCounts: Object.entries(value.locationCounts)
          .sort((left, right) => right[1] - left[1])
          .map(([locationName, count]) => ({ location: locationName, count }))
      })),
    denialReasons: Object.entries(denialBucket)
      .sort((left, right) => right[1] - left[1])
      .map(([reason, count]) => ({ reason, count })),
    pickupConcentration: Array.from(pickupByOfficer.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([officerId, approvals]) => ({
        officerId,
        approvals,
        share: approvedRequests.length > 0 ? Number(((approvals / approvedRequests.length) * 100).toFixed(1)) : 0
      })),
    trend: {
      overall: overallTrend,
      byLocation: trendByLocation
    }
  });
});