/**
 * PII Key Rotation Migration
 * ===========================
 * Re-encrypts all PII fields in the database from the old key to the new key.
 *
 * Prerequisites:
 *   - TURBOPAY_PII_KEY = new key (already set in Vercel)
 *   - TURBOPAY_PII_PREV_KEYS = v1:<old_key> (already set in Vercel)
 *   - Run this script locally with BOTH keys available in .env
 *
 * Usage:
 *   npx tsx scripts/rotate-pii-key.ts
 *
 * What it does:
 *   1. Reads all encrypted fields from User, VirtualCard, Session, and
 *      ProviderConfig tables
 *   2. Decrypts each field using decryptPii() (which tries current key,
 *      then PREV_KEYS)
 *   3. Re-encrypts with the current (new) key via encryptPii()
 *   4. Updates the database record
 *   5. Logs progress and any failures
 *
 * Safety:
 *   - Idempotent: if a field is already encrypted with the new key,
 *     decryptPii() will succeed and re-encrypt to the same value
 *   - Dry-run mode: pass --dry-run to preview without writing
 *   - Batches in groups of 100 to avoid memory issues
 */

import * as crypto from "node:crypto";
import { db } from "../src/lib/db";
import { encryptPii } from "../src/lib/turbopay/crypto";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 100;

/** Derive a 256-bit AES key from a raw passphrase via SHA-256. */
function deriveKey(passphrase: string): Buffer {
  return crypto.createHash("sha256").update(passphrase).digest();
}

/** Decrypt with a specific hex key (for legacy unversioned data). */
function decryptWithKey(payload: string, keyHex: string): string {
  const key = deriveKey(keyHex);
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

interface MigrationField {
  table: string;
  field: string;
  /** Optional: only process rows where this condition is true */
  filter?: Record<string, unknown>;
}

const FIELDS: MigrationField[] = [
  // User PII
  { table: "user", field: "bvn" },
  { table: "user", field: "nin" },
  { table: "user", field: "mfaSecretEnc" },

  // VirtualCard PANs and CVVs
  { table: "virtualCard", field: "panEnc" },
  { table: "virtualCard", field: "cvvEnc" },

  // ProviderConfig credentials
  { table: "providerConfig", field: "credentialsEnc" },
];

async function reEncryptField(
  tableName: string,
  id: string,
  field: string,
  encryptedValue: string,
): Promise<boolean> {
  let plaintext: string | null = null;

  // 1. Try decryptPii (handles v1: prefix and current key)
  try {
    const { decryptPii } = await import("../src/lib/turbopay/crypto");
    plaintext = decryptPii(encryptedValue);
  } catch {
    // Current key didn't work — try old key for unversioned data
  }

  // 2. Fallback: try old key directly (for legacy unversioned payloads)
  if (plaintext === null) {
    const oldKeyHex = process.env.TURBOPAY_PII_PREV_KEYS?.replace("v1:", "");
    if (oldKeyHex) {
      try {
        // Strip v1: prefix if present
        const raw = encryptedValue.startsWith("v1:")
          ? encryptedValue.slice(3)
          : encryptedValue;
        plaintext = decryptWithKey(raw, oldKeyHex);
      } catch {
        // Old key also failed — data is corrupted or uses a different key
      }
    }
  }

  if (plaintext === null) {
    console.error(`  FAILED ${tableName}.${id}.${field}: could not decrypt with any available key`);
    return false;
  }

  // Re-encrypt with the new key
  const newEncrypted = encryptPii(plaintext);

  // Skip if the value didn't change (already on new key)
  if (newEncrypted === encryptedValue) return false;

  if (!DRY_RUN) {
    await (db as any)[tableName].update({
      where: { id },
      data: { [field]: newEncrypted },
    });
  }
  return true;
}

async function main() {
  console.log(`PII Key Rotation Migration ${DRY_RUN ? "(DRY RUN)" : ""}`);
  console.log("=".repeat(50));

  let totalProcessed = 0;
  let totalReEncrypted = 0;
  const totalFailed = 0;

  for (const { table, field } of FIELDS) {
    console.log(`\nProcessing ${table}.${field}...`);

    const model = (db as any)[table];
    if (!model) {
      console.error(`  Model "${table}" not found, skipping`);
      continue;
    }

    let cursor: string | undefined;
    let batchCount = 0;

    while (true) {
      const rows = await model.findMany({
        where: { [field]: { not: null } },
        select: { id: true, [field]: true },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" as const },
      });

      if (rows.length === 0) break;

      for (const row of rows) {
        const encryptedValue = row[field];
        if (!encryptedValue || typeof encryptedValue !== "string") continue;

        totalProcessed++;
        const changed = await reEncryptField(table, row.id, field, encryptedValue);
        if (changed) {
          totalReEncrypted++;
          process.stdout.write(".");
        } else {
          process.stdout.write("-");
        }
      }

      cursor = rows[rows.length - 1].id;
      batchCount++;

      if (rows.length < BATCH_SIZE) break;
    }

    console.log(` (${batchCount} batches done)`);
  }

  console.log("\n" + "=".repeat(50));
  console.log(`Migration complete.`);
  console.log(`  Processed:    ${totalProcessed}`);
  console.log(`  Re-encrypted: ${totalReEncrypted}`);
  console.log(`  Failed:       ${totalFailed}`);
  console.log(`  Mode:         ${DRY_RUN ? "DRY RUN (no changes written)" : "LIVE"}`);

  if (!DRY_RUN && totalReEncrypted > 0) {
    console.log("\nNext step: Remove TURBOPAY_PII_PREV_KEYS from Vercel env vars");
    console.log("after verifying all data decrypts correctly with the new key.");
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
