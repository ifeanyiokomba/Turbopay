"use client";

import * as React from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[Turbopay] ErrorBoundary caught:", error, info.componentStack);
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
    this.props.onError?.(error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              An unexpected error occurred in this section. You can try again
              or navigate to a different page.
            </p>
          </div>
          {(this.state.error as any)?.digest && (
            <p className="font-mono text-xs text-muted-foreground">
              Error ID: {(this.state.error as any).digest}
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={this.reset} variant="default" size="sm">
              Try again
            </Button>
            <Button onClick={() => (window.location.href = "/")} variant="outline" size="sm">
              Go home
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
