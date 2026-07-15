"use client";

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatusBadge } from "@/components/admin";

interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  country: string;
  is_primary: boolean;
  supported_providers: string[];
}

interface CountryConfig {
  country: string;
  country_name: string;
  primary_currency: string;
  supported_currencies: string[];
  supported_providers: string[];
  settlement_currency: string;
}

export default function CurrenciesPage() {
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>([]);
  const [countries, setCountries] = useState<CountryConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/currencies").then(r => r.json()),
      fetch("/api/v1/countries").then(r => r.json())
    ]).then(([cur, coun]) => {
      setCurrencies(cur.currencies || []);
      setCountries(coun.countries || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Multi-Currency Management"
        description="Manage supported currencies and country configurations"
      />

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : (
        <>
          {/* Supported Currencies */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Supported Currencies</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {currencies.map((c) => (
                  <div
                    key={c.code}
                    className={`p-3 rounded-lg border ${c.is_primary ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <span className="font-bold">{c.code}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{c.name}</p>
                    <p className="text-sm font-medium">{c.symbol}</p>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {c.supported_providers.slice(0, 2).map((p) => (
                        <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                      ))}
                      {c.supported_providers.length > 2 && (
                        <Badge variant="secondary" className="text-xs">+{c.supported_providers.length - 2}</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Country Configurations */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Country Configurations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {countries.map((c) => (
                  <div key={c.country} className="p-4 rounded-lg border">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Globe className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold">{c.country_name}</h3>
                        <p className="text-xs text-muted-foreground">Primary: {c.primary_currency}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Supported Currencies</p>
                        <div className="flex gap-1 flex-wrap">
                          {c.supported_currencies.map((cur) => (
                            <Badge key={cur} variant="default" className="text-xs">{cur}</Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Providers</p>
                        <div className="flex gap-1 flex-wrap">
                          {c.supported_providers.map((p) => (
                            <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Settlement</p>
                        <Badge variant="outline" className="text-xs">{c.settlement_currency}</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
