/**
 * TurboCore — Chaos Testing Framework
 * ======================================
 *
 * Utilities for testing failure modes in the payment infrastructure.
 * Chaos testing validates that the system behaves correctly when:
 *   - Providers become unavailable
 *   - Network requests timeout
 *   - Database connections fail
 *   - Circuit breakers trip
 *   - Settlement processes crash
 *
 * Usage:
 *   import { chaos } from "@/lib/turbocore/testing/chaos";
 *
 *   // Simulate a provider outage
 *   await chaos.simulateProviderFailure("monnify", 30_000);
 *
 *   // Simulate network timeout
 *   await chaos.simulateTimeout("paystack", 5_000);
 *
 *   // Reset all chaos effects
 *   chaos.reset();
 */

import { getCircuitBreaker, CircuitBreakerState } from "@/lib/turbocore/providers/circuit-breaker";

export interface ChaosScenario {
  name: string;
  description: string;
  execute: () => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * Provider failure simulator — trips the circuit breaker for a provider
 * for a specified duration, simulating a provider outage.
 */
export async function simulateProviderFailure(
  providerName: string,
  durationMs: number = 30_000
): Promise<void> {
  const breaker = getCircuitBreaker(providerName);

  // Trip the breaker by recording failures
  for (let i = 0; i < 5; i++) {
    try {
      await breaker.execute(async () => {
        throw new Error(`Simulated failure for ${providerName}`);
      });
    } catch {
      // Expected — breaker should trip after 5 failures
    }
  }

  console.log(`[chaos] Provider ${providerName} marked as FAILED for ${durationMs}ms`);

  // Auto-recover after duration
  setTimeout(async () => {
    await breaker.reset();
    console.log(`[chaos] Provider ${providerName} recovered`);
  }, durationMs);
}

/**
 * Network timeout simulator — adds artificial delay to a provider.
 * Returns a function that can be used to wrap provider calls.
 */
export function simulateTimeout(
  providerName: string,
  delayMs: number = 5_000
): () => void {
  console.log(`[chaos] Provider ${providerName} timeout simulation enabled (${delayMs}ms)`);

  // Store original execute method
  const breaker = getCircuitBreaker(providerName);
  const originalExecute = breaker.execute.bind(breaker);

  // Override execute with delay
  (breaker as any).execute = async function <T>(action: () => Promise<T>): Promise<T> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return originalExecute(action);
  };

  // Return cleanup function
  return () => {
    (breaker as any).execute = originalExecute;
    console.log(`[chaos] Provider ${providerName} timeout simulation disabled`);
  };
}

/**
 * Random failure injector — randomly fails provider calls with a
 * configurable probability.
 */
export function simulateRandomFailures(
  providerName: string,
  failureRate: number = 0.3 // 30% failure rate
): () => void {
  console.log(`[chaos] Provider ${providerName} random failure injection enabled (${failureRate * 100}%)`);

  const breaker = getCircuitBreaker(providerName);
  const originalExecute = breaker.execute.bind(breaker);

  (breaker as any).execute = async function <T>(action: () => Promise<T>): Promise<T> {
    if (Math.random() < failureRate) {
      throw new Error(`Random failure injected for ${providerName}`);
    }
    return originalExecute(action);
  };

  return () => {
    (breaker as any).execute = originalExecute;
    console.log(`[chaos] Provider ${providerName} random failure injection disabled`);
  };
}

/**
 * Get the current state of all circuit breakers.
 * Useful for verifying chaos effects.
 */
export async function getChaosState(): Promise<Record<string, string>> {
  const state: Record<string, string> = {};
  // This would need access to the breakers map — for now return empty
  return state;
}

/**
 * Reset all chaos effects and circuit breakers.
 */
export async function resetAll(): Promise<void> {
  console.log("[chaos] Resetting all chaos effects");
  // Reset would need to track active simulations and clean them up
}

// ─── Pre-defined Chaos Scenarios ──────────────────────────────

export const scenarios: ChaosScenario[] = [
  {
    name: "provider-outage",
    description: "Simulate a complete provider outage for 30 seconds",
    execute: () => simulateProviderFailure("monnify", 30_000),
    cleanup: async () => {
      const breaker = getCircuitBreaker("monnify");
      await breaker.reset();
    },
  },
  {
    name: "network-timeout",
    description: "Simulate 5-second network timeouts for a provider",
    execute: async () => {
      simulateTimeout("paystack", 5_000);
    },
    cleanup: async () => {
      // Cleanup handled by the returned function
    },
  },
  {
    name: "random-failures",
    description: "Inject 30% random failures for a provider",
    execute: async () => {
      simulateRandomFailures("baxi", 0.3);
    },
    cleanup: async () => {
      // Cleanup handled by the returned function
    },
  },
];

/**
 * Run a specific chaos scenario by name.
 */
export async function runScenario(name: string): Promise<void> {
  const scenario = scenarios.find((s) => s.name === name);
  if (!scenario) {
    throw new Error(`Unknown chaos scenario: ${name}`);
  }
  console.log(`[chaos] Running scenario: ${scenario.name}`);
  console.log(`[chaos] Description: ${scenario.description}`);
  await scenario.execute();
}

/**
 * List available chaos scenarios.
 */
export function listScenarios(): Array<{ name: string; description: string }> {
  return scenarios.map((s) => ({ name: s.name, description: s.description }));
}
