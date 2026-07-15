import * as Sentry from "@sentry/nextjs";
import { json } from "@/lib/turbopay/api";

/**
 * Sentry test endpoint — throws an error to verify Sentry is capturing events.
 * DELETE after verifying Sentry works.
 */
export async function GET() {
  // 1. Test manual capture
  Sentry.captureMessage("Sentry test event from Turbopay", "info");
  Sentry.setContext("test", { triggeredAt: new Date().toISOString(), source: "api/test/sentry" });

  // 2. Test exception capture
  try {
    throw new Error("Sentry integration test — this error should appear in your Sentry dashboard");
  } catch (e) {
    Sentry.captureException(e);
  }

  return json({
    data: {
      message: "Sentry test events sent. Check your Sentry dashboard.",
      url: "https://turbobopay-technologies.sentry.io/projects/turbopay/",
      events: ["captureMessage (info)", "captureException (Error)"],
    },
  });
}
