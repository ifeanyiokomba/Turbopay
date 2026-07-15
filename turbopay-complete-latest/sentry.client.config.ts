import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://66aab496322a8e6070cd4b9235f59d99@o4511718973964288.ingest.us.sentry.io/4511719197507584",

  enabled:
    process.env.NODE_ENV === "production",

  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  environment: process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA ?? undefined,

  beforeSend(event) {
    // Scrub PII from breadcrumbs and extra data
    if (event.request?.cookies) {
      delete event.request.cookies;
    }
    // Scrub sensitive headers
    if (event.request?.headers) {
      const sensitive = ["authorization", "cookie", "x-cron-secret"];
      for (const key of sensitive) {
        delete event.request.headers[key];
      }
    }
    return event;
  },
});
