"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/turbopay/logo";
import {
  LayoutDashboard,
  CreditCard,
  Users,
  Activity,
  Settings,
  Shield,
  Globe,
  Wallet,
  ReceiptText,
  BarChart3,
  FileText,
  Webhook,
  Landmark,
  Coins,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/transactions", label: "Transactions", icon: CreditCard },
      { href: "/admin/customers", label: "Customers", icon: Users },
      { href: "/admin/settlements", label: "Settlements", icon: Landmark },
      { href: "/admin/disputes", label: "Disputes", icon: Shield },
    ],
  },
  {
    label: "Providers",
    items: [
      { href: "/admin/providers", label: "Providers", icon: Activity },
      { href: "/admin/health", label: "Health Monitor", icon: Activity },
      { href: "/admin/capabilities", label: "Capabilities", icon: Globe },
      { href: "/admin/services", label: "Services", icon: Settings },
    ],
  },
  {
    label: "Financial",
    items: [
      { href: "/admin/fees", label: "Fee Config", icon: Coins },
      { href: "/admin/fx", label: "FX Rates", icon: Globe },
      { href: "/admin/virtual-cards", label: "Virtual Cards", icon: Wallet },
      { href: "/admin/international", label: "International", icon: Globe },
    ],
  },
  {
    label: "Compliance",
    items: [
      { href: "/admin/audit-log", label: "Audit Log", icon: FileText },
      { href: "/admin/kyc-queue", label: "KYC Queue", icon: Shield },
      { href: "/admin/sanctions", label: "Sanctions", icon: Shield },
      { href: "/admin/aml", label: "AML Policy", icon: Shield },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/admin/feature-flags", label: "Feature Flags", icon: Settings },
      { href: "/admin/settings", label: "Settings", icon: Settings },
    ],
  },
];

interface AdminSidebarProps {
  user?: { email?: string; name?: string } | null;
}

export function AdminSidebar({ user }: AdminSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r bg-card transition-all duration-300",
        collapsed ? "w-16" : "w-64",
      )}
    >
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b px-4">
        {!collapsed && (
          <Link href="/admin/dashboard" className="flex items-center gap-2">
            <Logo size={24} />
            <span className="text-sm font-semibold">Admin</span>
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-2">
            {!collapsed && (
              <p className="mb-1 px-4 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {section.label}
              </p>
            )}
            {section.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "mx-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    collapsed && "mx-0 justify-center px-0",
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </ScrollArea>

      {/* User */}
      <div className="border-t p-3">
        {!collapsed && user && (
          <div className="mb-2 truncate text-xs text-muted-foreground">
            {user.name || user.email}
          </div>
        )}
      </div>
    </aside>
  );
}
