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
        id: "shift_1",
        currentOfficerId: "officerA",
        startAt: new Date("2026-05-21T08:00:00.000Z"),
        endAt: new Date("2026-05-21T16:00:00.000Z"),
        location: "Hospital North",
        roleRequired: "Security Officer",
        armedRequired: false,
        status: "Posted"
      },
      {
        id: "shift_2",
        currentOfficerId: "officerA",
        startAt: new Date("2026-05-22T08:00:00.000Z"),
        endAt: new Date("2026-05-22T16:00:00.000Z"),
        location: "Hospital North",
        roleRequired: "Security Officer",
        armedRequired: false,
        status: "Posted"
      },
      {
        id: "shift_3",
        currentOfficerId: "officerB",
        startAt: new Date("2026-05-23T08:00:00.000Z"),
        endAt: new Date("2026-05-23T16:00:00.000Z"),
        location: "Hospital East",
        roleRequired: "Security Officer",
        armedRequired: true,
        status: "Posted"
      }
    ]
  });
}

describe("API pagination and filters", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("paginates and filters trade board posts", async () => {
    const firstPage = await request(app)
      .get("/api/trade-board/posts?location=Hospital%20North&page=1&pageSize=1")
      .set("x-user-id", "supervisor1");

    expect(firstPage.status).toBe(200);
    expect(firstPage.headers["x-total-count"]).toBe("2");
    expect(firstPage.headers["x-page"]).toBe("1");
    expect(firstPage.headers["x-page-size"]).toBe("1");
    expect(firstPage.body).toHaveLength(1);
    expect(firstPage.body[0].id).toBe("shift_1");

    const secondPage = await request(app)
      .get("/api/trade-board/posts?location=Hospital%20North&page=2&pageSize=1")
      .set("x-user-id", "supervisor1");

    expect(secondPage.status).toBe(200);
    expect(secondPage.headers["x-total-count"]).toBe("2");
    expect(secondPage.body).toHaveLength(1);
    expect(secondPage.body[0].id).toBe("shift_2");

    const dateFiltered = await request(app)
      .get("/api/trade-board/posts?date=2026-05-23&page=1&pageSize=20")
      .set("x-user-id", "supervisor1");

    expect(dateFiltered.status).toBe(200);
    expect(dateFiltered.headers["x-total-count"]).toBe("1");
    expect(dateFiltered.body).toHaveLength(1);
    expect(dateFiltered.body[0].id).toBe("shift_3");
  });

  it("paginates and filters trade requests by status", async () => {
    const requestOne = await request(app)
      .post("/api/trade-requests")
      .set("x-user-id", "officerB")
      .send({ shiftId: "shift_1" });

    expect(requestOne.status).toBe(201);

    const requestTwo = await request(app)
      .post("/api/trade-requests")
      .set("x-user-id", "officerB")
      .send({ shiftId: "shift_2" });

    expect(requestTwo.status).toBe(201);

    await request(app)
      .post(`/api/trade-requests/${requestTwo.body.id}/deny`)
      .set("x-user-id", "supervisor1")
      .send({ reason: "Coverage adjustment" })
      .expect(200);

    const pendingResponse = await request(app)
      .get("/api/trade-requests?status=PendingApproval&page=1&pageSize=10")
      .set("x-user-id", "supervisor1");

    expect(pendingResponse.status).toBe(200);
    expect(pendingResponse.headers["x-total-count"]).toBe("1");
    expect(pendingResponse.body).toHaveLength(1);
    expect(pendingResponse.body[0].status).toBe("PendingApproval");

    const allPaged = await request(app)
      .get("/api/trade-requests?page=1&pageSize=1")
      .set("x-user-id", "supervisor1");

    expect(allPaged.status).toBe(200);
    expect(allPaged.headers["x-total-count"]).toBe("2");
    expect(allPaged.body).toHaveLength(1);
  });
});
