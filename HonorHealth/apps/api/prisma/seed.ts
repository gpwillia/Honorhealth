import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const prisma = new PrismaClient();

const officerCount = 20;
const officers = Array.from({ length: officerCount }, (_, i) => ({
  id: `officer${i + 1}`,
  name: `Officer ${String.fromCharCode(65 + (i % 26))}${i + 1}`,
  role: "Security Officer",
  armed: i % 2 === 0 // Alternate armed/unarmed
}));

const locations = [
  "JCL",
  "Deer Valley",
  "Thunderbird",
  "Osborn",
  "Shea",
  "TMC",
  "Hospital (New)"
];

const shiftTemplates = [
  { id: "0000-0600", startHour: 0, endHour: 6, overnight: false },
  { id: "0600-1200", startHour: 6, endHour: 12, overnight: false },
  { id: "1200-1800", startHour: 12, endHour: 18, overnight: false },
  { id: "1800-0000", startHour: 18, endHour: 0, overnight: true }
] as const;

function startOfWeekSunday(value: Date): Date {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function buildShiftWindow(dayOffset: number, template: (typeof shiftTemplates)[number]) {
  const start = startOfWeekSunday(new Date());
  start.setDate(start.getDate() + dayOffset);
  start.setHours(template.startHour, 0, 0, 0);

  const end = new Date(start);
  if (template.overnight) {
    end.setDate(end.getDate() + 1);
  }
  end.setHours(template.endHour, 0, 0, 0);

  return { startAt: start, endAt: end };
}

function addHours(value: Date, hours: number): Date {
  return new Date(value.getTime() + hours * 60 * 60 * 1000);
}

type RequestOutcome = "Approved" | "Denied" | "PendingApproval";

function getRequestOutcome(seed: number): RequestOutcome {
  const value = seed % 10;
  if (value <= 4) {
    return "Approved";
  }
  if (value <= 7) {
    return "Denied";
  }
  return "PendingApproval";
}

const deniedPolicyCatalog = [
  {
    reason: "Denied due to armed qualification requirement.",
    details: {
      armedRequired: true,
      officerArmedQualified: false,
      roleRequired: "Security Officer",
      officerRoles: ["Security Officer"],
      totalHours: 8,
      maxHours: 12,
      hasOverlap: false
    }
  },
  {
    reason: "Denied due to required role mismatch.",
    details: {
      armedRequired: false,
      officerArmedQualified: true,
      roleRequired: "Security Lead",
      officerRoles: ["Security Officer"],
      totalHours: 8,
      maxHours: 12,
      hasOverlap: false
    }
  },
  {
    reason: "Denied due to rest/OT threshold policy.",
    details: {
      armedRequired: false,
      officerArmedQualified: true,
      roleRequired: "Security Officer",
      officerRoles: ["Security Officer"],
      totalHours: 14,
      maxHours: 12,
      hasOverlap: true
    }
  },
  {
    reason: "Denied by supervisor due to site-specific staffing constraints.",
    details: {
      armedRequired: false,
      officerArmedQualified: true,
      roleRequired: "Security Officer",
      officerRoles: ["Security Officer"],
      totalHours: 10,
      maxHours: 12,
      hasOverlap: false,
      staffingConstraint: true
    }
  }
] as const;

async function main() {
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.validationResult.deleteMany();
  await prisma.tradeRequest.deleteMany();
  await prisma.shift.deleteMany();

  const coverageByTemplate = [5, 5, 4, 6];
  const weekDays = Array.from({ length: 7 }, (_, index) => index);
  const weeksOfHistory = 20;
  const shifts: Array<{
    id: string;
    currentOfficerId: string;
    startAt: Date;
    endAt: Date;
    location: string;
    roleRequired: string;
    armedRequired: boolean;
    status: "Assigned" | "Posted";
    sourceType: string;
    lastSyncedAt: Date;
  }> = [];

  const tradeRequests: Array<{
    id: string;
    shiftId: string;
    postingOfficerId: string;
    requestingOfficerId: string;
    status: string;
    submittedAt: Date;
    reviewedAt: Date | null;
    reviewedBy: string | null;
    denialReason: string | null;
  }> = [];

  const validationResults: Array<{
    requestId: string;
    armedCheck: boolean;
    roleCheck: boolean;
    restOtCheck: boolean;
    overallPass: boolean;
    details: string;
    evaluatedAt: Date;
  }> = [];

  const auditLogs: Array<{
    requestId: string | null;
    actorId: string;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    metadata: string;
    timestamp: Date;
  }> = [];

  for (let weekOffset = 0; weekOffset < weeksOfHistory; weekOffset += 1) {
    for (const dayOffset of weekDays) {
      for (const [templateIndex, template] of shiftTemplates.entries()) {
        const officerCountForShift = coverageByTemplate[templateIndex];
        const officerOffset = (weekOffset * 7 + dayOffset * 3 + templateIndex * 5) % officers.length;

        for (let slotIndex = 0; slotIndex < officerCountForShift; slotIndex += 1) {
          const officer = officers[(officerOffset + slotIndex) % officers.length];
          const { startAt, endAt } = buildShiftWindow(dayOffset - weekOffset * 7, template);

          const shiftId = `shift_w${weekOffset}_d${dayOffset}_${template.id}_${officer.id}_${slotIndex}`;
          const location = locations[(weekOffset + dayOffset + templateIndex) % locations.length];
          const requestSeed = weekOffset * 100 + dayOffset * 10 + templateIndex * 3 + slotIndex;
          const shouldOpenForTrade = slotIndex === 0 || (slotIndex === 1 && requestSeed % 3 === 0);

          let status: "Assigned" | "Posted" = "Assigned";
          let currentOfficerId = officer.id;

          if (shouldOpenForTrade) {
            const postedAt = addHours(startAt, -24);
            auditLogs.push({
              requestId: null,
              actorId: `supervisor${(weekOffset % 3) + 1}`,
              action: "SHIFT_POSTED",
              fromStatus: "Assigned",
              toStatus: "Posted",
              metadata: JSON.stringify({ shiftId, location }),
              timestamp: postedAt
            });

            const outcome = getRequestOutcome(requestSeed);
            const requestingOfficer = officers[(officerOffset + slotIndex + 4) % officers.length];
            const requestId = `request_${shiftId}`;
            const submittedAt = addHours(postedAt, (requestSeed % 18) + 2);
            const reviewedAt = outcome === "PendingApproval" ? null : addHours(submittedAt, (requestSeed % 24) + 3);
            const deniedPolicy = deniedPolicyCatalog[requestSeed % deniedPolicyCatalog.length];

            tradeRequests.push({
              id: requestId,
              shiftId,
              postingOfficerId: officer.id,
              requestingOfficerId: requestingOfficer.id,
              status: outcome,
              submittedAt,
              reviewedAt,
              reviewedBy: reviewedAt ? `supervisor${(requestSeed % 3) + 1}` : null,
              denialReason: outcome === "Denied" ? deniedPolicy.reason : null
            });

            auditLogs.push({
              requestId,
              actorId: requestingOfficer.id,
              action: "REQUEST_CREATED",
              fromStatus: "Posted",
              toStatus: "PendingApproval",
              metadata: JSON.stringify({ shiftId, location }),
              timestamp: submittedAt
            });

            if (outcome === "Approved") {
              status = "Assigned";
              currentOfficerId = requestingOfficer.id;

              validationResults.push({
                requestId,
                armedCheck: true,
                roleCheck: true,
                restOtCheck: true,
                overallPass: true,
                details: JSON.stringify({
                  armedRequired: officer.armed,
                  officerArmedQualified: requestingOfficer.armed,
                  roleRequired: "Security Officer",
                  officerRoles: ["Security Officer"],
                  totalHours: 8,
                  maxHours: 12,
                  hasOverlap: false
                }),
                evaluatedAt: addHours(submittedAt, 1)
              });

              if (reviewedAt) {
                auditLogs.push({
                  requestId,
                  actorId: `supervisor${(requestSeed % 3) + 1}`,
                  action: "REQUEST_APPROVED",
                  fromStatus: "PendingApproval",
                  toStatus: "Approved",
                  metadata: JSON.stringify({ shiftId, location }),
                  timestamp: reviewedAt
                });
              }
            }

            if (outcome === "Denied") {
              status = "Posted";

              validationResults.push({
                requestId,
                armedCheck: deniedPolicy.reason.includes("armed") ? false : true,
                roleCheck: deniedPolicy.reason.includes("role") ? false : true,
                restOtCheck: deniedPolicy.reason.includes("rest/OT") ? false : true,
                overallPass: false,
                details: JSON.stringify(deniedPolicy.details),
                evaluatedAt: addHours(submittedAt, 1)
              });

              if (reviewedAt) {
                auditLogs.push({
                  requestId,
                  actorId: `supervisor${(requestSeed % 3) + 1}`,
                  action: "REQUEST_DENIED",
                  fromStatus: "PendingApproval",
                  toStatus: "Denied",
                  metadata: JSON.stringify({ shiftId, location }),
                  timestamp: reviewedAt
                });
              }
            }

            if (outcome === "PendingApproval") {
              status = "Posted";

              validationResults.push({
                requestId,
                armedCheck: true,
                roleCheck: true,
                restOtCheck: true,
                overallPass: true,
                details: JSON.stringify({
                  armedRequired: officer.armed,
                  officerArmedQualified: requestingOfficer.armed,
                  roleRequired: "Security Officer",
                  officerRoles: ["Security Officer"],
                  totalHours: 9,
                  maxHours: 12,
                  hasOverlap: false
                }),
                evaluatedAt: addHours(submittedAt, 1)
              });
            }
          }

          shifts.push({
            id: shiftId,
            currentOfficerId,
            startAt,
            endAt,
            location,
            roleRequired: officer.role,
            armedRequired: officer.armed,
            status,
            sourceType: template.id,
            lastSyncedAt: new Date()
          });
        }
      }
    }
  }

  await prisma.shift.createMany({ data: shifts });
  await prisma.tradeRequest.createMany({ data: tradeRequests });
  await prisma.validationResult.createMany({ data: validationResults });
  await prisma.auditLog.createMany({ data: auditLogs });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
