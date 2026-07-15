"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Info, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, StatCard, StatusBadge, statusVariant, DataTable, type Column } from "@/components/admin";

interface AuditEntry {
  id: string;
  event: string;
  entity_type: string;
  entity_id: string;
  actor?: string;
  severity: string;
  created_at: string;
  metadata?: any;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ event: "", severity: "", entity_type: "" });

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.event) params.set("event", filters.event);
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.entity_type) params.set("entity_type", filters.entity_type);
    params.set("limit", "100");

    Promise.all([
      fetch(`/api/v1/admin/audit-log?${params}`).then(r => r.json()),
      fetch("/api/v1/admin/audit-log/stats").then(r => r.json())
    ]).then(([log, s]) => {
      setEntries(log.entries || []);
      setStats(s.stats || {});
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [filters]);

  const columns: Column<AuditEntry>[] = [
    {
      key: "created_at",
      header: "Time",
      sortable: true,
      render: (e) => (
        <span className="text-muted-foreground text-xs">
          {new Date(e.created_at).toLocaleString()}
        </span>
      ),
    },
    { key: "event", header: "Event", sortable: true },
    {
      key: "entity_type",
      header: "Entity",
      render: (e) => (
        <span className="text-muted-foreground">{e.entity_type}/{e.entity_id}</span>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      render: (e) => e.actor || "system",
    },
    {
      key: "severity",
      header: "Severity",
      render: (e) => (
        <StatusBadge variant={statusVariant(e.severity === "critical" ? "error" : e.severity)} dot={false}>
          {e.severity}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Track all system events and admin actions"
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Events"
          value={stats?.total_events || 0}
          icon={<Activity className="h-5 w-5" />}
        />
        <StatCard
          title="Info"
          value={stats?.events_by_severity?.info || 0}
          icon={<Info className="h-5 w-5" />}
        />
        <StatCard
          title="Warnings"
          value={stats?.events_by_severity?.warning || 0}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatCard
          title="Errors"
          value={stats?.events_by_severity?.error || 0}
          icon={<AlertCircle className="h-5 w-5" />}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-4 flex-wrap">
            <Select value={filters.severity} onValueChange={(v) => setFilters({ ...filters, severity: v })}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severity</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.entity_type} onValueChange={(v) => setFilters({ ...filters, entity_type: v })}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Entity Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entity Types</SelectItem>
                <SelectItem value="transaction">Transaction</SelectItem>
                <SelectItem value="virtual_card">Virtual Card</SelectItem>
                <SelectItem value="settlement">Settlement</SelectItem>
                <SelectItem value="wallet">Wallet</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="webhook">Webhook</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Log Entries */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={entries}
          searchable
          searchPlaceholder="Search events..."
          searchKeys={["event", "entity_type", "actor"]}
          emptyMessage="No audit entries"
          keyExtractor={(e) => e.id}
        />
      )}
    </div>
  );
}
