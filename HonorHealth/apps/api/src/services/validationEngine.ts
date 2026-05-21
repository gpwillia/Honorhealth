import type { Prisma, Shift } from "@prisma/client";
import { getOfficerProfile } from "../domain/officerProfiles.js";

interface ValidationComputation {
  armedCheck: boolean;
  roleCheck: boolean;
  restOtCheck: boolean;
  overallPass: boolean;
  details: string;
}

function getDayWindow(date: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  return { dayStart, dayEnd };
}

function getHours(startAt: Date, endAt: Date): number {
  return (endAt.getTime() - startAt.getTime()) / (1000 * 60 * 60);
}

export async function evaluateTradeRequest(
  tx: Prisma.TransactionClient,
  shift: Shift,
  requestingOfficerId: string
): Promise<ValidationComputation> {
  const profile = getOfficerProfile(requestingOfficerId);
  const profileRoles = profile?.roles ?? [];
  const profileArmedQualified = profile?.armedQualified ?? false;

  const armedCheck = Boolean(profile) && (!shift.armedRequired || profileArmedQualified);
  const roleCheck = Boolean(profile) && profileRoles.includes(shift.roleRequired);

  const { dayStart, dayEnd } = getDayWindow(shift.startAt);

  const sameDayShifts = await tx.shift.findMany({
    where: {
      currentOfficerId: requestingOfficerId,
      id: { not: shift.id },
      status: { in: ["Assigned", "Posted"] },
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart }
    }
  });

  const hasOverlap = sameDayShifts.some(
    (existingShift) => existingShift.startAt < shift.endAt && existingShift.endAt > shift.startAt
  );

  const existingHours = sameDayShifts.reduce(
    (sum, existingShift) => sum + getHours(existingShift.startAt, existingShift.endAt),
    0
  );

  const candidateHours = getHours(shift.startAt, shift.endAt);
  const totalHours = existingHours + candidateHours;
  const restOtCheck = !hasOverlap && totalHours <= 12;

  const overallPass = armedCheck && roleCheck && restOtCheck;

  return {
    armedCheck,
    roleCheck,
    restOtCheck,
    overallPass,
    details: JSON.stringify({
      armedRequired: shift.armedRequired,
      officerArmedQualified: profileArmedQualified,
      roleRequired: shift.roleRequired,
      officerRoles: profileRoles,
      hasOverlap,
      existingHours,
      candidateHours,
      totalHours,
      maxHours: 12
    })
  };
}
