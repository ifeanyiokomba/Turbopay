"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Clock, AlertTriangle, Hash } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard, StatusBadge, statusVariant, DataTable, type Column } from "@/components/admin";

interface SettlementBatch {
  id: string;
  provider: string;
  status: string;
  total_amount: number;
  total_fee: number;
  net_amount: number;
  currency: string;
  transaction_count: number;
  settlement_date: string;
  expected_settlement_date: string;
}

export default function SettlementsPage() {
  const [settlements, setSettlements] = useState<SettlementBatch[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/admin/settlements/pending").then(r => r.json()),
      fetch("/api/v1/admin/settlements/summary").then(r => r.json())
    ]).then(([pending, sum]) => {
      setSettlements(pending.settlements || []);
      setSummary(sum.summary || {});
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const columns: Column<SettlementBatch>[] = [
    { key: "provider", header: "Provider", sortable: true },
    {
      key: "total_amount",
      header: "Amount",
      sortable: true,
      render: (s) => <span className="font-medium">₦{s.total_amount.toLocaleString()}</span>,
    },
    {
      key: "total_fee",
      header: "Fee",
      render: (s) => <span className="text-muted-foreground">₦{s.total_fee.toLocaleString()}</span>,
    },
    {
      key: "net_amount",
      header: "Net Amount",
      sortable: true,
      render: (s) => <span className="text-success font-medium">₦{s.net_amount.toLocaleString()}</span>,
    },
    {
      key: "transaction_count",
      header: "Transactions",
      render: (s) => <span>{s.transaction_count}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (s) => (
        <StatusBadge variant={statusVariant(s.status)} dot={false}>
          {s.status}
        </StatusBadge>
      ),
    },
    {
      key: "expected_settlement_date",
      header: "Expected",
      render: (s) => (
        <span className="text-muted-foreground">
          {new Date(s.expected_settlement_date).toLocaleDateString()}
        </span>
      ),
    },
  ];

  const schedules = [
    { provider: "Paystack", schedule: "T+1" },
    { provider: "Flutterwave", schedule: "T+1" },
    { provider: "Monnify", schedule: "T+0 (Same Day)" },
    { provider: "Onafriq", schedule: "T+1" },
    { provider: "Remita", schedule: "T+1" },
    { provider: "Quickteller", schedule: "T+1" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlements & Reconciliation"
        description="Track provider settlements and reconciliation"
      />

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Settled"
          value={`₦${(summary?.total_settled || 0).toLocaleString()}`}
          icon={<CheckCircle className="h-5 w-5" />}
        />
        <StatCard
          title="Pending Settlement"
          value={`₦${(summary?.pending_settlement || 0).toLocaleString()}`}
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          title="Failed Settlements"
          value={`₦${(summary?.failed_settlement || 0).toLocaleString()}`}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatCard
          title="Settlement Count"
          value={summary?.settlement_count || 0}
          icon={<Hash className="h-5 w-5" />}
        />
      </div>

      {/* Settlement Schedules */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Provider Settlement Schedules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {schedules.map((item) => (
              <div key={item.provider} className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm font-medium">{item.provider}</span>
                <Badge variant={item.schedule.includes("Same Day") ? "default" : "secondary"}>
                  {item.schedule}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Pending Settlements */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={settlements}
          emptyMessage="No pending settlements"
          keyExtractor={(s) => s.id}
        />
      )}
    </div>
  );
}
