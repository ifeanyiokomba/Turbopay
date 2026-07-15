"use client";

import * as React from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary — catches errors thrown by any route segment
 * and displays a branded, actionable error page instead of the default
 * Next.js error screen.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[Turbopay] Route error:", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-8 w-8 text-destructive" />
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          An unexpected error occurred while loading this page. You can try
          again, or contact support if the problem persists.
        </p>
      </div>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          Error ID: {error.digest}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={reset} variant="default">
          <RefreshCw className="mr-2 h-4 w-4" /> Try again
        </Button>
        <Button onClick={() => (window.location.href = "/")} variant="outline">
          Go home
        </Button>
      </div>
    </div>
  );
}
