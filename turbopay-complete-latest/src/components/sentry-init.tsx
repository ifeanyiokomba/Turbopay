"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export function SentryInit() {
  useEffect(() => {
    if (Sentry.isInitialized()) return;

    Sentry.init({
      dsn: "https://66aab496322a8e6070cd4b9235f59d99@o4511718973964288.ingest.us.sentry.io/4511719197507584",
      enabled: process.env.NODE_ENV === "production",
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
      environment: process.env.NODE_ENV,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? undefined,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
      ],
      beforeSend(event) {
        if (event.request?.cookies) delete event.request.cookies;
        if (event.request?.headers) {
          for (const key of ["authorization", "cookie", "x-cron-secret"]) {
            delete event.request.headers[key];
          }
        }
        return event;
      },
    });
  }, []);

  return null;
}
