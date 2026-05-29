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

describe("My shifts visibility", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns only current and future shifts for the officer", async () => {
    const now = Date.now();

    await prisma.shift.createMany({
      data: [
        {
          id: "past_shift",
          currentOfficerId: "officerA",
          startAt: new Date(now - 3 * 60 * 60 * 1000),
          endAt: new Date(now - 2 * 60 * 60 * 1000),
          location: "Deer Valley",
          roleRequired: "Security Officer",
          armedRequired: false,
          status: "Assigned"
        },
        {
          id: "future_shift",
          currentOfficerId: "officerA",
          startAt: new Date(now + 2 * 60 * 60 * 1000),
          endAt: new Date(now + 3 * 60 * 60 * 1000),
          location: "TMC",
          roleRequired: "Security Officer",
          armedRequired: false,
          status: "Assigned"
        }
      ]
    });

    const response = await request(app).get("/api/my-shifts").set("x-user-id", "officerA");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].id).toBe("future_shift");
    expect(response.body[0].canPost).toBe(true);
  });
});
