"use client";

import { useEffect, useState } from "react";
import { CreditCard, Wallet, Ban, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard, StatusBadge } from "@/components/admin";

const PROVIDER_DETAILS: Record<string, { name: string; schemes: string[]; types: string[]; features: string[] }> = {
  onafriq: {
    name: "Onafriq",
    schemes: ["VISA", "Mastercard", "Verve"],
    types: ["Prepaid"],
    features: ["Physical + Virtual", "Multi-currency", "MoMo Funding", "Cross-border"],
  },
  quickteller: {
    name: "Quickteller (Interswitch)",
    schemes: ["Verve"],
    types: ["Debit", "Prepaid"],
    features: ["Card 360 Service", "Bulk Production", "PIN Management", "Block/Unblock"],
  },
};

export default function VirtualCardsAdminPage() {
  const [providers, setProviders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/cards/supported-providers")
      .then(r => r.json())
      .then(data => { setProviders(data.providers || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Virtual Cards Management"
        description="Manage virtual card providers and issuance"
      />

      {/* Card Statistics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Cards" value={0} icon={<CreditCard className="h-5 w-5" />} />
        <StatCard title="Active Cards" value={0} icon={<Activity className="h-5 w-5" />} />
        <StatCard title="Blocked Cards" value={0} icon={<Ban className="h-5 w-5" />} />
        <StatCard title="Total Balance" value="₦0" icon={<Wallet className="h-5 w-5" />} />
      </div>

      {/* Provider Cards */}
      {loading ? (
        <div className="grid gap-6 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {providers.map((provider) => {
            const details = PROVIDER_DETAILS[provider] || { name: provider, schemes: [], types: [], features: [] };
            return (
              <Card key={provider}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold">{details.name}</h3>
                    <StatusBadge variant="success">Active</StatusBadge>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Card Schemes</p>
                      <div className="flex gap-2">
                        {details.schemes.map((scheme) => (
                          <Badge key={scheme} variant="default">{scheme}</Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Card Types</p>
                      <div className="flex gap-2">
                        {details.types.map((type) => (
                          <Badge key={type} variant="secondary">{type}</Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Features</p>
                      <div className="flex flex-wrap gap-2">
                        {details.features.map((feature) => (
                          <Badge key={feature} variant="outline">{feature}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
