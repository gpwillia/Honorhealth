import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db/prisma.js";

const app = buildApp();

async function resetDatabase(): Promise<void> {
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.validationResult.deleteMany();
  await prisma.tradeRequest.deleteMany();
  await prisma.shift.deleteMany();
}

describe("Analytics API", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns coverage, policy denials, and trend data for supervisors", async () => {
    await prisma.shift.createMany({
      data: [
        {
          id: "analytics_shift_1",
          currentOfficerId: "officer1",
          startAt: new Date("2026-06-01T06:00:00.000Z"),
          endAt: new Date("2026-06-01T18:00:00.000Z"),
          location: "Deer Valley",
          roleRequired: "Security Officer",
          armedRequired: false,
          status: "Assigned",
          sourceType: "0600-1800"
        },
        {
          id: "analytics_shift_2",
          currentOfficerId: "officer2",
          startAt: new Date("2026-06-02T06:00:00.000Z"),
          endAt: new Date("2026-06-02T18:00:00.000Z"),
          location: "Deer Valley",
          roleRequired: "Security Officer",
          armedRequired: true,
          status: "Posted",
          sourceType: "0600-1800"
        }
      ]
    });

    await prisma.auditLog.createMany({
      data: [
        {
          actorId: "officer1",
          action: "SHIFT_POSTED",
          fromStatus: "Assigned",
          toStatus: "Posted",
          metadata: JSON.stringify({ shiftId: "analytics_shift_1" }),
          timestamp: new Date("2026-05-31T12:00:00.000Z")
        },
        {
          actorId: "officer2",
          action: "SHIFT_POSTED",
          fromStatus: "Assigned",
          toStatus: "Posted",
          metadata: JSON.stringify({ shiftId: "analytics_shift_2" }),
          timestamp: new Date("2026-06-01T12:00:00.000Z")
        }
      ]
    });

    await prisma.tradeRequest.createMany({
      data: [
        {
          id: "approved_request",
          shiftId: "analytics_shift_1",
          postingOfficerId: "officer1",
          requestingOfficerId: "officer3",
          status: "Approved",
          submittedAt: new Date("2026-05-31T14:00:00.000Z"),
          reviewedAt: new Date("2026-05-31T18:00:00.000Z"),
          reviewedBy: "supervisor1"
        },
        {
          id: "denied_request",
          shiftId: "analytics_shift_2",
          postingOfficerId: "officer2",
          requestingOfficerId: "officer4",
          status: "Denied",
          submittedAt: new Date("2026-06-01T14:00:00.000Z"),
          reviewedAt: new Date("2026-06-01T15:00:00.000Z"),
          reviewedBy: "supervisor1",
          denialReason: "Rest / OT limit"
        }
      ]
    });

    await prisma.validationResult.create({
      data: {
        requestId: "denied_request",
        armedCheck: true,
        roleCheck: true,
        restOtCheck: false,
        overallPass: false,
        details: JSON.stringify({ totalHours: 14, maxHours: 12, hasOverlap: false })
      }
    });

    const response = await request(app)
      .get("/api/analytics?location=Deer%20Valley&view=custom&from=2026-05-25T00:00:00.000Z&to=2026-06-07T23:59:59.000Z")
      .set("x-user-id", "supervisor1");

    expect(response.status).toBe(200);
    expect(response.body.filters.view).toBe("custom");
    expect(response.body.metrics.shiftFillRate).toBe(50);
    expect(response.body.metrics.unfilledShiftCount).toBe(1);
    expect(response.body.locationCoverage[0].armedToUnarmedRatio).toBe("2:0");
    expect(response.body.policyDenials[0].policy).toBe("Rest / OT Policy");
    expect(response.body.denialReasons[0].reason).toBe("Rest / OT limit");
    expect(response.body.pickupConcentration[0].officerId).toBe("officer3");
    expect(response.body.trend.overall).toHaveLength(1);
    expect(response.body.trend.byLocation).toHaveLength(1);
  });
});