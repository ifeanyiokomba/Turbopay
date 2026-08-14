import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { ensureWallet } from "@/lib/turbopay/wallet";
import {
  TX_STATES,
  isValidTransition,
  transitionState,
  markTimeout,
  type TxState,
} from "@/lib/turbopay/tx-state";

/**
 * TRANSACTION STATE MACHINE TESTS
 * ================================
 *
 * The domain model (see tx-state.ts) uses a forward-only lifecycle:
 *   INITIATED → PIN_VERIFIED → AML_CHECKED → HOLD_POSTED → PROVIDER_CALLED
 *                 → SETTLED | REVERSED | TIMEOUT (terminal)
 *
 * Status vs state:
 *   • status  — wallet-facing: PENDING | SUCCESS | FAILED | REVERSED
 *   • state   — internal lifecycle (state column). This suite tests the
 *     state machine only (the status field is covered elsewhere).
 *
 * Valid forward transitions (per the actual adjacency map):
 *   INITIATED → HOLD_POSTED, PROVIDER_CALLED, SETTLED (etc. — see map)
 *   HOLD_POSTED → PROVIDER_CALLED → SETTLED/REVERSED/TIMEOUT
 *
 * Invalid transitions that MUST be rejected:
 *   SETTLED → anything (terminal)
 *   REVERSED → anything (terminal)
 *   TIMEOUT → anything (terminal)
 *   PROVIDER_CALLED → HOLD_POSTED (backward)
 *   SETTLED → REVERSED (terminal reversal is not permitted)
 */

let testUserId: string;
let testWalletId: string;
let testTxId: string;

beforeAll(async () => {
  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  const user = await db.user.create({
    data: {
      fullName: "State Machine Test",
      email: `txstate-${suffix}@turbopay.test`,
      phone: `+234722000${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("testpassword123"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  const { wallet } = await ensureWallet(user.id, "State Machine Test - Turbopay");
  testWalletId = wallet.id;
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  const tx = await db.transaction.create({
    data: {
      reference: `TP-TXS-${Math.floor(Math.random() * 1e9)}`,
      userId: testUserId,
      walletId: testWalletId,
      type: "TRANSFER_OUT",
      direction: "DEBIT",
      amountKobo: 1000,
      status: "PENDING",
      state: "INITIATED",
      provider: "mock",
    },
  });
  testTxId = tx.id;
});

// ─── Pure `isValidTransition` unit tests ───────────────────────

describe("isValidTransition (pure adjacency map)", () => {
  it("allows the canonical forward path INITIATED → PROVIDER_CALLED → SETTLED", () => {
    expect(isValidTransition("INITIATED", "HOLD_POSTED")).toBe(true);
    expect(isValidTransition("HOLD_POSTED", "PROVIDER_CALLED")).toBe(true);
    expect(isValidTransition("PROVIDER_CALLED", "SETTLED")).toBe(true);
  });

  it("allows PROVIDER_CALLED → REVERSED and → TIMEOUT", () => {
    expect(isValidTransition("PROVIDER_CALLED", "REVERSED")).toBe(true);
    expect(isValidTransition("PROVIDER_CALLED", "TIMEOUT")).toBe(true);
  });

  it("rejects backward transitions", () => {
    expect(isValidTransition("PROVIDER_CALLED", "HOLD_POSTED")).toBe(false);
    expect(isValidTransition("HOLD_POSTED", "INITIATED")).toBe(false);
    expect(isValidTransition("SETTLED", "PROVIDER_CALLED")).toBe(false);
  });

  it("rejects every transition out of a terminal state (SETTLED/REVERSED/TIMEOUT)", () => {
    for (const terminal of ["SETTLED", "REVERSED", "TIMEOUT"] as TxState[]) {
      for (const to of TX_STATES) {
        expect(isValidTransition(terminal, to)).toBe(false);
      }
    }
  });

  it("rejects the semantically-wrong SUCCESS-style flips that would indicate a false completion", () => {
    // A settled/terminal transaction can never go back to a processing state —
    // this is the guard that prevents a webhook race from resurrecting a
    // completed transfer.
    expect(isValidTransition("SETTLED", "PROVIDER_CALLED")).toBe(false);
    expect(isValidTransition("SETTLED", "HOLD_POSTED")).toBe(false);
    expect(isValidTransition("REVERSED", "SETTLED")).toBe(false);
  });

  it("handles a null state (legacy row) as forward to any non-terminal step only", () => {
    expect(isValidTransition(null, "INITIATED")).toBe(true);
    expect(isValidTransition(null, "PROVIDER_CALLED")).toBe(true);
    // The adjacency map only lets null rows reach non-terminal states — a
    // legacy row must pass through the chain before settling/reversing.
    expect(isValidTransition(null, "SETTLED")).toBe(false);
    expect(isValidTransition(null, "REVERSED")).toBe(false);
    expect(isValidTransition(null, "TIMEOUT")).toBe(false);
  });
});

// ─── DB-backed `transitionState` + `markTimeout` tests ────────

describe("transitionState (DB)", () => {
  it("persists a valid forward transition", async () => {
    await transitionState(testTxId, "HOLD_POSTED");
    const row = await db.transaction.findUnique({ where: { id: testTxId } });
    expect(row!.state).toBe("HOLD_POSTED");
  });

  it("chains HOLD_POSTED → PROVIDER_CALLED → SETTLED", async () => {
    await transitionState(testTxId, "HOLD_POSTED");
    await transitionState(testTxId, "PROVIDER_CALLED");
    await transitionState(testTxId, "SETTLED");
    const row = await db.transaction.findUnique({ where: { id: testTxId } });
    expect(row!.state).toBe("SETTLED");
  });

  it("is a no-op when the transition is invalid (terminal → anything)", async () => {
    await transitionState(testTxId, "SETTLED");
    // Now try to move out of the terminal state — must NOT change.
    await transitionState(testTxId, "PROVIDER_CALLED");
    const row = await db.transaction.findUnique({ where: { id: testTxId } });
    expect(row!.state).toBe("SETTLED");
  });

  it("never throws — invalid target is swallowed", async () => {
    await expect(transitionState(testTxId, "NOT_A_STATE" as TxState)).resolves.toBeUndefined();
    // Row is untouched.
    const row = await db.transaction.findUnique({ where: { id: testTxId } });
    expect(row!.state).toBe("INITIATED");
  });

  it("PROVIDER_CALLED → REVERSED is valid (hold auto-reversed after failure)", async () => {
    await transitionState(testTxId, "PROVIDER_CALLED");
    await transitionState(testTxId, "REVERSED");
    const row = await db.transaction.findUnique({ where: { id: testTxId } });
    expect(row!.state).toBe("REVERSED");
  });
});

describe("markTimeout (DB)", () => {
  it("force-flips a stuck PENDING row to TIMEOUT/FAILED", async () => {
    const flipped = await markTimeout(testTxId);
    expect(flipped).toBe(true);
    const row = await db.transaction.findUnique({ where: { id: testTxId } });
    expect(row!.state).toBe("TIMEOUT");
    expect(row!.status).toBe("FAILED");
  });

  it("returns false (no-op) for an already-terminal row", async () => {
    await transitionState(testTxId, "SETTLED");
    const flipped = await markTimeout(testTxId);
    expect(flipped).toBe(false);
    const row = await db.transaction.findUnique({ where: { id: testTxId } });
    expect(row!.state).toBe("SETTLED");
    expect(row!.status).toBe("PENDING");
  });
});
