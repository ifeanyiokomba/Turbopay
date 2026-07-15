"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/admin";

const PROVIDERS = ["flutterwave", "paystack", "monnify", "onafriq", "remita", "quickteller"];
const CAPABILITIES = [
  "card", "bank_transfer", "ussd", "mobile_money", "qr",
  "bulk", "scheduled", "virtual_accounts", "refunds", "webhooks",
  "multi_currency", "international", "recurring"
];

export default function CapabilitiesPage() {
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all(
      PROVIDERS.map(p => fetch(`/api/admin/providers/${p}`).then(r => r.json()).catch(() => ({})))
    ).then(results => {
      const m: Record<string, Record<string, boolean>> = {};
      results.forEach((data, i) => {
        m[PROVIDERS[i]] = data.capabilities || {};
      });
      setMatrix(m);
      setLoading(false);
    });
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Capability Matrix"
        description="Provider capabilities at a glance"
      />

      {loading ? (
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="h-10 px-4 text-left font-medium text-muted-foreground">Capability</th>
                    {PROVIDERS.map(p => (
                      <th key={p} className="h-10 px-4 text-center font-medium text-muted-foreground capitalize text-xs">{p}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CAPABILITIES.map(cap => (
                    <tr key={cap} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium capitalize">{cap.replace(/_/g, " ")}</td>
                      {PROVIDERS.map(p => (
                        <td key={p} className="px-4 py-3 text-center">
                          {matrix[p]?.[cap] ? (
                            <Check className="h-4 w-4 text-success mx-auto" />
                          ) : (
                            <X className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
