"use client";

import { useEffect, useState } from "react";
import { Globe, ArrowRight, Clock, DollarSign, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard, DataTable, type Column } from "@/components/admin";

interface Corridor {
  source_country: string;
  destination_country: string;
  source_currency: string;
  destination_currency: string;
  supported_providers: string[];
  min_amount: number;
  max_amount: number;
  estimated_delivery: string;
  fee_structure: string;
}

export default function InternationalPage() {
  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/international/corridors")
      .then(r => r.json())
      .then(data => { setCorridors(data.corridors || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const columns: Column<Corridor>[] = [
    {
      key: "source_country",
      header: "Route",
      render: (c) => (
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{c.source_country}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">{c.destination_country}</span>
        </div>
      ),
    },
    {
      key: "source_currency",
      header: "Currency Pair",
      render: (c) => (
        <span className="text-primary">{c.source_currency} → {c.destination_currency}</span>
      ),
    },
    {
      key: "supported_providers",
      header: "Providers",
      render: (c) => (
        <div className="flex gap-1 flex-wrap">
          {c.supported_providers.map((p) => (
            <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
          ))}
        </div>
      ),
    },
    {
      key: "estimated_delivery",
      header: "Delivery",
      render: (c) => (
        <span className="text-success">{c.estimated_delivery}</span>
      ),
    },
    {
      key: "fee_structure",
      header: "Fee",
      render: (c) => (
        <span className="text-warning-foreground">{c.fee_structure}</span>
      ),
    },
    {
      key: "min_amount",
      header: "Limits",
      render: (c) => (
        <span className="text-muted-foreground">
          {c.min_amount.toLocaleString()} - {c.max_amount.toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="International Transfers"
        description="Cross-border payment corridors and provider coverage"
      />

      {/* Provider Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Onafriq Corridors"
          value="43 Countries"
          description="Pan-African coverage"
          icon={<Globe className="h-5 w-5" />}
        />
        <StatCard
          title="Flutterwave Currencies"
          value="30+ Currencies"
          description="Global reach"
          icon={<DollarSign className="h-5 w-5" />}
        />
        <StatCard
          title="Remita PAPSS"
          value="Real-time"
          description="Pan-African settlement"
          icon={<Landmark className="h-5 w-5" />}
        />
        <StatCard
          title="Quickteller PIPE"
          value="Cross-border"
          description="1.4% + ₦10"
          icon={<Clock className="h-5 w-5" />}
        />
      </div>

      {/* Corridors Table */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={corridors}
          searchable
          searchPlaceholder="Search corridors..."
          searchKeys={["source_country", "destination_country", "source_currency"]}
          emptyMessage="No corridors configured"
          keyExtractor={(c, i) => `${c.source_country}-${c.destination_country}-${i}`}
        />
      )}
    </div>
  );
}
