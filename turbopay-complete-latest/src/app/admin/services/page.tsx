"use client";

import { useEffect, useState } from "react";
import {
  CreditCard,
  Building2,
  Smartphone,
  ArrowRightLeft,
  Package,
  Wifi,
  Zap,
  Tv,
  GraduationCap,
  Check,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/admin";

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  card_collection: <CreditCard className="h-4 w-4" />,
  bank_transfer_collection: <Building2 className="h-4 w-4" />,
  ussd_collection: <Smartphone className="h-4 w-4" />,
  mobile_money_collection: <Smartphone className="h-4 w-4" />,
  bank_transfer_payout: <ArrowRightLeft className="h-4 w-4" />,
  mobile_money_payout: <ArrowRightLeft className="h-4 w-4" />,
  bulk_payment: <Package className="h-4 w-4" />,
  virtual_account: <Building2 className="h-4 w-4" />,
  airtime: <Smartphone className="h-4 w-4" />,
  data: <Wifi className="h-4 w-4" />,
  electricity: <Zap className="h-4 w-4" />,
  cable_tv: <Tv className="h-4 w-4" />,
  education: <GraduationCap className="h-4 w-4" />,
};

const SERVICES = [
  { id: "card_collection", name: "Card Payments", category: "Collections" },
  { id: "bank_transfer_collection", name: "Bank Transfer", category: "Collections" },
  { id: "ussd_collection", name: "USSD", category: "Collections" },
  { id: "mobile_money_collection", name: "Mobile Money", category: "Collections" },
  { id: "bank_transfer_payout", name: "Bank Transfer Payout", category: "Payouts" },
  { id: "mobile_money_payout", name: "Mobile Money Payout", category: "Payouts" },
  { id: "bulk_payment", name: "Bulk Payments", category: "Payouts" },
  { id: "virtual_account", name: "Virtual Accounts", category: "Accounts" },
  { id: "airtime", name: "Airtime", category: "Bills" },
  { id: "data", name: "Data", category: "Bills" },
  { id: "electricity", name: "Electricity", category: "Bills" },
  { id: "cable_tv", name: "Cable TV", category: "Bills" },
  { id: "education", name: "Education", category: "Bills" },
];

const PROVIDERS = ["flutterwave", "paystack", "monnify", "onafriq", "remita", "quickteller"];

export default function ServicesPage() {
  const [matrix, setMatrix] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/capability-matrix")
      .then(r => r.json())
      .then(data => { setMatrix(data.matrix || {}); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const categories = [...new Set(SERVICES.map(s => s.category))];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Management"
        description="View which providers support each service"
      />

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : (
        categories.map(category => (
          <Card key={category}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{category}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="h-10 px-4 text-left font-medium text-muted-foreground">Service</th>
                      {PROVIDERS.map(p => (
                        <th key={p} className="h-10 px-4 text-center font-medium text-muted-foreground capitalize text-xs">{p}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SERVICES.filter(s => s.category === category).map(service => (
                      <tr key={service.id} className="border-b last:border-0">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="rounded bg-primary/10 p-1.5 text-primary">
                              {SERVICE_ICONS[service.id] || <CreditCard className="h-4 w-4" />}
                            </div>
                            <span className="font-medium">{service.name}</span>
                          </div>
                        </td>
                        {PROVIDERS.map(p => (
                          <td key={p} className="px-4 py-3 text-center">
                            {matrix[service.id]?.includes(p) ? (
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
        ))
      )}
    </div>
  );
}
