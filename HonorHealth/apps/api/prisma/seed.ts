
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const officerCount = 20;
const officers = Array.from({ length: officerCount }, (_, i) => ({
  id: `officer${i + 1}`,
  name: `Officer ${String.fromCharCode(65 + (i % 26))}${i + 1}`,
  role: "Security Officer",
  armed: i % 2 === 0 // Alternate armed/unarmed
}));

const locations = [
  "Hospital North",
  "Hospital East",
  "Hospital South",
  "Hospital West"
];

async function main() {
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.validationResult.deleteMany();
  await prisma.tradeRequest.deleteMany();
  await prisma.shift.deleteMany();

  // Create 20 shifts, one for each officer
  const shifts = officers.map((officer, i) => ({
    id: `shift_${officer.id}_1`,
    currentOfficerId: officer.id,
    startAt: new Date(`2026-05-${21 + (i % 5)}T08:00:00.000Z`),
    endAt: new Date(`2026-05-${21 + (i % 5)}T16:00:00.000Z`),
    location: locations[i % locations.length],
    roleRequired: officer.role,
    armedRequired: officer.armed,
    status: "Assigned"
  }));

  await prisma.shift.createMany({ data: shifts });
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
