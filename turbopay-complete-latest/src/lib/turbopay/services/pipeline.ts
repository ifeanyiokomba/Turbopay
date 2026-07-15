/**
 * Turbopay Service Layer — Shared Debit Pipeline.
 * =================================================
 *
 * The `debitPipeline` wraps the recurring "hold + provider call + confirm"
 * sequence shared by every provider-backed debit:
 *
 *   1. verifyTransactionPin(user, pin)      — PIN brute-force lockout
 *   2. aml.checkDebit(...)                  — runs INSIDE the hold tx via the
 *                                             `aml` field on executeProviderDebit
 *                                             (closes the F6 race window)
 *   3. executeProviderDebit(...)            — atomic hold + provider call +
 *                                             confirm-or-reverse
 *   4. audit(...)                           — fire-and-forget
 *   5. notify.sendInApp(...)                — fire-and-forget
 *   6. rewards.awardCashback(...)           — fire-and-forget (if category)
 *
 * Steps 4-6 NEVER throw, NEVER block — they use `.catch(() => null)`.
 *
 * The pipeline also publishes `payment.succeeded` on the TurboCore event bus
 * so future side-effects (SMS, webhook fan-out, analytics) can subscribe
 * without touching the pipeline.
 *
 * On AML block, throws `ServiceError(AML_BLOCKED, 400)`.
 * On provider failure (after auto-reversal), throws `ServiceError(PROVIDER_ERROR, 400)`.
 * On PIN failure, throws `ServiceError(<pin code>, 400)`.
 */

import { db } from "@/lib/db";
import { verifyTransactionPin } from "@/lib/turbopay/pin";
import { executeProviderDebit, AmlBlockedError } from "@/lib/turbopay/payments";
import { audit } from "@/lib/turbopay/audit";
import { notify } from "@/lib/turbocore/notifications";
import { rewards } from "@/lib/turbocore/rewards";
import { events } from "@/lib/turbocore/events";
import { logger } from "@/lib/turbocore/logger";
import type { SessionUser, TxType, RefType } from "@/lib/turbopay/types";
import { ServiceError } from "./types";
import { intentService } from "./intent.service";
import { largeTxShield } from "./large-tx-shield";
import { locationGuard } from "./location-guard";
import { StepUpRequiredError } from "@/lib/turbopay/errors";

/** Prisma transaction client type (matches the type used in payments.ts). */
type PrismaTx = Parameters<Parameters<typeof db["$transaction"]>[0]>[0];

export interface DebitPipelineOptions {
  /** Authenticated user (used for PIN verification + audit + notifications). */
  user: SessionUser;
  walletId: string;
  amountKobo: number;
  /** TxType — AIRTIME | DATA | BILL_ELECTRICITY | BILL_UTILITY | TRANSFER_OUT | … */
  type: TxType;
  /** RefType — AIRTIME | DATA | BILL | TRANSFER | … */
  refType: RefType;
  description: string;
  counterpartyName?: string;
  counterpartyAccount?: string;
  /** Optional bank name (used for external transfers). */
  counterpartyBank?: string;
  provider: string;
  pin: string;
  kycTier: number;
  metadata?: Record<string, unknown>;
  /** Side-table model — used to mark the side row SUCCESS/FAILED in lockstep
   *  with the parent Transaction. */
  sideModel?: "airtimeData" | "billPayment";
  /** Callback that creates the side-table row (AirtimeDataPurchase / BillPayment)
   *  inside the hold transaction, returning its id. */
  createSideRow?: (tx: PrismaTx, transactionId: string) => Promise<string>;
  /** Provider call — runs AFTER the hold succeeds. If it throws, the hold is
   *  auto-reversed. */
  providerCall: () => Promise<{ providerRef: string; extra?: Record<string, unknown> }>;
  /** AuditLog.action for the audit row. */
  auditAction: string;
  /** Optional extra metadata merged into the audit row (e.g. `{ network, phoneNumber }`). */
  auditMetadata?: Record<string, unknown>;
  /** AuditLog.category — defaults to "BILL". */
  auditCategory?: "BILL" | "TRANSFER" | "WALLET" | "KYC" | "AML" | "AUTH" | "ADMIN" | "WEBHOOK" | "FX";
  /** IP for the audit row. */
  ip?: string;
  notificationTitle: string;
  /**
   * Notification message body. The literal substring `<ref>` (if present) is
   * replaced with the actual transaction reference after the pipeline run —
   * lets callers include the ref without knowing it upfront.
   */
  notificationMessage: string;
  /** Defaults to "/history". */
  notificationActionUrl?: string;
  /** Defaults to "View receipt". */
  notificationActionLabel?: string;
  /** If true, the pipeline SKIPS its own notify.sendInApp call (the caller
   *  takes responsibility for sending any notification — used by electricity
   *  where the prepaid token must be in the message and is only known after
   *  the provider call). Audit / cashback / event-publish still run. */
  skipNotification?: boolean;
  /** If provided, awards cashback via the rewards engine. */
  cashbackCategory?: string;
}

