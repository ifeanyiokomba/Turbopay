"use client";

import * as React from "react";
import {
  LayoutDashboard,
  Wallet,
  Send,
  Smartphone,
  ReceiptText,
  Clock,
  ShieldCheck,
  Users,
  Settings,
  Shield,
  ShieldAlert,
  Menu,
  LogOut,
  Sun,
  Moon,
  Bell,
  Plus,
  UserCog,
  ArrowLeftRight,
  Flag,
  ClipboardCheck,
  FolderCheck,
  BarChart3,
  Scale,
  Webhook,
  Activity,
  LifeBuoy,
  Megaphone,
  UserPlus,
  Server,
  Star,
  Percent,
  DollarSign,
  Ticket,
  BookOpen,
  X,
  PiggyBank,
  TrendingUp,
  CreditCard,
  CalendarClock,
  AlertTriangle,
  Gift,
  KeyRound,
  Globe,
  Link2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useApp, type ViewKey } from "@/components/turbopay/store";
import { apiPost, useApi, mutateApi } from "@/lib/turbopay/client";
import { Logo, Wordmark } from "@/components/turbopay/logo";
import { AiSupport } from "@/components/turbopay/parts/ai-support";
import { I18nProvider } from "@/components/turbopay/i18n-provider";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import { DashboardView } from "@/components/turbopay/views/dashboard";
import { WalletView } from "@/components/turbopay/views/wallet";
import { TransferView } from "@/components/turbopay/views/transfer";
import { AirtimeDataView } from "@/components/turbopay/views/airtime-data";
import { BillsView } from "@/components/turbopay/views/bills";
import { HistoryView } from "@/components/turbopay/views/history";
import { KycView } from "@/components/turbopay/views/kyc";
import { BeneficiariesView } from "@/components/turbopay/views/beneficiaries";
import { SettingsView } from "@/components/turbopay/views/settings";
import { SecurityView } from "@/components/turbopay/views/security";
import { SupportView } from "@/components/turbopay/views/support";
import { SavingsView } from "@/components/turbopay/views/savings";
import { InvestmentsView } from "@/components/turbopay/views/investments";
import { VirtualCardsView } from "@/components/turbopay/views/virtual-cards";
import { VouchersView } from "@/components/turbopay/views/vouchers";
import { RewardsView } from "@/components/turbopay/views/rewards";
import { ReferralsView } from "@/components/turbopay/views/referrals";
import { DisputesView } from "@/components/turbopay/views/disputes";
import { ScheduledPaymentsView } from "@/components/turbopay/views/scheduled-payments";
import { IntlTransfersView } from "@/components/turbopay/views/intl-transfers";
import { InsightsView } from "@/components/turbopay/views/insights";
import { PaymentLinksView } from "@/components/turbopay/views/payment-links";

