"use client";

import { create } from "zustand";
import type { SessionUser } from "@/lib/turbopay/types";
import { setIframeToken, resetAuthExpiredFlag } from "@/lib/turbopay/client";

export type ViewKey =
  | "dashboard"
  | "wallet"
  | "transfer"
  | "airtime"
  | "bills"
  | "history"
  | "kyc"
  | "beneficiaries"
  | "settings"
  | "security"
  | "admin"
  | "platform"
  | "admin-customers"
  | "admin-transactions"
  | "admin-cards"
  | "admin-aml"
  | "admin-kyc"
  | "admin-compliance"
  | "admin-finance"
  | "admin-reconciliation"
  | "admin-webhooks"
  | "admin-system"
  | "admin-notifications"
  | "admin-testimonials"
  | "admin-team"
  | "admin-fees"
  | "admin-fx-config"
  | "admin-flags"
  | "admin-vouchers-config"
  | "admin-provider-credentials"
  | "admin-support-tickets"
  | "admin-kb"
  | "admin-bulk-payments"
  | "savings"
  | "investments"
  | "cards"
  | "vouchers"
  | "rewards"
  | "referrals"
  | "disputes"
  | "scheduled-payments"
  | "support"
  | "intl-transfers"
  | "insights"
  | "payment-links";

interface AppState {
  user: SessionUser | null;
  view: ViewKey;
  sidebarOpen: boolean;
  locale: string;
  setUser: (u: SessionUser | null) => void;
  setView: (v: ViewKey) => void;
  setSidebarOpen: (open: boolean) => void;
  setLocale: (l: string) => void;
  logoutClient: () => void;
}

export const useApp = create<AppState>((set) => ({
  user: null,
  view: "dashboard",
  sidebarOpen: false,
  locale: "en",
  setUser: (user) => set({ user }),
  setView: (view) => set({ view, sidebarOpen: false }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setLocale: (locale) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("tp_locale", locale);
    }
    set({ locale });
  },
  logoutClient: () => {
    setIframeToken(null);
    resetAuthExpiredFlag();
    set({ user: null, view: "dashboard" });
  },
}));
