import { PrismaClient } from "@prisma/client";

export interface DispatchOptions {
  batchSize: number;
  maxAttempts: number;
}

export interface DispatchResult {
  fetched: number;
  sent: number;
  failed: number;
  skipped: number;
}

async function sendNotification(notification: { recipientId: string; template: string }): Promise<void> {
  // Placeholder transport for MVP. Replace with email/SMS provider adapter later.
  if (notification.recipientId.startsWith("fail_")) {
    throw new Error("Simulated notification transport failure");
  }
}

function nextAttemptAt(attempts: number): Date {
  const backoffMinutes = Math.min(2 ** attempts, 30);
  return new Date(Date.now() + backoffMinutes * 60 * 1000);
}

export async function dispatchQueuedNotifications(
  prisma: PrismaClient,
  options: DispatchOptions
): Promise<DispatchResult> {
  const now = new Date();

  const candidates = await prisma.notification.findMany({
    where: {
      AND: [
        { OR: [{ deliveryStatus: "Queued" }, { deliveryStatus: "Failed" }] },
        { attempts: { lt: options.maxAttempts } },
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }
      ]
    },
    orderBy: { createdAt: "asc" },
    take: options.batchSize
  });

  const result: DispatchResult = {
    fetched: candidates.length,
    sent: 0,
    failed: 0,
    skipped: 0
  };

  for (const candidate of candidates) {
    const claim = await prisma.notification.updateMany({
      where: {
        id: candidate.id,
        deliveryStatus: { in: ["Queued", "Failed"] }
      },
      data: {
        deliveryStatus: "Processing"
      }
    });

    if (claim.count === 0) {
      result.skipped += 1;
      continue;
    }

    try {
      await sendNotification({
        recipientId: candidate.recipientId,
        template: candidate.template
      });

      await prisma.notification.update({
        where: { id: candidate.id },
        data: {
          deliveryStatus: "Sent",
          sentAt: new Date(),
          lastError: null,
          nextAttemptAt: null
        }
      });

      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown notification failure";

      await prisma.notification.update({
        where: { id: candidate.id },
        data: {
          deliveryStatus: "Failed",
          attempts: { increment: 1 },
          lastError: message,
          nextAttemptAt: nextAttemptAt(candidate.attempts + 1)
        }
      });

      result.failed += 1;
    }
  }

  return result;
}
