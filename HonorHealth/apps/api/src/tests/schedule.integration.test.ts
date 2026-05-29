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

describe("Schedule management", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("accepts allowed template shifts and custom shifts only", async () => {
    const allowedResponse = await request(app)
      .post("/api/schedule")
      .set("x-user-id", "supervisor1")
      .send({
        officerId: "officer1",
        startAt: "2026-06-01T06:00",
        endAt: "2026-06-01T18:00",
        location: "Deer Valley",
        roleRequired: "Security Officer",
        armedRequired: false,
        sourceType: "0600-1800"
      });

    expect(allowedResponse.status).toBe(201);
    expect(allowedResponse.body.sourceType).toBe("0600-1800");

    const rejectedResponse = await request(app)
      .post("/api/schedule")
      .set("x-user-id", "supervisor1")
      .send({
        officerId: "officer1",
        startAt: "2026-06-02T07:00",
        endAt: "2026-06-02T15:00",
        location: "TMC",
        roleRequired: "Security Officer",
        armedRequired: false,
        sourceType: "0600-1400"
      });

    expect(rejectedResponse.status).toBe(400);
    expect(rejectedResponse.body.code).toBe("INVALID_SHIFT_TEMPLATE");

    const customResponse = await request(app)
      .post("/api/schedule")
      .set("x-user-id", "supervisor1")
      .send({
        officerId: "officer1",
        startAt: "2026-06-03T07:00",
        endAt: "2026-06-03T15:00",
        location: "JCL",
        roleRequired: "Security Officer",
        armedRequired: false,
        sourceType: "Custom"
      });

    expect(customResponse.status).toBe(201);
    expect(customResponse.body.sourceType).toBe("Custom");
  });

  it("returns all scheduled officers for the weekly calendar", async () => {
    await prisma.shift.createMany({
      data: [
        {
          id: "week_shift_1",
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
          id: "week_shift_2",
          currentOfficerId: "officer2",
          startAt: new Date("2026-06-02T18:00:00.000Z"),
          endAt: new Date("2026-06-03T06:00:00.000Z"),
          location: "TMC",
          roleRequired: "Security Officer",
          armedRequired: true,
          status: "Assigned",
          sourceType: "1800-0600"
        }
      ]
    });

    const response = await request(app)
      .get("/api/schedule?from=2026-06-01T00:00:00.000Z&to=2026-06-08T00:00:00.000Z")
      .set("x-user-id", "officer1");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body.map((shift: { currentOfficerId: string }) => shift.currentOfficerId)).toEqual(
      expect.arrayContaining(["officer1", "officer2"])
    );
  });

  it("filters schedule results by status and location", async () => {
    await prisma.shift.createMany({
      data: [
        {
          id: "filter_shift_1",
          currentOfficerId: "officer1",
          startAt: new Date("2026-06-01T06:00:00.000Z"),
          endAt: new Date("2026-06-01T12:00:00.000Z"),
          location: "Deer Valley",
          roleRequired: "Security Officer",
          armedRequired: false,
          status: "Assigned",
          sourceType: "0600-1200"
        },
        {
          id: "filter_shift_2",
          currentOfficerId: "officer2",
          startAt: new Date("2026-06-01T12:00:00.000Z"),
          endAt: new Date("2026-06-01T18:00:00.000Z"),
          location: "TMC",
          roleRequired: "Security Officer",
          armedRequired: false,
          status: "Posted",
          sourceType: "1200-1800"
        }
      ]
    });

    const response = await request(app)
      .get("/api/schedule?location=TMC&status=Posted")
      .set("x-user-id", "supervisor1");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].id).toBe("filter_shift_2");
  });
});