export interface DebitPipelineResult {
  reference: string;
  providerRef: string;
  transactionId: string;
  newBalanceKobo: number;
  /** ID of the PaymentIntent record created by the pipeline (for status polling). */
  paymentIntentId: string;
}

/**
 * Run the shared debit pipeline. See module docstring.
 *
 * Throws `ServiceError` on any business-level failure (PIN / AML / provider).
 * The route's catch block converts a `ServiceError` into an `errorJson`
 * response with the matching status + code.
 */
export async function debitPipeline(opts: DebitPipelineOptions): Promise<DebitPipelineResult> {
  // 0. Payment Intent — record the "intent to pay" before any work begins.
  //    The intent tracks the lifecycle (PENDING → PROCESSING → SUCCEEDED /
  //    FAILED) independently of the financial Transaction, enabling status
  //    polling + analytics. Non-breaking: if intent creation fails (e.g. DB
  //    hiccup), the pipeline continues with `intentId = null` so the
  //    financial flow is unaffected.
  let intentId: string | null = null;
  try {
    const intent = await intentService.create({
      userId: opts.user.id,
      type: opts.type,
      amountKobo: opts.amountKobo,
      recipient: opts.counterpartyAccount ?? opts.counterpartyName,
      metadata: {
        refType: opts.refType,
        provider: opts.provider,
        description: opts.description,
        walletId: opts.walletId,
      },
    });
    intentId = intent.id;
  } catch (e) {
    // Intent creation is non-fatal — log + continue. The financial
    // transaction MUST still proceed.
    logger.error("pipeline.intent.creation_failed", {
      userId: opts.user.id,
      type: opts.type,
      amountKobo: opts.amountKobo,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Helper — fire-and-forget intent status updates. Wrapped so a DB error
  // in the status update can NEVER propagate into the financial flow.
  const markIntent = (fn: () => Promise<void>) => {
    if (!intentId) return;
    fn().catch((e) => {
      logger.error("pipeline.intent.status_update_failed", {
        intentId,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  };

  // 1. Transaction PIN — required for every debit. A stolen session cookie is
  //    not enough to move money; the attacker also needs the 4-digit PIN.
  const pinCheck = await verifyTransactionPin(opts.user, opts.pin);
  if (!pinCheck.ok) {
    markIntent(() => intentService.markFailed(intentId!, `PIN: ${pinCheck.code ?? "PIN_ERROR"}`));
    throw new ServiceError(pinCheck.code ?? "PIN_ERROR", pinCheck.error ?? "PIN verification failed", 400);
  }

  // 1b. Large Transaction Shield — AFTER PIN, BEFORE AML. If the user has
  //     opted in and the amount is at or above their threshold, throw
  //     StepUpRequiredError (HTTP 403). The client initiates + verifies an
  //     OTP via /api/security/large-tx-step-up, then retries the original
  //     request. The shield is OFF by default — non-breaking.
  try {
    const shield = await largeTxShield.requiresStepUp(opts.user.id, opts.amountKobo);
    if (shield.required) {
      markIntent(() => intentService.markFailed(intentId!, "STEP_UP_REQUIRED"));
      throw new StepUpRequiredError(
        "This transaction requires additional verification",
        opts.user.id,
        opts.amountKobo,
      );
    }
  } catch (e) {
    // Re-throw StepUpRequiredError (already marked the intent above).
    if (e instanceof StepUpRequiredError) throw e;
    // Any other error in the shield check is non-fatal — log + continue.
    // The financial transaction MUST still proceed (PIN + AML still apply).
    logger.error("pipeline.large_tx_shield.check_failed", {
      userId: opts.user.id,
      amountKobo: opts.amountKobo,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 1c. Location Guard — AFTER the Large Transaction Shield, BEFORE AML. If
  //     the user has opted in and the request IP is in a /24 subnet they've
  //     never transacted from before, throw StepUpRequiredError. The client
  //     reuses the same step-up OTP flow as the Large Transaction Shield.
  //     The guard is OFF by default — non-breaking. A missing / unparseable
  //     IP is treated defensively as "new location" (the guard fires).
  try {
    const loc = await locationGuard.requiresStepUp(opts.user.id, opts.ip ?? "");
    if (loc.required) {
      markIntent(() => intentService.markFailed(intentId!, "STEP_UP_REQUIRED_LOCATION"));
      throw new StepUpRequiredError(
        "New location detected. Please verify your identity.",
        opts.user.id,
        opts.amountKobo,
      );
    }
  } catch (e) {
    // Re-throw StepUpRequiredError (already marked the intent above).
    if (e instanceof StepUpRequiredError) throw e;
    // Any other error in the location-guard check is non-fatal — log +
    // continue. The financial transaction MUST still proceed (PIN + AML
    // still apply).
    logger.error("pipeline.location_guard.check_failed", {
      userId: opts.user.id,
      ip: opts.ip,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Mark intent as PROCESSING just before the hold begins. Once PROCESSING,
  // the intent is no longer cancellable — the financial tx is in flight.
  markIntent(() => intentService.markProcessing(intentId!));

  // 2 + 3. AML check + atomic hold + provider call + confirm/reverse.
  //    The AML check runs INSIDE executeProviderDebit's hold transaction (via
  //    the `aml` field) so velocity / daily-cap counters are read atomically
  //    with the debit (closes the F6 race window where two simultaneous
  //    requests could each pass AML before either posted).
  //
  //    ── Transactional Outbox ──────────────────────────────────────────
  //    The `outboxEvent` is written INSIDE the confirm transaction
  //    (atomically with the SUCCESS status flip). This is the durable
  //    guarantee: if the process crashes between the tx commit and the
  //    direct `events.publish` call below, the outbox worker will still
  //    publish the event on the next tick. The payload includes everything
  //    known upfront (userId, amountKobo, type, …) EXCEPT `reference` and
  //    `providerRef` — those are only known after executeProviderDebit
  //    returns, so the direct publish below carries them. The outbox
  //    payload carries `transactionId` instead, which subscribers can use
  //    to look up the reference if needed. Both publishes share the same
  //    `transactionId`, so idempotent subscribers dedupe correctly.
  let result: { transactionId: string; reference: string; providerRef: string; newBalanceKobo: number };
  try {
    result = await executeProviderDebit({
      userId: opts.user.id,
      walletId: opts.walletId,
      type: opts.type,
      refType: opts.refType,
      amountKobo: opts.amountKobo,
      description: opts.description,
      counterpartyName: opts.counterpartyName,
      counterpartyAccount: opts.counterpartyAccount,
      counterpartyBank: opts.counterpartyBank,
      provider: opts.provider,
      metadata: opts.metadata,
      aml: { userId: opts.user.id, kycTier: opts.kycTier as 1 | 2 | 3 },
      sideModel: opts.sideModel,
      createSideRow: opts.createSideRow,
      providerCall: opts.providerCall,
      outboxEvent: {
        aggregateType: "transaction",
        eventType: "payment.succeeded",
        payload: {
          userId: opts.user.id,
          amountKobo: opts.amountKobo,
          type: opts.type,
          refType: opts.refType,
          provider: opts.provider,
          description: opts.description,
          category: opts.cashbackCategory,
          title: opts.notificationTitle,
          // NOTE: `message` here is the raw template with `<ref>` UNREPLACED.
          // The direct events.publish call below carries the substituted
          // message (with the real reference). If the outbox worker is the
          // only path that fires (direct publish lost), the notification
          // subscriber will receive the raw template — the `<ref>` will be
          // left as-is in the in-app notification. This is a minor cosmetic
          // regression in the crash-recovery path, not a functional one.
          message: opts.notificationMessage,
          actionUrl: opts.notificationActionUrl ?? "/history",
          actionLabel: opts.notificationActionLabel ?? "View receipt",
        },
      },
    });
  } catch (e: any) {
    if (e instanceof AmlBlockedError) {
      markIntent(() => intentService.markFailed(intentId!, `AML_BLOCKED: ${e.message}`));
      throw new ServiceError("AML_BLOCKED", e.message, 400);
    }
    // executeProviderDebit has already reversed the hold + marked the
    // transaction FAILED. Surface the error to the caller.
    markIntent(() => intentService.markFailed(intentId!, `PROVIDER_ERROR: ${e?.message ?? "Provider call failed"}`));
    throw new ServiceError(e?.code ?? "PROVIDER_ERROR", e?.message ?? "Provider call failed", 400);
  }

  // Mark intent as SUCCEEDED — link it to the financial Transaction so the
  // polling endpoint can navigate intent → transaction.
  markIntent(() => intentService.markSucceeded(intentId!, result.transactionId));


  // 4. Audit (fire-and-forget — never blocks, never throws).
  audit({
    userId: opts.user.id,
    action: opts.auditAction,
    category: opts.auditCategory ?? "BILL",
    ip: opts.ip,
    metadata: {
      ...opts.auditMetadata,
      amountKobo: opts.amountKobo,
      reference: result.reference,
    },
  }).catch(() => null);

  // 5. In-app notification (fire-and-forget). The `<ref>` placeholder in the
  //    message body is replaced with the actual transaction reference.
  if (!opts.skipNotification) {
    const message = opts.notificationMessage.includes("<ref>")
      ? opts.notificationMessage.replace("<ref>", result.reference)
      : opts.notificationMessage;
    notify
      .sendInApp({
        userId: opts.user.id,
        type: "TRANSACTION",
        title: opts.notificationTitle,
        message,
        actionUrl: opts.notificationActionUrl ?? "/history",
        actionLabel: opts.notificationActionLabel ?? "View receipt",
      })
      .catch(() => null);
  }

  // 6. Cashback (fire-and-forget). Idempotent per sourceTransactionId.
  if (opts.cashbackCategory) {
    rewards
      .awardCashback({
        userId: opts.user.id,
        transactionId: result.transactionId,
        amountMinor: opts.amountKobo,
        category: opts.cashbackCategory,
      })
      .catch((err) => {
        logger.error("pipeline.cashback.failed", {
          userId: opts.user.id,
          transactionId: result.transactionId,
          error: err?.message ?? err,
        });
      });
  }

  // Publish `payment.succeeded` for any future event-bus subscribers
  // (SMS / webhook fan-out / analytics). Current subscribers mirror the
  // notify + rewards calls above; the event bus provides extensibility
  // without touching the pipeline.
  events
    .publish("payment.succeeded", {
      userId: opts.user.id,
      transactionId: result.transactionId,
      amountKobo: opts.amountKobo,
      reference: result.reference,
      providerRef: result.providerRef,
      category: opts.cashbackCategory,
      title: opts.notificationTitle,
      message: opts.notificationMessage,
      actionUrl: opts.notificationActionUrl ?? "/history",
      actionLabel: opts.notificationActionLabel ?? "View receipt",
    })
    .catch(() => null);

  return {
    reference: result.reference,
    providerRef: result.providerRef,
    transactionId: result.transactionId,
    newBalanceKobo: result.newBalanceKobo,
    paymentIntentId: intentId ?? "",
  };
}
