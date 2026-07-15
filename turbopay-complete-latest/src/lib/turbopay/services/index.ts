/**
 * Turbopay Service Layer — public re-exports.
 *
 * Routes import service singletons from here:
 *   import { billingService, transferService, walletService,
 *            cardService, kycService } from "@/lib/turbopay/services";
 *
 * The shared debit pipeline + ServiceError are also re-exported for any
 * future service that needs them.
 */

export { billingService } from "./billing.service";
export { transferService } from "./transfer.service";
export { walletService } from "./wallet.service";
export { cardService } from "./card.service";
export { kycService } from "./kyc.service";
export { intentService } from "./intent.service";
export { largeTxShield } from "./large-tx-shield";
export { locationGuard } from "./location-guard";
export { settlementService } from "./settlement.service";
export { debitPipeline } from "./pipeline";
export type { DebitPipelineOptions, DebitPipelineResult } from "./pipeline";
export { ServiceError } from "./types";
