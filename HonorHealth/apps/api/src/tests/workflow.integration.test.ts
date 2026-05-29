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

  await prisma.shift.createMany({
    data: [
      {
        id: "shift_a_1",
        currentOfficerId: "officerA",
        startAt: new Date("2026-05-21T08:00:00.000Z"),
        endAt: new Date("2026-05-21T16:00:00.000Z"),
        location: "Deer Valley",
        roleRequired: "Security Officer",
        armedRequired: false,
        status: "Assigned"
      },
      {
        id: "shift_b_1",
        currentOfficerId: "officerB",
        startAt: new Date("2026-05-22T16:00:00.000Z"),
        endAt: new Date("2026-05-23T00:00:00.000Z"),
        location: "TMC",
        roleRequired: "Security Officer",
        armedRequired: true,
        status: "Assigned"
      }
    ]
  });
}

describe("Security Shift Trade Board workflow", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("supports post -> request -> approve and reassigns shift", async () => {
    const postResponse = await request(app)
      .post("/api/trade-board/posts")
      .set("x-user-id", "officerA")
      .send({ shiftId: "shift_a_1" });

    expect(postResponse.status).toBe(201);
    expect(postResponse.body.status).toBe("Posted");

    const createRequestResponse = await request(app)
      .post("/api/trade-requests")
      .set("x-user-id", "officerB")
      .send({ shiftId: "shift_a_1" });

    expect(createRequestResponse.status).toBe(201);
    expect(createRequestResponse.body.status).toBe("PendingApproval");

    const pendingQueueResponse = await request(app)
      .get("/api/trade-requests?status=PendingApproval")
      .set("x-user-id", "supervisor1");

    expect(pendingQueueResponse.status).toBe(200);
    expect(pendingQueueResponse.body).toHaveLength(1);

    const approveResponse = await request(app)
      .post(`/api/trade-requests/${createRequestResponse.body.id}/approve`)
      .set("x-user-id", "supervisor1")
      .send({});

    expect(approveResponse.status).toBe(200);
    expect(approveResponse.body.status).toBe("Approved");

    const updatedShift = await prisma.shift.findUnique({ where: { id: "shift_a_1" } });
    expect(updatedShift?.currentOfficerId).toBe("officerB");
    expect(updatedShift?.status).toBe("Assigned");

    const validations = await prisma.validationResult.findMany({
      where: { requestId: createRequestResponse.body.id },
      orderBy: { evaluatedAt: "asc" }
    });
    expect(validations.length).toBe(2);
    expect(validations.every((item) => item.overallPass)).toBe(true);

    const approvedNotifications = await prisma.notification.findMany({
      where: { template: "RequestApproved" }
    });
    expect(approvedNotifications).toHaveLength(2);
  });

  it("blocks approval when validation fails and supports deny", async () => {
    await request(app)
      .post("/api/trade-board/posts")
      .set("x-user-id", "officerB")
      .send({ shiftId: "shift_b_1" })
      .expect(201);

    const createRequestResponse = await request(app)
      .post("/api/trade-requests")
      .set("x-user-id", "officerA")
      .send({ shiftId: "shift_b_1" });

    expect(createRequestResponse.status).toBe(201);

    const firstValidation = await prisma.validationResult.findFirst({
      where: { requestId: createRequestResponse.body.id },
      orderBy: { evaluatedAt: "desc" }
    });
    expect(firstValidation?.overallPass).toBe(false);
    expect(firstValidation?.armedCheck).toBe(false);

    const approveResponse = await request(app)
      .post(`/api/trade-requests/${createRequestResponse.body.id}/approve`)
      .set("x-user-id", "supervisor1")
      .send({});

    expect(approveResponse.status).toBe(409);
    expect(approveResponse.body.code).toBe("APPROVAL_BLOCKED");
    expect(approveResponse.body.validation.requestId).toBe(createRequestResponse.body.id);
    expect(approveResponse.body.validation.canApprove).toBe(false);
    expect(approveResponse.body.validation.reasons.length).toBeGreaterThan(0);

    const denyResponse = await request(app)
      .post(`/api/trade-requests/${createRequestResponse.body.id}/deny`)
      .set("x-user-id", "supervisor1")
      .send({ reason: "Armed qualification mismatch" });

    expect(denyResponse.status).toBe(200);
    expect(denyResponse.body.status).toBe("Denied");

    const shiftAfterDeny = await prisma.shift.findUnique({ where: { id: "shift_b_1" } });
    expect(shiftAfterDeny?.currentOfficerId).toBe("officerB");
    expect(shiftAfterDeny?.status).toBe("Posted");
  });

  it("enforces only one active pending request per shift", async () => {
    await request(app)
      .post("/api/trade-board/posts")
      .set("x-user-id", "officerA")
      .send({ shiftId: "shift_a_1" })
      .expect(201);

    await request(app)
      .post("/api/trade-requests")
      .set("x-user-id", "officerB")
      .send({ shiftId: "shift_a_1" })
      .expect(201);

    const duplicateResponse = await request(app)
      .post("/api/trade-requests")
      .set("x-user-id", "officerB")
      .send({ shiftId: "shift_a_1" });

    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body.code).toBe("REQUEST_CONFLICT");
  });
});