const AdminView = React.lazy(() => import("@/components/turbopay/views/admin").then(m => ({ default: m.AdminView })));
const PlatformSettingsView = React.lazy(() => import("@/components/turbopay/views/platform-settings").then(m => ({ default: m.PlatformSettingsView })));
const CustomerManagement = React.lazy(() => import("@/components/turbopay/views/admin/customer-management").then(m => ({ default: m.CustomerManagement })));
const TransactionManagement = React.lazy(() => import("@/components/turbopay/views/admin/transaction-management").then(m => ({ default: m.TransactionManagement })));
const AmlFlags = React.lazy(() => import("@/components/turbopay/views/admin/aml-flags").then(m => ({ default: m.AmlFlags })));
const KycQueue = React.lazy(() => import("@/components/turbopay/views/admin/kyc-queue").then(m => ({ default: m.KycQueue })));
const ComplianceCases = React.lazy(() => import("@/components/turbopay/views/admin/compliance-cases").then(m => ({ default: m.ComplianceCases })));
const FinanceAnalytics = React.lazy(() => import("@/components/turbopay/views/admin/finance-analytics").then(m => ({ default: m.FinanceAnalytics })));
const Reconciliation = React.lazy(() => import("@/components/turbopay/views/admin/reconciliation").then(m => ({ default: m.Reconciliation })));
const WebhookManagement = React.lazy(() => import("@/components/turbopay/views/admin/webhook-management").then(m => ({ default: m.WebhookManagement })));
const SystemHealth = React.lazy(() => import("@/components/turbopay/views/admin/system-health").then(m => ({ default: m.SystemHealth })));
const NotificationCenter = React.lazy(() => import("@/components/turbopay/views/admin/notification-center").then(m => ({ default: m.NotificationCenter })));
const TeamManagement = React.lazy(() => import("@/components/turbopay/views/admin/team-management").then(m => ({ default: m.TeamManagement })));
const TestimonialsManagement = React.lazy(() => import("@/components/turbopay/views/admin/testimonials").then(m => ({ default: m.TestimonialsManagement })));
const FeeConfigurationView = React.lazy(() => import("@/components/turbopay/views/admin/fees").then(m => ({ default: m.FeeConfigurationView })));
const FxConfigurationView = React.lazy(() => import("@/components/turbopay/views/admin/fx-config").then(m => ({ default: m.FxConfigurationView })));
const FeatureFlagsView = React.lazy(() => import("@/components/turbopay/views/admin/feature-flags").then(m => ({ default: m.FeatureFlagsView })));
const VouchersAdminView = React.lazy(() => import("@/components/turbopay/views/admin/vouchers-admin").then(m => ({ default: m.VouchersAdminView })));
const ProviderCredentialsView = React.lazy(() => import("@/components/turbopay/views/admin/provider-credentials").then(m => ({ default: m.ProviderCredentialsView })));
const SupportAdminView = React.lazy(() => import("@/components/turbopay/views/admin/support-admin").then(m => ({ default: m.SupportAdminView })));
const KnowledgeBaseAdminView = React.lazy(() => import("@/components/turbopay/views/admin/knowledge-base-admin").then(m => ({ default: m.KnowledgeBaseAdminView })));
const VirtualCardsAdmin = React.lazy(() => import("@/components/turbopay/views/admin/virtual-cards-admin").then(m => ({ default: m.VirtualCardsAdmin })));
const BulkPaymentsAdmin = React.lazy(() => import("@/components/turbopay/views/admin/bulk-payments").then(m => ({ default: m.BulkPaymentsAdmin })));
const SecurityComplianceAdmin = React.lazy(() => import("@/components/turbopay/views/admin/security-compliance").then(m => ({ default: m.SecurityComplianceAdmin })));
import { PinDialogProvider } from "@/components/turbopay/parts/pin-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup } from "@/components/ui/input-otp";
import { Skeleton } from "@/components/ui/skeleton";

