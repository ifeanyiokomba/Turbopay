"use client";

import { useEffect, useState } from "react";
import { Activity, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PageHeader, StatusBadge, statusVariant } from "@/components/admin";

export default function HealthPage() {
  const [health, setHealth] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/provider-health/dashboard")
      .then(r => r.json())
      .then(data => { setHealth(data.providers || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider Health Monitor"
        description="Real-time health status of all payment providers"
      />

      {loading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {health.map((p: any) => (
            <Card key={p.provider} className="relative overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold capitalize">{p.provider}</h3>
                  <StatusBadge variant={statusVariant(p.isHealthy ? "ACTIVE" : "FAILED")}>
                    {p.isHealthy ? "Healthy" : "Unhealthy"}
                  </StatusBadge>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Success Rate</span>
                      <span className="font-medium">{Math.round((p.successRate || 0) * 100)}%</span>
                    </div>
                    <Progress value={Math.round((p.successRate || 0) * 100)} className="h-2" />
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Latency</span>
                      <span className="font-medium">
                        {p.avgLatency ? `${p.avgLatency.toFixed(0)}ms` : "N/A"}
                      </span>
                    </div>
                    <Progress value={Math.max(0, 100 - (p.avgLatency || 0) / 50)} className="h-2" />
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Requests</span>
                    <span className="font-medium">{(p.totalRequests || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Circuit Breaker</span>
                    <StatusBadge variant={statusVariant(p.circuitBreakerOpen ? "FAILED" : "ACTIVE")} dot={false}>
                      {p.circuitBreakerOpen ? "OPEN" : "CLOSED"}
                    </StatusBadge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
