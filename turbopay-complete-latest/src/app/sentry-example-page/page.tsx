"use client";

import * as Sentry from "@sentry/nextjs";

export default function SentryExamplePage() {
  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Sentry Test Page</h1>
      <p>Click the button below to trigger a test error in Sentry.</p>
      <button
        onClick={() => {
          throw new Error("Sentry example page test error!");
        }}
        style={{
          padding: "0.75rem 1.5rem",
          fontSize: "1rem",
          cursor: "pointer",
          background: "#e53e3e",
          color: "white",
          border: "none",
          borderRadius: "0.5rem",
        }}
      >
        Throw Test Error
      </button>
    </div>
  );
}
