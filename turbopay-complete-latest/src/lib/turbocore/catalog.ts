/**
 * TurboCore — Static Product Catalog
 * ===================================
 *
 * Static reference data for bills, electricity discos, and data plans.
 *
 * This is intentionally separated from `@/lib/turbopay/providers` (which holds
 * the legacy simulated provider functions) so that API routes can depend on the
 * catalog without importing the old simulation functions. The simulation
 * functions have been migrated to the TurboCore provider registry
 * (`@/lib/turbocore/providers/registry`); routes must call through the registry
 * for any provider network call.
 *
 * The data itself is pure reference data (no network, no routing engine) and is
 * re-exported here as the single canonical import surface for routes.
 */

export type { DataPlan, Disco, BillProduct } from "@/lib/turbopay/providers";
export { DATA_PLANS, getDataPlans, DISCOS, BILL_PRODUCTS } from "@/lib/turbopay/providers";
