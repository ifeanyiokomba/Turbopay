"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusBadge, statusVariant, DataTable, type Column } from "@/components/admin";

interface Transaction {
  id: string;
  reference: string;
  type: string;
  amountKobo: number;
  status: string;
  provider?: string;
  createdAt: string;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetch("/api/admin/transactions")
      .then(r => r.json())
      .then(data => { setTransactions(data.transactions || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = filter === "all" ? transactions : transactions.filter(t => t.status === filter);

  const columns: Column<Transaction>[] = [
    {
      key: "reference",
      header: "Reference",
      sortable: true,
      render: (tx) => <span className="font-mono text-sm">{tx.reference}</span>,
    },
    {
      key: "type",
      header: "Type",
      sortable: true,
      render: (tx) => (
        <div className="flex items-center gap-2">
          {tx.type === "CREDIT" ? (
            <ArrowDownLeft className="h-3.5 w-3.5 text-success" />
          ) : (
            <ArrowUpRight className="h-3.5 w-3.5 text-primary" />
          )}
          <span>{tx.type}</span>
        </div>
      ),
    },
    {
      key: "amountKobo",
      header: "Amount",
      sortable: true,
      render: (tx) => (
        <span className="font-medium">
          ₦{((tx.amountKobo || 0) / 100).toLocaleString()}
        </span>
      ),
    },
    {
      key: "provider",
      header: "Provider",
      sortable: true,
      render: (tx) => (
        <span className="capitalize">{tx.provider || "N/A"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (tx) => (
        <StatusBadge variant={statusVariant(tx.status)} dot={false}>
          {tx.status}
        </StatusBadge>
      ),
    },
    {
      key: "createdAt",
      header: "Date",
      sortable: true,
      render: (tx) => (
        <span className="text-muted-foreground">
          {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString() : "N/A"}
        </span>
      ),
    },
  ];

  const filterButtons = ["all", "SUCCESS", "PENDING", "FAILED"] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description={`${transactions.length} total transactions`}
        actions={
          <div className="flex gap-1">
            {filterButtons.map(f => (
              <Button
                key={f}
                variant={filter === f ? "default" : "ghost"}
                size="sm"
                onClick={() => setFilter(f)}
                className="h-8 text-xs"
              >
                {f === "all" ? "All" : f}
              </Button>
            ))}
          </div>
        }
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          searchable
          searchPlaceholder="Search by reference..."
          searchKeys={["reference", "provider"]}
          keyExtractor={(tx) => tx.id}
        />
      )}
    </div>
  );
}
