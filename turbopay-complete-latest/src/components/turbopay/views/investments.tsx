"use client";

import * as React from "react";
import { toast } from "sonner";
import { TrendingUp, ChevronRight, Briefcase, Calendar, Shield } from "lucide-react";
import { useApi, apiPost, mutateApi } from "@/lib/turbopay/client";
import { formatNaira, parseNairaToKobo } from "@/lib/turbopay/money";
import { PageHeader, EmptyState, StatCard } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

interface Product {
  id: string; name: string; description: string | null;
  type: string; provider: string | null;
  minAmountKobo: number; maxAmountKobo: number | null;
  expectedReturnBps: number; duration: string | null; riskLevel: string; active: boolean;
}

interface PortfolioEntry {
  id: string; productId: string; productName: string; productType: string; riskLevel: string;
  principalKobo: number; expectedReturnKobo: number; currentValueKobo: number;
  status: string; maturityDate: string | null; createdAt: string;
}

const RISK_TONE: Record<string, string> = {
  LOW: "bg-success/15 text-success", MEDIUM: "bg-warning/15 text-warning-foreground", HIGH: "bg-destructive/15 text-destructive",
};

export function InvestmentsView() {
  const { data: catalog, isLoading } = useApi<Product[]>("/api/investments");
  const { data: portfolio } = useApi<PortfolioEntry[]>("/api/investments/portfolio");
  const [selected, setSelected] = React.useState<Product | null>(null);
  const products = catalog ?? [];
  const holdings = portfolio ?? [];

  const totalValue = holdings.filter((h) => h.status === "ACTIVE").reduce((a, h) => a + h.currentValueKobo, 0);
  const totalPrincipal = holdings.filter((h) => h.status === "ACTIVE").reduce((a, h) => a + h.principalKobo, 0);
  const totalReturn = holdings.filter((h) => h.status === "ACTIVE").reduce((a, h) => a + h.expectedReturnKobo, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Investments"
        description="Grow your money with curated, regulated products."
        icon={<TrendingUp className="h-5 w-5" />}
      />

      {holdings.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Portfolio value" value={formatNaira(totalValue)} icon={<Briefcase className="h-4 w-4" />} hint="Principal + expected return" />
          <StatCard label="Principal" value={formatNaira(totalPrincipal)} tone="default" />
          <StatCard label="Expected return" value={formatNaira(totalReturn)} tone="success" />
        </div>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Briefcase className="h-4 w-4" /> Your holdings</CardTitle></CardHeader>
        <CardContent>
          {holdings.length === 0 ? (
            <EmptyState icon={<Briefcase className="h-6 w-6" />} title="No active investments" description="Browse the catalog below and start your first investment." />
          ) : (
            <div className="space-y-2">
              {holdings.map((h) => (
                <div key={h.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{h.productName}</p>
                    <p className="text-xs text-muted-foreground">{h.productType} · Principal {formatNaira(h.principalKobo)}</p>
                    {h.maturityDate && <p className="text-[11px] text-muted-foreground">Matures {new Date(h.maturityDate).toLocaleDateString("en-NG")}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{formatNaira(h.currentValueKobo)}</p>
                    <Badge variant="outline" className={h.status === "ACTIVE" ? "bg-success/15 text-success text-[10px]" : "text-[10px]"}>{h.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Investment catalog</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          ) : products.length === 0 ? (
            <EmptyState icon={<TrendingUp className="h-6 w-6" />} title="No products available" description="Please check back later for new investment opportunities." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {products.map((p) => (
                <button key={p.id} onClick={() => setSelected(p)} className="rounded-xl border p-4 text-left transition-colors hover:bg-accent">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{p.type}</p>
                    </div>
                    <Badge variant="outline" className={RISK_TONE[p.riskLevel] ?? "text-[10px]"}>{p.riskLevel} risk</Badge>
                  </div>
                  {p.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">From {formatNaira(p.minAmountKobo)}</span>
                    <span className="font-semibold text-success">{p.expectedReturnBps / 100}% return</span>
                  </div>
                  <div className="mt-2 flex items-center justify-end text-xs text-primary">Invest <ChevronRight className="ml-0.5 h-3 w-3" /></div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <InvestDialog product={selected} onClose={() => setSelected(null)} onDone={() => { mutateApi("/api/investments/portfolio"); mutateApi("/api/wallet"); }} />
    </div>
  );
}

function InvestDialog({ product, onClose, onDone }: { product: Product | null; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => { if (product) setAmount(""); }, [product]);

  const submit = async () => {
    if (!product) return;
    const kobo = parseNairaToKobo(amount);
    if (kobo < product.minAmountKobo) return toast.error(`Minimum is ${formatNaira(product.minAmountKobo)}`);
    if (product.maxAmountKobo && kobo > product.maxAmountKobo) return toast.error(`Maximum is ${formatNaira(product.maxAmountKobo)}`);
    setLoading(true);
    try {
      await apiPost(`/api/investments/${product.id}/invest`, { amountKobo: kobo });
      toast.success("Investment placed successfully");
      setAmount("");
      onClose();
      onDone();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not invest"); }
    finally { setLoading(false); }
  };

  if (!product) return null;

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /> {product.name}</DialogTitle>
          <DialogDescription>{product.description ?? "Review the details and enter your investment amount."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-xs">
            <div className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-muted-foreground" /> <span>{product.riskLevel} risk</span></div>
            <div className="flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5 text-muted-foreground" /> <span>{product.expectedReturnBps / 100}% return</span></div>
            <div className="col-span-2 flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-muted-foreground" /> <span>{product.duration ?? "Flexible term"}</span></div>
            <div><span className="text-muted-foreground">Min:</span> <span className="font-medium">{formatNaira(product.minAmountKobo)}</span></div>
            {product.maxAmountKobo && <div><span className="text-muted-foreground">Max:</span> <span className="font-medium">{formatNaira(product.maxAmountKobo)}</span></div>}
          </div>
          <div className="space-y-1.5">
            <Label>Investment amount (₦)</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={formatNaira(product.minAmountKobo)} inputMode="decimal" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Processing…" : "Invest now"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
