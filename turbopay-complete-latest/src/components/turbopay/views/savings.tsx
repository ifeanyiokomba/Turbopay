"use client";

import * as React from "react";
import { toast } from "sonner";
import { PiggyBank, Plus, ArrowDownToLine, ArrowUpFromLine, Target } from "lucide-react";
import { useApi, apiPost, mutateApi } from "@/lib/turbopay/client";
import { formatNaira, parseNairaToKobo } from "@/lib/turbopay/money";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SavingsProduct {
  id: string;
  name: string;
  type: string;
  targetAmountKobo: number | null;
  currentAmountKobo: number;
  lockUntil: string | null;
  status: string;
  interestRateBps: number;
  createdAt: string;
  transactions: Array<{ id: string; type: string; amountKobo: number; createdAt: string }>;
}

const TYPE_LABELS: Record<string, string> = {
  FLEXIBLE: "Flexible", LOCKED: "Locked", TARGET: "Target", GOAL: "Goal", ROUND_UP: "Round-up", AUTO_SAVE: "Auto-Save",
};

export function SavingsView() {
  const { data, isLoading, refetch } = useApi<SavingsProduct[]>("/api/savings");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [actionTarget, setActionTarget] = React.useState<{ id: string; mode: "deposit" | "withdraw" } | null>(null);
  const items = data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Savings"
        description="Stash money in goals and earn while you save."
        icon={<PiggyBank className="h-5 w-5" />}
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New goal</Button>}
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : items.length === 0 ? (
        <Card><CardContent><EmptyState icon={<PiggyBank className="h-6 w-6" />} title="No savings yet" description="Create your first savings goal and start growing your money." action={<Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New goal</Button>} /></CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((p) => {
            const pct = p.targetAmountKobo ? Math.min(100, Math.round((p.currentAmountKobo / p.targetAmountKobo) * 100)) : 0;
            const locked = p.type === "LOCKED" && p.lockUntil && new Date(p.lockUntil) > new Date();
            return (
              <Card key={p.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{p.name}</CardTitle>
                      <p className="mt-0.5 text-xs text-muted-foreground">{TYPE_LABELS[p.type] ?? p.type} · {p.interestRateBps / 100}% p.a.</p>
                    </div>
                    <Badge variant={p.status === "ACTIVE" ? "default" : "secondary"} className="text-[10px]">{p.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="flex items-baseline justify-between">
                      <p className="text-xl font-semibold tabular-nums">{formatNaira(p.currentAmountKobo)}</p>
                      {p.targetAmountKobo ? (
                        <p className="text-xs text-muted-foreground">of {formatNaira(p.targetAmountKobo)}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">No target</p>
                      )}
                    </div>
                    {p.targetAmountKobo ? (
                      <div className="mt-2 space-y-1">
                        <Progress value={pct} />
                        <p className="text-[11px] text-muted-foreground">{pct}% saved</p>
                      </div>
                    ) : null}
                  </div>
                  {locked && <p className="text-[11px] text-warning-foreground">🔒 Locked until {new Date(p.lockUntil!).toLocaleDateString("en-NG")}</p>}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => setActionTarget({ id: p.id, mode: "deposit" })}>
                      <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" /> Deposit
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" disabled={locked || false} onClick={() => setActionTarget({ id: p.id, mode: "withdraw" })}>
                      <ArrowUpFromLine className="mr-1.5 h-3.5 w-3.5" /> Withdraw
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateGoalDialog open={createOpen} onOpenChange={setCreateOpen} onDone={() => refetch()} />
      <ActionDialog target={actionTarget} onClose={() => setActionTarget(null)} onDone={() => { refetch(); mutateApi("/api/wallet"); }} />
    </div>
  );
}

function CreateGoalDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState("FLEXIBLE");
  const [target, setTarget] = React.useState("");
  const [date, setDate] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const submit = async () => {
    if (!name || name.length < 2) return toast.error("Enter a goal name (min 2 chars)");
    setLoading(true);
    try {
      await apiPost("/api/savings", {
        name, type,
        targetAmountKobo: target ? parseNairaToKobo(target) : undefined,
        lockUntil: type === "LOCKED" && date ? new Date(date).toISOString() : undefined,
      });
      toast.success("Savings goal created");
      setName(""); setType("FLEXIBLE"); setTarget(""); setDate("");
      onOpenChange(false);
      onDone();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not create goal"); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle><Target className="mr-2 inline h-5 w-5 text-primary" /> New savings goal</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Goal name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rent — December" /></div>
          <div className="space-y-1.5"><Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FLEXIBLE">Flexible (withdraw anytime)</SelectItem>
                <SelectItem value="LOCKED">Locked (fixed term)</SelectItem>
                <SelectItem value="TARGET">Target goal</SelectItem>
                <SelectItem value="GOAL">Goal-based</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Target amount (optional)</Label><Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="₦100,000" inputMode="decimal" /></div>
          {type === "LOCKED" && (
            <div className="space-y-1.5"><Label>Lock until</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Creating…" : "Create goal"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionDialog({ target, onClose, onDone }: { target: { id: string; mode: "deposit" | "withdraw" } | null; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => { if (target) setAmount(""); }, [target]);

  const submit = async () => {
    if (!target) return;
    const kobo = parseNairaToKobo(amount);
    if (kobo < 5000) return toast.error("Minimum is ₦50");
    setLoading(true);
    try {
      await apiPost(`/api/savings/${target.id}/${target.mode}`, { amountKobo: kobo });
      toast.success(target.mode === "deposit" ? "Deposit successful" : "Withdrawal successful");
      setAmount("");
      onClose();
      onDone();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not complete"); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{target?.mode === "deposit" ? "Deposit to savings" : "Withdraw from savings"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Amount (₦)</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₦5,000" inputMode="decimal" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Processing…" : "Confirm"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
