/**
 * Provider Capabilities — Registry Initialization
 * =================================================
 *
 * Registers all provider capabilities at application startup.
 * The capability engine and routing engine query this registry
 * to discover what each provider can do.
 */

import { capabilityRegistry } from "../capabilities";
import { paystackCapabilities } from "./paystack";
import { flutterwaveCapabilities } from "./flutterwave";
import { monnifyCapabilities } from "./monnify";
import { onafriqCapabilities } from "./onafriq";
import { remitaCapabilities } from "./remita";
import { quicktellerCapabilities } from "./quickteller";

/**
 * Initialize the capability registry with all known providers.
 * Called once at application startup.
 */
export function initializeCapabilities(): void {
  capabilityRegistry.register(paystackCapabilities);
  capabilityRegistry.register(flutterwaveCapabilities);
  capabilityRegistry.register(monnifyCapabilities);
  capabilityRegistry.register(onafriqCapabilities);
  capabilityRegistry.register(remitaCapabilities);
  capabilityRegistry.register(quicktellerCapabilities);
}

// Auto-initialize on import
initializeCapabilities();
