"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusBadge, statusVariant } from "@/components/admin";

export default function ProviderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const providerId = params.id as string;
  const [provider, setProvider] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/providers/${providerId}`)
      .then(r => r.json())
      .then(data => { setProvider(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [providerId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Provider not found</p>
        <Link href="/admin/providers">
          <Button variant="link" className="mt-2">Back to providers</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/providers">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </Link>
        <PageHeader
          title={provider.name || providerId}
          actions={
            <StatusBadge variant={statusVariant(provider.isEnabled ? "ACTIVE" : "DISABLED")}>
              {provider.isEnabled ? "Active" : "Inactive"}
            </StatusBadge>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Configuration */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <InfoRow label="Environment" value={provider.environment || "sandbox"} />
              <InfoRow label="Priority" value={provider.priority?.toString() || "0"} />
              <InfoRow label="Webhook URL" value={provider.webhookUrl || "Not configured"} />
              <InfoRow label="Created" value={provider.createdAt ? new Date(provider.createdAt).toLocaleDateString() : "N/A"} />
            </div>
          </CardContent>
        </Card>

        {/* Health Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Health Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Status</span>
                <StatusBadge variant={statusVariant(provider.health?.isHealthy ? "ACTIVE" : "FAILED")} dot={false}>
                  {provider.health?.isHealthy ? "Healthy" : "Unhealthy"}
                </StatusBadge>
              </div>
              <InfoRow label="Success Rate" value={provider.health?.successRate ? `${(provider.health.successRate * 100).toFixed(1)}%` : "N/A"} />
              <InfoRow label="Avg Latency" value={provider.health?.avgLatency ? `${provider.health.avgLatency}ms` : "N/A"} />
              <InfoRow label="Total Requests" value={provider.health?.totalRequests?.toString() || "0"} />
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Circuit Breaker</span>
                <StatusBadge variant={statusVariant(provider.health?.circuitBreakerOpen ? "FAILED" : "ACTIVE")} dot={false}>
                  {provider.health?.circuitBreakerOpen ? "OPEN" : "CLOSED"}
                </StatusBadge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Capabilities */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Capabilities</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {provider.capabilities && Object.entries(provider.capabilities).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2">
                {value ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <X className="h-4 w-4 text-muted-foreground/30" />
                )}
                <span className="text-sm capitalize">{key.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
