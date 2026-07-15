import { db } from "@/lib/db";

/**
 * IDEMPOTENCY — prevents duplicate financial operations.
 * If a client retries a request with the same Idempotency-Key, we return
 * the cached response instead of re-executing the operation.
 */

export async function getIdempotentResponse<T>(
  key: string
): Promise<{ hit: true; status: number; body: T } | { hit: false }> {
  const rec = await db.idempotencyRecord.findUnique({ where: { key } });
  if (rec && rec.completedAt && rec.responseBody) {
    return {
      hit: true,
      status: rec.status ?? 200,
      body: JSON.parse(rec.responseBody) as T,
    };
  }
  return { hit: false };
}

export async function startIdempotency(
  key: string,
  endpoint: string,
  userId?: string,
  requestBodyHash?: string
): Promise<{ started: boolean }> {
  try {
    await db.idempotencyRecord.create({
      data: {
        key,
        endpoint,
        userId,
        requestBody: requestBodyHash,
      },
    });
    return { started: true };
  } catch {
    // unique constraint => already in progress or completed
    return { started: false };
  }
}

export async function completeIdempotency(
  key: string,
  status: number,
  body: unknown
): Promise<void> {
  await db.idempotencyRecord.update({
    where: { key },
    data: {
      status,
      responseBody: JSON.stringify(body),
      completedAt: new Date(),
    },
  });
}