interface NavItem {
  key: ViewKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Non-admin navigation (flat list, grouped for rendering as a single section). */
const USER_NAV: NavGroup[] = [
  {
    label: "Financial",
    items: [
      { key: "intl-transfers", label: "International Transfers", icon: Globe },
      { key: "savings", label: "Savings", icon: PiggyBank },
      { key: "investments", label: "Investments", icon: TrendingUp },
      { key: "cards", label: "Virtual Cards", icon: CreditCard },
      { key: "insights", label: "Insights", icon: BarChart3 },
      { key: "payment-links", label: "Payment Links", icon: Link2 },
    ],
  },
  {
    label: "Account",
    items: [
      { key: "kyc", label: "KYC & Limits", icon: ShieldCheck },
      { key: "rewards", label: "Rewards", icon: Gift },
      { key: "referrals", label: "Referrals", icon: UserPlus },
      { key: "vouchers", label: "Vouchers", icon: Ticket },
      { key: "scheduled-payments", label: "Scheduled", icon: CalendarClock },
      { key: "disputes", label: "Disputes", icon: AlertTriangle },
    ],
  },
  {
    label: "Help",
    items: [
      { key: "settings", label: "Settings", icon: Settings },
      { key: "security", label: "Security", icon: Shield },
      { key: "support", label: "Support", icon: LifeBuoy },
    ],
  },
];

/** Admin navigation — grouped by domain per TurboCore console spec. */
const ADMIN_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ key: "admin", label: "Overview", icon: LayoutDashboard }],
  },
  {
    label: "Operations",
    items: [
      { key: "admin-customers", label: "Customers", icon: UserCog },
      { key: "admin-transactions", label: "Transactions", icon: ArrowLeftRight },
      { key: "admin-bulk-payments", label: "Bulk Payments", icon: Send },
      { key: "admin-cards", label: "Virtual Cards", icon: CreditCard },
    ],
  },
  {
    label: "Compliance",
    items: [
      { key: "admin-aml", label: "AML Flags", icon: Flag },
      { key: "admin-kyc", label: "KYC Queue", icon: ClipboardCheck },
      { key: "admin-compliance", label: "Cases", icon: FolderCheck },
    ],
  },
  {
    label: "Finance",
    items: [
      { key: "admin-finance", label: "Analytics", icon: BarChart3 },
      { key: "admin-reconciliation", label: "Reconciliation", icon: Scale },
    ],
  },
  {
    label: "Platform",
    items: [
      { key: "platform", label: "Platform Settings", icon: Settings },
      { key: "admin-webhooks", label: "Webhooks", icon: Webhook },
      { key: "admin-testimonials", label: "Testimonials", icon: Star },
      { key: "admin-system", label: "System Health", icon: Activity },
      { key: "admin-security-compliance", label: "Security & Compliance", icon: Shield },
      { key: "admin-notifications", label: "Notifications Log", icon: Megaphone },
    ],
  },
  {
    label: "Configuration",
    items: [
      { key: "admin-fees", label: "Fees", icon: Percent },
      { key: "admin-fx-config", label: "FX Rates", icon: DollarSign },
      { key: "admin-flags", label: "Feature Flags", icon: Flag },
      { key: "admin-vouchers-config", label: "Vouchers", icon: Ticket },
      { key: "admin-provider-credentials", label: "Credentials", icon: KeyRound },
    ],
  },
  {
    label: "Support Mgmt",
    items: [
      { key: "admin-support-tickets", label: "Support Tickets", icon: LifeBuoy },
      { key: "admin-kb", label: "Knowledge Base", icon: BookOpen },
    ],
  },
  {
    label: "Team",
    items: [{ key: "admin-team", label: "Team Members", icon: UserPlus }],
  },
];

const VIEW_TITLES: Record<ViewKey, string> = {
  dashboard: "Dashboard",
  wallet: "Wallet",
  transfer: "Local Transfer",
  airtime: "Airtime & Data",
  bills: "Pay Bills",
  history: "Transaction History",
  kyc: "KYC & Limits",
  beneficiaries: "Beneficiaries",
  settings: "Settings",
  security: "Security",
  support: "Support Center",
  savings: "Savings",
  investments: "Investments",
  cards: "Virtual Cards",
  vouchers: "Vouchers",
  rewards: "Rewards",
  referrals: "Referrals",
  disputes: "Disputes",
  "scheduled-payments": "Scheduled Payments",
  insights: "Spending Insights",
  "payment-links": "Payment Links",
  admin: "Admin Overview",
  platform: "Platform Settings",
  "admin-customers": "Customer Management",
  "admin-transactions": "Transaction Management",
  "admin-bulk-payments": "Bulk Payments",
  "admin-cards": "Virtual Card Management",
  "admin-aml": "AML Flags",
  "admin-kyc": "KYC Queue",
  "admin-compliance": "Compliance Cases",
  "admin-finance": "Finance Analytics",
  "admin-reconciliation": "Reconciliation",
  "admin-webhooks": "Webhook Management",
  "admin-system": "System Health",
  "admin-security-compliance": "Security & Compliance",
  "admin-notifications": "Notifications Log",
  "admin-testimonials": "Testimonials",
  "admin-team": "Team Management",
  "admin-fees": "Fee Configuration",
  "admin-fx-config": "FX Rates",
  "admin-flags": "Feature Flags",
  "admin-vouchers-config": "Vouchers",
  "admin-provider-credentials": "Provider Credentials",
  "admin-support-tickets": "Support Tickets",
  "admin-kb": "Knowledge Base",
  "intl-transfers": "International Transfers",
};

