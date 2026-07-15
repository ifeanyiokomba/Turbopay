"use client";

import * as React from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle } from "lucide-react";

/**
 * Global error boundary — catches errors that escape the root layout.
 * This is the last line of defence before the user sees a blank white page.
 * It renders its OWN <html> and <body> tags because the root layout is not
 * rendered when this boundary activates.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  React.useEffect(() => {
    console.error("[Turbopay] Global error:", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: "28rem" }}>
          <div
            style={{
              width: "4rem",
              height: "4rem",
              margin: "0 auto 1rem",
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AlertTriangle style={{ width: "2rem", height: "2rem", color: "#ef4444" }} />
          </div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Turbopay encountered an error
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#a1a1aa", marginBottom: "1.5rem" }}>
            A critical error occurred. Please refresh the page or try again later.
          </p>
          {error.digest && (
            <p style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#71717a" }}>
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1.5rem",
              borderRadius: "0.5rem",
              border: "1px solid #3f3f46",
              background: "transparent",
              color: "#fafafa",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Refresh page
          </button>
        </div>
      </body>
    </html>
  );
}
