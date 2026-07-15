"use client";

import * as React from "react";
import { apiFetch, setIframeToken } from "@/lib/turbopay/client";
import type { SessionUser } from "@/lib/turbopay/types";
import { useApp } from "@/components/turbopay/store";
import { LandingPage } from "@/components/turbopay/landing-page";
import { AuthScreen } from "@/components/turbopay/auth-screen";
import { AppShell } from "@/components/turbopay/app-shell";
import { LoadingScreen } from "@/components/turbopay/loading-screen";

export default function Home() {
  const [status, setStatus] = React.useState<"loading" | "authed" | "guest">("loading");
  const setUser = useApp((s) => s.setUser);
  const user = useApp((s) => s.user);
  const [showAuth, setShowAuth] = React.useState(false);
  const [authTab, setAuthTab] = React.useState<"login" | "register">("login");

  // Bootstrap: check existing session on mount.
  // If the token is stale (e.g. server DB was reset during development),
  // /api/auth/me returns 401 — clear the stale token silently so the user
  // lands on the guest page without a confusing "session expired" toast.
  // A short 400ms minimum display ensures the branded loading animation is
  // visible without making every new tab feel slow.
  React.useEffect(() => {
    let active = true;
    const minDisplay = new Promise((r) => setTimeout(r, 400));
    Promise.all([
      apiFetch<SessionUser>("/api/auth/me").catch(() => null),
      minDisplay,
    ])
      .then(([u]) => {
        if (!active) return;
        if (u && u.emailVerified) {
          setUser(u);
          setStatus("authed");
        } else {
          // No session, OR email not verified — clear any stale tokens + show
          // the landing page. The user must sign in (and verify their email)
          // before they can access the dashboard.
          setIframeToken(null);
          setUser(null);
          setStatus("guest");
        }
      });
    return () => { active = false; };
  }, [setUser]);

  // Reactive sync: if user is set (login) → authed; if user is cleared (logout) → guest.
  // This eliminates the need to refresh after login/logout.
  React.useEffect(() => {
    if (status === "loading") return; // don't interfere with bootstrap
    if (user && status !== "authed") {
      setStatus("authed");
    } else if (!user && status === "authed") {
      setStatus("guest");
      setShowAuth(false);
    }
  }, [user, status]);

  if (status === "loading") {
    return <LoadingScreen />;
  }

  if (status === "authed" && user) {
    return <AppShell />;
  }

  // Guest: show landing page (with option to open auth modal)
  if (showAuth) {
    return <AuthScreen initialTab={authTab} onBack={() => setShowAuth(false)} />;
  }

  return <LandingPage onGetStarted={(tab) => { setAuthTab(tab ?? "login"); setShowAuth(true); }} />;
}