export function AppShell() {
  const { user, view, setView, sidebarOpen, setSidebarOpen, logoutClient } = useApp();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [showNotifications, setShowNotifications] = React.useState(false);
  const [showTimeoutWarning, setShowTimeoutWarning] = React.useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = React.useState(0);
  React.useEffect(() => setMounted(true), []);

  // Initialize locale from localStorage
  const setLocale = useApp((s) => s.setLocale);
  React.useEffect(() => {
    const saved = localStorage.getItem("tp_locale");
    if (saved) setLocale(saved);
  }, [setLocale]);

  const isAdmin = user?.role === "ADMIN";
  const navGroups: NavGroup[] = isAdmin ? ADMIN_NAV : USER_NAV;

  const doLogout = React.useCallback(async (reason?: string) => {
    try {
      await apiPost("/api/auth/logout", {});
    } catch {
      /* ignore */
    }
    logoutClient();
    toast.success(reason ?? "Signed out");
  }, [logoutClient]);

  // ─── Inactivity timeout — auto-logout after 15 minutes with 2-min warning ───
  React.useEffect(() => {
    const INACTIVITY = 15 * 60 * 1000; // 15 minutes total
    const WARNING = 13 * 60 * 1000; // show warning at 13 minutes (2 min before logout)
    const COUNTDOWN_S = 120; // 2 minute countdown
    let logoutTimer: ReturnType<typeof setTimeout>;
    let warningTimer: ReturnType<typeof setTimeout>;
    let countdownInterval: ReturnType<typeof setInterval>;

    const clearAll = () => {
      clearTimeout(logoutTimer);
      clearTimeout(warningTimer);
      clearInterval(countdownInterval);
    };

    const resetTimer = () => {
      clearAll();
      setShowTimeoutWarning(false);

      // Warning timer — fires at 13 minutes
      warningTimer = setTimeout(() => {
        setShowTimeoutWarning(true);
        setTimeoutSeconds(COUNTDOWN_S);

        // Countdown timer — updates every second
        let remaining = COUNTDOWN_S;
        countdownInterval = setInterval(() => {
          remaining -= 1;
          setTimeoutSeconds(remaining);
          if (remaining <= 0) {
            clearInterval(countdownInterval);
          }
        }, 1000);

        // Logout timer — fires at 15 minutes
        logoutTimer = setTimeout(() => {
          doLogout("You've been signed out due to inactivity");
        }, INACTIVITY - WARNING);
      }, WARNING);
    };

    // Reset on user activity
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearAll();
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [doLogout]);

  const extendSession = React.useCallback(() => {
    setShowTimeoutWarning(false);
    // The activity event listeners will reset the timer automatically
    // Trigger a synthetic activity event to restart the countdown
    window.dispatchEvent(new Event("mousemove"));
  }, []);

  // ─── Global 401 handler — session expired ───
  // When apiFetch receives a 401 (expired cookie, server restart, etc.) it
  // dispatches `turbopay:auth-expired` ONCE. We log out and show a single
  // toast instead of letting every view independently surface the error.
  React.useEffect(() => {
    const handler = () => {
      logoutClient();
      toast.error("Your session has expired. Please sign in again.");
    };
    window.addEventListener("turbopay:auth-expired", handler);
    return () => window.removeEventListener("turbopay:auth-expired", handler);
  }, [logoutClient]);

  const initials = (user?.fullName ?? "U")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const renderView = () => {
    switch (view) {
      case "dashboard": return <DashboardView />;
      case "wallet": return <WalletView />;
      case "transfer": return <TransferView />;
      case "airtime": return <AirtimeDataView />;
      case "bills": return <BillsView />;
      case "history": return <HistoryView />;
      case "kyc": return <KycView />;
      case "beneficiaries": return <BeneficiariesView />;
      case "settings": return <SettingsView />;
      case "security": return <SecurityView />;
      case "support": return <SupportView />;
      case "savings": return <SavingsView />;
      case "investments": return <InvestmentsView />;
      case "cards": return <VirtualCardsView />;
      case "vouchers": return <VouchersView />;
      case "rewards": return <RewardsView />;
      case "referrals": return <ReferralsView />;
      case "disputes": return <DisputesView />;
      case "scheduled-payments": return <ScheduledPaymentsView />;
      case "intl-transfers": return <IntlTransfersView />;
      case "insights": return <InsightsView />;
      case "payment-links": return <PaymentLinksView />;
      case "admin": return isAdmin ? <AdminView /> : <DashboardView />;
      case "platform": return isAdmin ? <PlatformSettingsView /> : <DashboardView />;
      case "admin-customers": return isAdmin ? <CustomerManagement /> : <DashboardView />;
      case "admin-transactions": return isAdmin ? <TransactionManagement /> : <DashboardView />;
      case "admin-bulk-payments": return isAdmin ? <BulkPaymentsAdmin /> : <DashboardView />;
      case "admin-cards": return isAdmin ? <VirtualCardsAdmin /> : <DashboardView />;
      case "admin-aml": return isAdmin ? <AmlFlags /> : <DashboardView />;
      case "admin-kyc": return isAdmin ? <KycQueue /> : <DashboardView />;
      case "admin-compliance": return isAdmin ? <ComplianceCases /> : <DashboardView />;
      case "admin-finance": return isAdmin ? <FinanceAnalytics /> : <DashboardView />;
      case "admin-reconciliation": return isAdmin ? <Reconciliation /> : <DashboardView />;
      case "admin-webhooks": return isAdmin ? <WebhookManagement /> : <DashboardView />;
      case "admin-system": return isAdmin ? <SystemHealth /> : <DashboardView />;
      case "admin-security-compliance": return isAdmin ? <SecurityComplianceAdmin /> : <DashboardView />;
      case "admin-notifications": return isAdmin ? <NotificationCenter /> : <DashboardView />;
      case "admin-testimonials": return isAdmin ? <TestimonialsManagement /> : <DashboardView />;
      case "admin-team": return isAdmin ? <TeamManagement /> : <DashboardView />;
      case "admin-fees": return isAdmin ? <FeeConfigurationView /> : <DashboardView />;
      case "admin-fx-config": return isAdmin ? <FxConfigurationView /> : <DashboardView />;
      case "admin-flags": return isAdmin ? <FeatureFlagsView /> : <DashboardView />;
      case "admin-vouchers-config": return isAdmin ? <VouchersAdminView /> : <DashboardView />;
      case "admin-provider-credentials": return isAdmin ? <ProviderCredentialsView /> : <DashboardView />;
      case "admin-support-tickets": return isAdmin ? <SupportAdminView /> : <DashboardView />;
      case "admin-kb": return isAdmin ? <KnowledgeBaseAdminView /> : <DashboardView />;
      default: return <DashboardView />;
    }
  };

  const renderNavGroups = (onNavigate?: () => void) => (
    <nav className="flex-1 space-y-4 overflow-y-auto p-3 scrollbar-thin">
      {navGroups.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            {group.label}
          </p>
          {group.items.map((item) => (
            <NavButton
              key={item.key}
              item={item}
              active={view === item.key}
              onClick={() => {
                setView(item.key);
                onNavigate?.();
              }}
            />
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <PinDialogProvider>
    <I18nProvider>
    <div className="flex min-h-screen flex-col bg-background">
      {/* Skip to content — accessibility for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
      >
        Skip to main content
      </a>

      {/* Session Timeout Warning Dialog */}
      {showTimeoutWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border bg-card p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Session Expiring</h3>
                <p className="text-sm text-muted-foreground">You'll be signed out soon</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Your session will expire in{" "}
              <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                {Math.floor(timeoutSeconds / 60)}:{String(timeoutSeconds % 60).padStart(2, "0")}
              </span>
            </p>
            <p className="text-xs text-muted-foreground/70 mb-5">
              Any activity will keep your session active.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => doLogout("Signed out")}
              >
                Sign out
              </Button>
              <Button
                className="flex-1"
                onClick={extendSession}
              >
                Stay signed in
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside aria-label="Main navigation" className="hidden w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
          <div className="flex h-16 items-center gap-2 border-b px-5">
            <Logo size={32} />
            <Wordmark className="text-lg text-sidebar-foreground" />
          </div>
          {renderNavGroups()}
          <div className="border-t p-3">
            <div className="rounded-lg bg-sidebar-accent/60 p-3">
              <p className="text-xs font-medium text-sidebar-accent-foreground">Turbopay MFB</p>
              <p className="mt-0.5 text-[11px] text-sidebar-accent-foreground/70">
                Licensed partners · NDPR-aware
              </p>
            </div>
          </div>
        </aside>

        {/* Mobile sidebar (Sheet) */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 overflow-y-auto bg-sidebar p-0 text-sidebar-foreground">
            <SheetHeader className="border-b p-4">
              <div className="flex items-center gap-2">
                <Logo size={32} />
                <SheetTitle className="text-sidebar-foreground">
                  <Wordmark className="text-lg" />
                </SheetTitle>
              </div>
            </SheetHeader>
            {renderNavGroups(() => setSidebarOpen(false))}
          </SheetContent>
        </Sheet>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-1.5 lg:hidden">
                <Logo size={28} />
                <Wordmark className="text-base" />
              </div>
              <h1 className="hidden text-lg font-semibold tracking-tight sm:block">
                {VIEW_TITLES[view]}
              </h1>
            </div>

            <div className="flex items-center gap-1.5">
              {view !== "wallet" && view !== "transfer" && (
                <Button
                  size="sm"
                  className="hidden sm:inline-flex"
                  onClick={() => setView("wallet")}
                >
                  <Plus className="mr-1 h-4 w-4" /> Fund wallet
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Toggle theme"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" aria-label="Notifications" className="relative" onClick={() => setShowNotifications(true)}>
                <Bell className="h-4 w-4" />
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 rounded-full p-0.5 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring">
                    <Avatar className="h-8 w-8 border">
                      {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.fullName} className="object-cover" />}
                      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="flex flex-col">
                    <span className="text-sm font-medium">{user?.fullName}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">{user?.email}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setView("kyc")}>
                    <ShieldCheck className="mr-2 h-4 w-4" /> KYC Tier {user?.kycTier}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setView("settings")}>
                    <Settings className="mr-2 h-4 w-4" /> Settings
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem onClick={() => setView("admin")}>
                      <ShieldAlert className="mr-2 h-4 w-4" /> Admin Console
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => doLogout()} className="text-destructive focus:text-destructive">
                    <LogOut className="mr-2 h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* Main content — bottom padding on mobile clears the fixed bottom nav */}
          <main id="main-content" aria-label="Main content" className="flex-1 px-4 py-5 pb-20 sm:px-6 sm:py-6 lg:pb-6">
            <div key={view} className="animate-in-fade mx-auto w-full max-w-6xl">
              <ErrorBoundary>
                <React.Suspense fallback={<ViewSkeleton />}>
                  {renderView()}
                </React.Suspense>
              </ErrorBoundary>
            </div>
          </main>

          {/* Footer (sticky to bottom) — extra bottom padding on mobile clears the fixed nav */}
          <footer className="mt-auto border-t bg-background px-4 py-4 pb-20 sm:px-6 lg:pb-4">
            <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 text-xs text-muted-foreground sm:flex-row">
              <div className="flex items-center gap-1.5">
                <Logo size={18} />
                <span>© {new Date().getFullYear()} Turbopay Technologies</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" /> All systems operational
                </span>
                <span className="hidden sm:inline">·</span>
                <span className="hidden sm:inline">NDPR-aware</span>
                <span className="hidden sm:inline">·</span>
                <span className="hidden sm:inline">CBN-aligned partners</span>
              </div>
            </div>
          </footer>
        </div>
      </div>

      {/* Mobile bottom nav — fixed, permanently visible, high z-index so it
          never disappears behind dialogs/toasts/content. Outside the main
          scroll container so it's always pinned to the viewport bottom. */}
      <nav className="fixed bottom-0 left-0 right-0 z-[60] flex h-14 items-center justify-around border-t bg-background/95 backdrop-blur lg:hidden">
        {([
          { key: "dashboard", icon: LayoutDashboard, label: "Home" },
          { key: "wallet", icon: Wallet, label: "Wallet" },
          { key: "transfer", icon: Send, label: "Send" },
          { key: "bills", icon: ReceiptText, label: "Bills" },
          { key: "history", icon: Clock, label: "History" },
        ] as const).map((item) => {
          const active = view === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 text-[10px] transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Aria-live region for screen readers — announces real-time updates */}
      <div aria-live="polite" aria-atomic="true" className="sr-only" />

      {/* Notifications panel — opens when the bell is clicked */}
      <NotificationsDialog open={showNotifications} onOpenChange={setShowNotifications} />
    </div>
    </I18nProvider>
    <AiSupport />
    </PinDialogProvider>
  );
}

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </button>
  );
}

function ViewSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}

/** Notifications dialog — shows the user's in-app notifications. */
function NotificationsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: resp, isLoading } = useApi<{ items: NotificationItem[]; unreadCount: number } | null>(open ? "/api/notifications" : null);
  const notifications = resp?.items ?? [];
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const markAllRead = async () => {
    if (!notifications) return;
    try {
      await Promise.all(
        notifications.filter((n) => !n.read).map((n) =>
          apiPost(`/api/notifications/${n.id}/read`, {}).catch(() => null)
        )
      );
      mutateApi("/api/notifications");
      toast.success("All notifications marked as read");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error("Could not mark notifications as read");
    }
  };

  const markOneRead = async (id: string) => {
    try {
      await apiPost(`/api/notifications/${id}/read`, {});
      mutateApi("/api/notifications");
    } catch (e: any) {
      if (e?.status === 401) return;
    }
  };

  return (
    <>
      {/* Backdrop — click anywhere to close */}
      {open && <div className="fixed inset-0 z-[55]" onClick={() => onOpenChange(false)} />}

      {/* Notification panel — pinned top-right, not centered */}
      {open && (
        <div className="fixed right-3 top-16 z-[56] w-[calc(100vw-1.5rem)] max-w-sm rounded-xl border bg-popover shadow-lg sm:right-4 sm:top-16">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Notifications</span>
              {resp?.unreadCount ? (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">{resp.unreadCount}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {notifications.some((n) => !n.read) && (
                <button onClick={markAllRead} className="text-[11px] text-muted-foreground hover:text-primary">Mark all read</button>
              )}
              <button onClick={() => onOpenChange(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* List — scrollable, max height so it doesn't cover the screen */}
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : notifications.length > 0 ? (
              <div className="space-y-1">
                {notifications.map((n) => {
                  const isExpanded = expandedId === n.id;
                  const message = n.message || "";
                  const isLong = message.length > 80;
                  return (
                    <div
                      key={n.id}
                      className={cn(
                        "rounded-lg border p-2.5 transition-colors",
                        !n.read ? "border-primary/20 bg-primary/5" : "border-transparent hover:bg-accent",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold leading-tight">{n.title}</p>
                          <p className={cn("mt-0.5 text-[11px] leading-snug text-muted-foreground", !isExpanded && isLong && "line-clamp-2")}>
                            {message}
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground/70">
                              {new Date(n.createdAt).toLocaleDateString("en-NG", { month: "short", day: "numeric" })} ·{" "}
                              {new Date(n.createdAt).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {isLong && (
                              <button
                                onClick={() => setExpandedId(isExpanded ? null : n.id)}
                                className="text-[10px] font-medium text-primary hover:underline"
                              >
                                {isExpanded ? "See less" : "See more"}
                              </button>
                            )}
                            {!n.read && (
                              <button
                                onClick={() => markOneRead(n.id)}
                                className="text-[10px] font-medium text-muted-foreground hover:text-primary"
                              >
                                Mark read
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">No notifications yet.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}
