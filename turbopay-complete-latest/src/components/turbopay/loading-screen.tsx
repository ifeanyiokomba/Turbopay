"use client";

import * as React from "react";
import { Logo } from "@/components/turbopay/logo";
import { cn } from "@/lib/utils";

/**
 * LoadingScreen — the initial app-load state.
 *
 * Design: a clean, premium splash. The logo + wordmark sit together as a
 * single centered unit (tight gap). The wordmark letters fade + rise in
 * sequence (left-to-right), then settle. A single soft sheen sweeps across
 * on loop. No underline, no dots, no beam.
 */
export function LoadingScreen({ className }: { className?: string }) {
  const word = "Turbopay";
  const letters = Array.from(word);

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col items-center justify-center bg-background px-6",
        className,
      )}
      role="status"
      aria-label="Loading Turbopay"
    >
      {/* Logo + Wordmark — single tight unit */}
      <div className="flex items-center gap-2.5">
        {/* Logo — static, no effects */}
        <Logo size={44} />

        {/* Wordmark — sequential fade-rise-in, then sheen on loop */}
        <div className="relative select-none" aria-label="Turbopay">
          <h1 className="text-2xl font-semibold tracking-tight">
            {letters.map((ch, i) => (
              <span
                key={i}
                className="inline-block"
                style={{
                  animation: `tp-fade-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) ${i * 0.05}s both`,
                  color: i >= 4 ? "var(--primary)" : "var(--foreground)",
                }}
              >
                {ch}
              </span>
            ))}
          </h1>

          {/* Sheen sweep — single soft gradient pass on loop, no duplicate text */}
          <span
            className="pointer-events-none absolute inset-0 block overflow-hidden"
            style={{
              background:
                "linear-gradient(105deg, transparent 40%, rgba(16,163,123,0.5) 50%, transparent 60%)",
              backgroundSize: "250% 100%",
              animation: "tp-sheen 2.8s ease-in-out 1s infinite",
              mixBlendMode: "overlay",
            }}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}
