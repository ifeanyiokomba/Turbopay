/**
 * TurboCore — Circuit Breaker
 * ============================
 *
 * A per-provider circuit breaker with DISTRIBUTED STATE.
 *
 * Circuit breaker state is stored in Redis (via the cache module) so that
 * in a multi-instance deployment, ALL instances share the same failure
 * counts and breaker states. Without this, 3 instances = 3x the failure
 * budget before any single instance's breaker opens.
 *
 * When Redis is unavailable, falls back to in-memory state (single-instance
 * mode). The fallback is transparent — callers use the same API.
 *
 * States:
 *   CLOSED    → requests flow through. On `failureThreshold` consecutive
 *               failures, transition to OPEN.
 *   OPEN      → requests fail fast with `CircuitBreakerOpenError` for
 *               `coolDownMs`. After cooldown, transition to HALF_OPEN.
 *   HALF_OPEN → limited probe requests allowed. On `successThreshold`
 *               consecutive successes, transition back to CLOSED.
 */

import { CircuitBreakerOpenError } from "@/lib/turbopay/errors";
import { cache } from "@/lib/turbocore/cache";

export enum CircuitBreakerState {
  CLOSED,
  OPEN,
  HALF_OPEN,
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_SUCCESS_THRESHOLD = 2;
const STATE_TTL_MS = 60_000; // Redis TTL for breaker state

interface BreakerState {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  lastFailureAt: number;
}

/**
 * Distributed circuit breaker — state stored in Redis when available,
 * falls back to in-memory for single-instance mode.
 */
export class CircuitBreaker {
  private inMemoryState: BreakerState = {
    state: CircuitBreakerState.CLOSED,
    failureCount: 0,
    successCount: 0,
    lastFailureAt: 0,
  };

  constructor(
    private readonly providerName: string,
    private readonly failureThreshold: number = DEFAULT_FAILURE_THRESHOLD,
    private readonly coolDownMs: number = DEFAULT_COOLDOWN_MS,
    private readonly successThreshold: number = DEFAULT_SUCCESS_THRESHOLD,
  ) {}

  private redisKey(): string {
    return `circuit:${this.providerName}`;
  }

  async getState(): Promise<BreakerState> {
    const cached = await cache.get<BreakerState>(this.redisKey());
    if (cached) {
      this.inMemoryState = cached;
      return cached;
    }
    return this.inMemoryState;
  }

  private async setState(state: BreakerState): Promise<void> {
    this.inMemoryState = state;
    await cache.set(this.redisKey(), state, STATE_TTL_MS);
  }

  async execute<T>(action: () => Promise<T>): Promise<T> {
    const currentState = await this.getState();

    if (currentState.state === CircuitBreakerState.OPEN) {
      const elapsed = Date.now() - currentState.lastFailureAt;
      if (elapsed < this.coolDownMs) {
        throw new CircuitBreakerOpenError(this.providerName);
      }
      await this.setState({ ...currentState, state: CircuitBreakerState.HALF_OPEN, successCount: 0 });
    }

    try {
      const result = await action();
      await this.onSuccess();
      return result;
    } catch (err) {
      await this.onFailure();
      throw err;
    }
  }

  private async onSuccess(): Promise<void> {
    const state = await this.getState();
    if (state.state === CircuitBreakerState.HALF_OPEN) {
      state.successCount++;
      if (state.successCount >= this.successThreshold) {
        state.state = CircuitBreakerState.CLOSED;
        state.failureCount = 0;
        state.successCount = 0;
      }
    } else if (state.state === CircuitBreakerState.CLOSED) {
      state.failureCount = 0;
    }
    await this.setState(state);
  }

  private async onFailure(): Promise<void> {
    const state = await this.getState();
    state.lastFailureAt = Date.now();
    if (state.state === CircuitBreakerState.HALF_OPEN) {
      state.state = CircuitBreakerState.OPEN;
      state.successCount = 0;
    } else if (state.state === CircuitBreakerState.CLOSED) {
      state.failureCount++;
      if (state.failureCount >= this.failureThreshold) {
        state.state = CircuitBreakerState.OPEN;
      }
    }
    await this.setState(state);
  }

  async getStateValue(): Promise<CircuitBreakerState> {
    const state = await this.getState();
    if (state.state === CircuitBreakerState.OPEN) {
      const elapsed = Date.now() - state.lastFailureAt;
      if (elapsed >= this.coolDownMs) {
        return CircuitBreakerState.HALF_OPEN;
      }
    }
    return state.state;
  }

  async isOpen(): Promise<boolean> {
    return (await this.getStateValue()) === CircuitBreakerState.OPEN;
  }

  async reset(): Promise<void> {
    await this.setState({
      state: CircuitBreakerState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureAt: 0,
    });
  }
}

// ─── Per-provider breaker registry ──────────────────────────────────────

const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(providerName: string): CircuitBreaker {
  let breaker = breakers.get(providerName);
  if (!breaker) {
    breaker = new CircuitBreaker(providerName);
    breakers.set(providerName, breaker);
  }
  return breaker;
}

export async function resetCircuitBreaker(providerName: string): Promise<void> {
  const breaker = breakers.get(providerName);
  if (breaker) await breaker.reset();
}

export async function listCircuitBreakers(): Promise<Array<{
  providerName: string;
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
}>> {
  const out: Array<{
    providerName: string;
    state: CircuitBreakerState;
    failureCount: number;
    successCount: number;
  }> = [];
  for (const [providerName, breaker] of breakers.entries()) {
    const state = await breaker.getState();
    out.push({
      providerName,
      state: await breaker.getStateValue(),
      failureCount: state.failureCount,
      successCount: state.successCount,
    });
  }
  return out;
}
