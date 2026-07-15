/**
 * Dynamic Quick Actions Component
 * ================================
 *
 * Generates quick action buttons based on available capabilities.
 * Hides actions for unsupported features.
 *
 * Usage:
 *   <DynamicQuickActions onSelect={(view) => setView(view)} />
 */

"use client";

import * as React from "react";
import {
  Plus,
  Send,
  Smartphone,
  ReceiptText,
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  Wallet,
  Globe,
  QrCode,
  FileText,
  Repeat,
  Building2,
  Landmark,
  ShieldCheck,
  Zap,
  ChevronRight,
} from "lucide-react";
import { useCapabilities } from "@/lib/turbopay/use-capabilities";
import type { CapabilityCategory } from "@/lib/turbocore/providers/capabilities";
import { cn } from "@/lib/utils";

interface QuickAction {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  view: string;
  tone: string;
  category: CapabilityCategory;
  priority: number;
}

const ALL_ACTIONS: QuickAction[] = [
  // Core actions (always shown if available)
  { label: "Fund wallet", icon: Plus, view: "wallet", tone: "bg-primary text-primary-foreground", category: "collection", priority: 1 },
  { label: "Transfer", icon: Send, view: "transfer", tone: "bg-accent text-accent-foreground", category: "transfer", priority: 2 },
  { label: "Airtime", icon: Smartphone, view: "airtime", tone: "bg-success/15 text-success", category: "airtime", priority: 3 },
  { label: "Pay bills", icon: ReceiptText, view: "bills", tone: "bg-warning/15 text-warning-foreground", category: "bill_payment", priority: 4 },

  // Bill payment providers (direct access)
  { label: "Remita", icon: Building2, view: "bills", tone: "bg-blue-600/15 text-blue-600", category: "bill_payment", priority: 4.1 },
  { label: "Quickteller", icon: Zap, view: "bills", tone: "bg-emerald-600/15 text-emerald-600", category: "bill_payment", priority: 4.2 },

  // Secondary actions
  { label: "Data", icon: Zap, view: "airtime", tone: "bg-blue-500/15 text-blue-500", category: "data", priority: 5 },
  { label: "Electricity", icon: Landmark, view: "bills", tone: "bg-yellow-500/15 text-yellow-600", category: "electricity", priority: 6 },
  { label: "TV Cable", icon: ReceiptText, view: "bills", tone: "bg-purple-500/15 text-purple-500", category: "tv", priority: 7 },
  { label: "Education", icon: FileText, view: "bills", tone: "bg-indigo-500/15 text-indigo-500", category: "education", priority: 8 },

  // Financial actions
  { label: "Virtual Account", icon: Landmark, view: "wallet", tone: "bg-cyan-500/15 text-cyan-500", category: "virtual_account", priority: 10 },
  { label: "Cards", icon: CreditCard, view: "virtual-cards", tone: "bg-pink-500/15 text-pink-500", category: "card_payments", priority: 11 },
  { label: "International", icon: Globe, view: "intl-transfers", tone: "bg-emerald-500/15 text-emerald-500", category: "international", priority: 12 },
  { label: "QR Payment", icon: QrCode, view: "transfer", tone: "bg-violet-500/15 text-violet-500", category: "qr", priority: 13 },
  { label: "Split Payment", icon: Repeat, view: "transfer", tone: "bg-orange-500/15 text-orange-500", category: "split_payment", priority: 14 },
  { label: "Subscriptions", icon: Repeat, view: "scheduled-payments", tone: "bg-teal-500/15 text-teal-500", category: "subscription", priority: 15 },
  { label: "Bulk Transfer", icon: Send, view: "bulk-payments", tone: "bg-rose-500/15 text-rose-500", category: "bulk_transfer", priority: 16 },
  { label: "Payouts", icon: ArrowUpRight, view: "transfer", tone: "bg-lime-500/15 text-lime-600", category: "payout", priority: 17 },
];

interface DynamicQuickActionsProps {
  onSelect: (view: string) => void;
  maxItems?: number;
  className?: string;
}

export function DynamicQuickActions({ onSelect, maxItems = 4, className }: DynamicQuickActionsProps) {
  const { isAvailable, isLoading } = useCapabilities();

  // Filter actions based on available capabilities
  const availableActions = React.useMemo(() => {
    return ALL_ACTIONS
      .filter((action) => isAvailable(action.category))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, maxItems);
  }, [isAvailable, maxItems]);

  if (isLoading) {
    return (
      <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}>
        {Array.from({ length: maxItems }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (availableActions.length === 0) {
    return null;
  }

  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}>
      {availableActions.map((action) => (
        <button
          key={action.label}
          onClick={() => onSelect(action.view)}
          className="group flex flex-col items-start gap-3 rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", action.tone)}>
            <action.icon className="h-5 w-5" />
          </div>
          <span className="text-sm font-medium">{action.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Service Menu Component
 * ======================
 *
 * Renders a dynamic menu for a specific category.
 * Shows all available services with provider badges.
 */

interface ServiceMenuProps {
  category: CapabilityCategory;
  onSelect?: (serviceId: string) => void;
  className?: string;
}

export function ServiceMenu({ category, onSelect, className }: ServiceMenuProps) {
  const { getServices, getProviders, getCategory } = useCapabilities();

  const services = getServices(category);
  const providers = getProviders(category);
  const group = getCategory(category);

  if (services.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{group?.label ?? category}</h3>
        <div className="flex gap-1">
          {providers.slice(0, 3).map((p) => (
            <span key={p} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {p}
            </span>
          ))}
          {providers.length > 3 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              +{providers.length - 3}
            </span>
          )}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {services.map((service) => (
          <button
            key={service.id}
            onClick={() => onSelect?.(service.id)}
            className="flex items-center justify-between rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50"
          >
            <span className="text-sm font-medium">{service.name}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
