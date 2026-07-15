"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CreditCard,
  Building2,
  Smartphone,
  Globe,
  Receipt,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusBadge, statusVariant } from "@/components/admin";

const PROVIDER_INFO: Record<string, { name: string; icon: React.ReactNode; description: string }> = {
  flutterwave: { name: "Flutterwave", icon: <Globe className="h-5 w-5" />, description: "Multi-country payments" },
  paystack: { name: "Paystack", icon: <CreditCard className="h-5 w-5" />, description: "NG, GH, ZA, KE" },
  monnify: { name: "Monnify", icon: <Building2 className="h-5 w-5" />, description: "Virtual accounts & collections" },
  onafriq: { name: "Onafriq", icon: <Smartphone className="h-5 w-5" />, description: "Pan-African mobile money" },
  remita: { name: "Remita", icon: <Receipt className="h-5 w-5" />, description: "Government & bill payments" },
  quickteller: { name: "Quickteller", icon: <Zap className="h-5 w-5" />, description: "VAS & bill payments" },
};

export default function ProvidersPage() {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/providers")
      .then(r => r.json())
      .then(data => { setProviders(data.providers || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider Management"
        description="Manage your payment provider integrations"
        actions={
          <Link href="/admin/providers/configure">
            <Button size="sm">+ Add Provider</Button>
          </Link>
        }
      />

      {loading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(PROVIDER_INFO).map(([key, info]) => {
            const provider = providers.find((p) => p.name === key);
            const isEnabled = provider?.isEnabled ?? false;
            const health = provider?.health;

            return (
              <Card key={key} className="relative overflow-hidden hover:border-muted-foreground/20 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        {info.icon}
                      </div>
                      <div>
                        <h3 className="font-semibold">{info.name}</h3>
                        <p className="text-xs text-muted-foreground">{info.description}</p>
                      </div>
                    </div>
                    <StatusBadge variant={statusVariant(isEnabled ? "ACTIVE" : "DISABLED")}>
                      {isEnabled ? "Active" : "Inactive"}
                    </StatusBadge>
                  </div>

                  <div className="space-y-2 text-sm mb-4">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Environment</span>
                      <span className="font-medium capitalize">{provider?.environment || "sandbox"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Success Rate</span>
                      <span className="font-medium">
                        {health?.successRate ? `${(health.successRate * 100).toFixed(0)}%` : "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Avg Latency</span>
                      <span className="font-medium">{health?.avgLatency ? `${health.avgLatency}ms` : "N/A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Circuit Breaker</span>
                      <StatusBadge
                        variant={health?.circuitBreakerOpen ? "error" : "success"}
                        dot={false}
                      >
                        {health?.circuitBreakerOpen ? "Open" : "Closed"}
                      </StatusBadge>
                    </div>
                  </div>

                  <Link href={`/admin/providers/${key}`} className="block">
                    <Button variant="outline" className="w-full" size="sm">
                      Configure
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
