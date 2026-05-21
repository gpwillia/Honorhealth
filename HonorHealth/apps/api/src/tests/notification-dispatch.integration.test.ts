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

  await prisma.shift.create({
    data: {
      id: "shift_notify_1",
      currentOfficerId: "officerA",
      startAt: new Date("2026-05-21T08:00:00.000Z"),
      endAt: new Date("2026-05-21T16:00:00.000Z"),
      location: "Deer Valley",
      roleRequired: "Security Officer",
      armedRequired: false,
      status: "Posted"
    }
  });
}

describe("Notification outbox dispatch", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("dispatches queued notifications to sent", async () => {
    const tradeRequestResponse = await request(app)
      .post("/api/trade-requests")
      .set("x-user-id", "officerB")
      .send({ shiftId: "shift_notify_1" });

    expect(tradeRequestResponse.status).toBe(201);

    await request(app)
      .post(`/api/trade-requests/${tradeRequestResponse.body.id}/approve`)
      .set("x-user-id", "supervisor1")
      .send({})
      .expect(200);

    const beforeDispatch = await prisma.notification.findMany({
      where: { template: "RequestApproved" }
    });
    expect(beforeDispatch).toHaveLength(2);
    expect(beforeDispatch.every((n) => n.deliveryStatus === "Queued")).toBe(true);

    const dispatchResponse = await request(app)
      .post("/api/notifications/dispatch")
      .set("x-user-id", "supervisor1")
      .send({});

    expect(dispatchResponse.status).toBe(200);
    expect(dispatchResponse.body.sent).toBe(2);

    const afterDispatch = await prisma.notification.findMany({
      where: { template: "RequestApproved" }
    });

    expect(afterDispatch.every((n) => n.deliveryStatus === "Sent")).toBe(true);
    expect(afterDispatch.every((n) => n.sentAt !== null)).toBe(true);
  });

  it("retries failed notifications with attempt tracking", async () => {
    const queued = await prisma.notification.create({
      data: {
        recipientId: "fail_officer",
        channel: "IN_APP",
        template: "RequestDenied",
        deliveryStatus: "Queued"
      }
    });

    const dispatchResponse = await request(app)
      .post("/api/notifications/dispatch")
      .set("x-user-id", "supervisor1")
      .send({});

    expect(dispatchResponse.status).toBe(200);
    expect(dispatchResponse.body.failed).toBe(1);

    const failed = await prisma.notification.findUnique({ where: { id: queued.id } });
    expect(failed?.deliveryStatus).toBe("Failed");
    expect(failed?.attempts).toBe(1);
    expect(failed?.lastError).toBeTruthy();
    expect(failed?.nextAttemptAt).toBeTruthy();
  });
});
