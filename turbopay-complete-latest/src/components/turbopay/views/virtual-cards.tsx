"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  CreditCard, Plus, Snowflake, Flame, Ban, ArrowDownToLine, ArrowUpFromLine,
  Settings2, Eye, EyeOff, Copy, ShieldAlert, History, Percent, ShoppingBag,
  RotateCcw, Loader2, AlertTriangle,
} from "lucide-react";
import { useApi, apiPost, apiFetch, mutateApi } from "@/lib/turbopay/client";
import { formatNaira, parseNairaToKobo } from "@/lib/turbopay/money";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

interface CardRow {
  id: string;
  type: string;
  status: string;
  last4: string | null;
  brand: string | null;
  balanceKobo: number;
  spendingLimitKobo: number | null;
  provider: string | null;
  cardholderName: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  hasCredentials: boolean;
  createdAt: string;
}

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-success/15 text-success", FROZEN: "bg-warning/15 text-warning-foreground",
  PENDING: "bg-muted text-muted-foreground", TERMINATED: "bg-destructive/15 text-destructive",
};

// Brighter variant for the dark card-visual surface (so the badge stays legible
// on the gradient background).
const CARD_STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-500/25 text-emerald-50 border-emerald-300/30",
  FROZEN: "bg-amber-500/25 text-amber-50 border-amber-300/30",
  PENDING: "bg-white/15 text-white/90 border-white/20",
  TERMINATED: "bg-red-500/25 text-red-50 border-red-300/30",
};

const CARD_GRADIENT: Record<string, string> = {
  VISA: "bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950",
  MASTERCARD: "bg-gradient-to-br from-stone-900 via-stone-800 to-amber-950",
};

/** Format expiry as MM/YY from numeric month/year. */
function formatExpiry(month: number | null, year: number | null): string | null {
  if (!month || !year) return null;
  const mm = String(month).padStart(2, "0");
  const yy = String(year).slice(-2);
  return `${mm}/${yy}`;
}

/** Mask a 16-digit PAN, showing only last4. */
function maskPan(last4: string | null): string {
  return `•••• •••• •••• ${last4 ?? "----"}`;
}

/** Format a full PAN as 4-4-4-4 groups. */
function formatPan(pan: string): string {
  const digits = pan.replace(/\D/g, "");
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

/** Format an ISO timestamp as a readable date/time. */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-NG", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function VirtualCardsView() {
  const { data, isLoading, refetch } = useApi<CardRow[]>("/api/virtual-cards");
  const { data: walletData } = useApi<{ cardsEnabled?: boolean }>("/api/wallet");
  const cardsEnabled = walletData?.cardsEnabled ?? false;
  const [createOpen, setCreateOpen] = React.useState(false);
  const [actionTarget, setActionTarget] = React.useState<{ id: string; mode: "fund" | "withdraw" } | null>(null);
  const [controlsTarget, setControlsTarget] = React.useState<CardRow | null>(null);
  const [terminating, setTerminating] = React.useState<CardRow | null>(null);
  const [revealTarget, setRevealTarget] = React.useState<CardRow | null>(null);
  const [historyTarget, setHistoryTarget] = React.useState<CardRow | null>(null);
  const cards = data ?? [];

  const refreshAll = () => { refetch(); mutateApi("/api/wallet"); };

  const freeze = async (id: string, freeze: boolean) => {
    try {
      await apiPost(`/api/virtual-cards/${id}/${freeze ? "freeze" : "unfreeze"}`, {});
      toast.success(freeze ? "Card frozen" : "Card unfrozen");
      refetch();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not update card"); }
  };

  const terminate = async () => {
    if (!terminating) return;
    try {
      await apiPost(`/api/virtual-cards/${terminating.id}/terminate`, {});
      toast.success("Card terminated — balance refunded to wallet");
      setTerminating(null);
      refreshAll();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not terminate"); }
  };

  const closeReveal = React.useCallback(() => setRevealTarget(null), []);
  const closeHistory = React.useCallback(() => setHistoryTarget(null), []);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Virtual Cards"
        description="Create disposable cards for online payments."
        icon={<CreditCard className="h-5 w-5" />}
        actions={cardsEnabled ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New card</Button> : undefined}
      />

      {!cardsEnabled && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Coming Soon</p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                Virtual cards will be available soon. Join the waitlist to be notified when this feature launches.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-72" />)}</div>
      ) : cards.length === 0 ? (
        <Card><CardContent><EmptyState icon={<CreditCard className="h-6 w-6" />} title="No cards yet" description="Create your first virtual card for safer online spending." action={<Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New card</Button>} /></CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((c) => (
            <Card key={c.id} className={c.status === "TERMINATED" ? "opacity-60" : ""}>
              <CardContent className="space-y-3 p-4">
                <CardVisual card={c} />
                {c.status !== "TERMINATED" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setRevealTarget(c)} disabled={!c.hasCredentials}>
                      <Eye className="mr-1 h-3.5 w-3.5" /> Show details
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setHistoryTarget(c)}>
                      <History className="mr-1 h-3.5 w-3.5" /> History
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setActionTarget({ id: c.id, mode: "fund" })}><ArrowDownToLine className="mr-1 h-3.5 w-3.5" /> Fund</Button>
                    <Button size="sm" variant="outline" onClick={() => setActionTarget({ id: c.id, mode: "withdraw" })}><ArrowUpFromLine className="mr-1 h-3.5 w-3.5" /> Withdraw</Button>
                    {c.status === "ACTIVE" ? (
                      <Button size="sm" variant="outline" onClick={() => freeze(c.id, true)}><Snowflake className="mr-1 h-3.5 w-3.5" /> Freeze</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => freeze(c.id, false)}><Flame className="mr-1 h-3.5 w-3.5" /> Unfreeze</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setControlsTarget(c)}><Settings2 className="mr-1 h-3.5 w-3.5" /> Limits</Button>
                    <Button size="sm" variant="outline" className="col-span-2 text-destructive" onClick={() => setTerminating(c)}><Ban className="mr-1 h-3.5 w-3.5" /> Terminate</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateCardDialog open={createOpen} onOpenChange={setCreateOpen} onDone={refreshAll} />
      <ActionDialog target={actionTarget} onClose={() => setActionTarget(null)} onDone={refreshAll} />
      <ControlsDialog card={controlsTarget} onClose={() => setControlsTarget(null)} onDone={() => refetch()} />
      <RevealDialog card={revealTarget} onClose={closeReveal} />
      <HistoryDialog card={historyTarget} onClose={closeHistory} />
      <Dialog open={!!terminating} onOpenChange={(o) => !o && setTerminating(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Terminate card?</DialogTitle><DialogDescription>This permanently disables the card. Any remaining balance is auto-withdrawn to your wallet.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerminating(null)}>Cancel</Button>
            <Button variant="destructive" onClick={terminate}>Terminate card</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Card Visual ──────────────────────────────────────────
function CardVisual({ card }: { card: CardRow }) {
  const brand = (card.brand ?? "VISA").toUpperCase();
  const gradient = CARD_GRADIENT[brand] ?? CARD_GRADIENT.VISA;
  const expiry = formatExpiry(card.expiryMonth, card.expiryYear);
  return (
    <div className="space-y-2">
      <div className={`relative aspect-[1.586] w-full overflow-hidden rounded-xl p-4 text-white shadow-lg flex flex-col justify-between ${gradient}`}>
        {/* Top row: status badge + brand */}
        <div className="flex items-start justify-between">
          <Badge className={`border backdrop-blur ${CARD_STATUS_TONE[card.status] ?? "bg-white/15 text-white border-white/20"}`}>
            {card.status}
          </Badge>
          <span className="text-sm font-bold italic tracking-wide">{brand}</span>
        </div>

        {/* Middle: chip + masked PAN */}
        <div className="space-y-2">
          <div className="h-6 w-9 rounded-md bg-gradient-to-br from-yellow-200 to-yellow-500 shadow-inner" />
          <div className="font-mono text-[13px] tracking-[0.18em] text-white/90 sm:text-sm">
            {maskPan(card.last4)}
          </div>
        </div>

        {/* Bottom row: cardholder + expiry */}
        <div className="flex items-end justify-between">
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-wider text-white/50">Cardholder</p>
            <p className="truncate text-xs font-medium uppercase tracking-wide">{card.cardholderName ?? "TURBOPAY USER"}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-wider text-white/50">Expires</p>
            <p className="text-xs font-medium tabular-nums">{expiry ?? "--/--"}</p>
          </div>
        </div>
      </div>

      {/* Balance below card visual */}
      <div className="flex items-end justify-between rounded-lg bg-muted/40 px-3 py-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance</p>
          <p className="text-lg font-semibold tabular-nums">{formatNaira(card.balanceKobo)}</p>
        </div>
        {card.spendingLimitKobo ? (
          <p className="text-[11px] text-muted-foreground">Limit: {formatNaira(card.spendingLimitKobo)}</p>
        ) : null}
      </div>
    </div>
  );
}

// ─── Reveal Dialog ────────────────────────────────────────
interface RevealData {
  pan: string;
  cvv: string;
  expiryMonth: number | null;
  expiryYear: number | null;
  cardholderName: string | null;
  last4: string | null;
  brand: string | null;
}

function RevealDialog({ card, onClose }: { card: CardRow | null; onClose: () => void }) {
  const [data, setData] = React.useState<RevealData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [showPan, setShowPan] = React.useState(false);
  const [showCvv, setShowCvv] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState<number | null>(null);

  // Fetch the decrypted PAN/CVV whenever a new card is opened. Depends only
  // on card?.id so the fetch isn't retriggered by parent re-renders.
  React.useEffect(() => {
    if (!card) return;
    const cardId = card.id;
    let cancelled = false;
    setData(null);
    setShowPan(false);
    setShowCvv(false);
    setSecondsLeft(null);
    setLoading(true);
    (async () => {
      try {
        const d = await apiPost<RevealData>(`/api/virtual-cards/${cardId}/reveal`, {});
        if (cancelled) return;
        setData(d);
        setSecondsLeft(60);
      } catch (e: any) {
        if (cancelled) return;
        if (e?.status === 401) return;
        toast.error(e.message ?? "Could not reveal card details");
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [card?.id]);

  // Auto-hide countdown. When the timer hits 0 the dialog closes and the
  // in-memory PAN/CVV are wiped — details never stay on screen.
  React.useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) {
      toast.info("Card details auto-hidden for security");
      onClose();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  // Wipe sensitive values when the dialog closes.
  React.useEffect(() => {
    if (!card) {
      setData(null);
      setShowPan(false);
      setShowCvv(false);
      setSecondsLeft(null);
    }
  }, [card]);

  const copyPan = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.pan);
      toast.success("PAN copied — clear your clipboard after use");
    } catch {
      toast.error("Could not copy PAN");
    }
  };

  const expiry = data ? formatExpiry(data.expiryMonth, data.expiryYear) : null;

  return (
    <Dialog open={!!card} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-primary" /> Card details</DialogTitle>
          <DialogDescription>
            {card ? `${card.brand ?? "VISA"} ending in ${card.last4 ?? "----"}` : "Sensitive card credentials."}
          </DialogDescription>
        </DialogHeader>

        {/* Security warning */}
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>These details are sensitive. Never share them with anyone. Turbopay staff will never ask for your CVV.</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Decrypting…
          </div>
        ) : data ? (
          <div className="space-y-3">
            {/* PAN */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Card number</Label>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setShowPan((v) => !v)}>
                    {showPan ? <><EyeOff className="mr-1 h-3 w-3" /> Hide</> : <><Eye className="mr-1 h-3 w-3" /> Show</>}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={copyPan}>
                    <Copy className="mr-1 h-3 w-3" /> Copy
                  </Button>
                </div>
              </div>
              <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm tracking-[0.18em]">
                {showPan ? formatPan(data.pan) : maskPan(data.last4)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* CVV */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">CVV</Label>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setShowCvv((v) => !v)}>
                    {showCvv ? <><EyeOff className="mr-1 h-3 w-3" /> Hide</> : <><Eye className="mr-1 h-3 w-3" /> Show</>}
                  </Button>
                </div>
                <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm tracking-[0.3em]">
                  {showCvv ? data.cvv : "•••"}
                </div>
              </div>
              {/* Expiry */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Expiry</Label>
                <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm tabular-nums">{expiry ?? "--/--"}</div>
              </div>
            </div>

            {/* Cardholder */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Cardholder</Label>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm uppercase tracking-wide">
                {data.cardholderName ?? "—"}
              </div>
            </div>

            {/* Countdown */}
            <div className="flex items-center justify-between rounded-md bg-muted px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">Auto-hiding for security</span>
              <span className="font-semibold tabular-nums">{secondsLeft}s</span>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── History Dialog ───────────────────────────────────────
type TxType = "FUNDING" | "WITHDRAWAL" | "FEE" | "SPEND" | "REFUND";

interface CardTx {
  id: string;
  cardId: string;
  type: TxType;
  amountKobo: number;
  currency: string;
  status: string;
  merchant: string | null;
  providerRef: string | null;
  metadata: unknown;
  createdAt: string;
}

interface TxPage {
  items: CardTx[];
  total: number;
  page: number;
  limit: number;
}

// FUNDING + REFUND are credits (card receives money). The rest are debits.
const TX_CREDIT: ReadonlySet<TxType> = new Set<TxType>(["FUNDING", "REFUND"]);

function txIcon(type: TxType) {
  switch (type) {
    case "FUNDING": return <ArrowDownToLine className="h-4 w-4" />;
    case "WITHDRAWAL": return <ArrowUpFromLine className="h-4 w-4" />;
    case "FEE": return <Percent className="h-4 w-4" />;
    case "SPEND": return <ShoppingBag className="h-4 w-4" />;
    case "REFUND": return <RotateCcw className="h-4 w-4" />;
    default: return <CreditCard className="h-4 w-4" />;
  }
}

function txLabel(t: CardTx): string {
  if (t.merchant && t.merchant.trim()) return t.merchant;
  return t.type.charAt(0) + t.type.slice(1).toLowerCase();
}

function HistoryDialog({ card, onClose }: { card: CardRow | null; onClose: () => void }) {
  const path = card ? `/api/virtual-cards/${card.id}/transactions` : null;
  const { data, isLoading, error } = useApi<TxPage>(path);

  return (
    <Dialog open={!!card} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" /> Transaction history</DialogTitle>
          <DialogDescription>
            {card ? `•••• ${card.last4 ?? "----"}` : ""}
            {data ? ` · ${data.total} transaction${data.total === 1 ? "" : "s"}` : ""}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-destructive">Could not load transactions.</p>
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="No transactions yet" description="Funding and spending activity will appear here." />
        ) : (
          <div className="max-h-96 overflow-y-auto pr-1">
            <div className="divide-y">
              {data.items.map((t) => {
                const credit = TX_CREDIT.has(t.type);
                return (
                  <div key={t.id} className="flex items-center gap-3 py-2.5">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${credit ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive"}`}>
                      {txIcon(t.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{txLabel(t)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t.type} · {formatTime(t.createdAt)}
                      </p>
                    </div>
                    <div className={`text-right text-sm font-semibold tabular-nums ${credit ? "text-success" : "text-destructive"}`}>
                      {credit ? "+" : "-"}{formatNaira(t.amountKobo)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Card Dialog ───────────────────────────────────
function CreateCardDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [limit, setLimit] = React.useState("");
  const [brand, setBrand] = React.useState<"VISA" | "MASTERCARD">("VISA");
  const [cardholderName, setCardholderName] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setLimit("");
      setBrand("VISA");
      setCardholderName("");
    }
  }, [open]);

  const submit = async () => {
    setLoading(true);
    try {
      const limitKobo = limit ? parseNairaToKobo(limit) : undefined;
      const trimmedName = cardholderName.trim();
      await apiPost("/api/virtual-cards", {
        type: "VIRTUAL",
        brand,
        spendingLimitKobo: limitKobo,
        cardholderName: trimmedName ? trimmedName : undefined,
      });
      toast.success(`${brand} virtual card created`);
      onOpenChange(false);
      onDone();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not create card"); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle><Plus className="mr-2 inline h-5 w-5 text-primary" /> New virtual card</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Brand</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["VISA", "MASTERCARD"] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBrand(b)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    brand === b
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Cardholder name (optional)</Label>
            <Input value={cardholderName} onChange={(e) => setCardholderName(e.target.value)} placeholder="e.g. ADAEZE OKAFOR" maxLength={50} />
            <p className="text-[11px] text-muted-foreground">Defaults to your account name if left blank.</p>
          </div>
          <Separator />
          <div className="space-y-1.5">
            <Label>Spending limit (optional)</Label>
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="₦50,000" inputMode="decimal" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Creating…" : "Create card"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Fund / Withdraw Dialog ───────────────────────────────
function ActionDialog({ target, onClose, onDone }: { target: { id: string; mode: "fund" | "withdraw" } | null; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => { if (target) setAmount(""); }, [target]);

  const submit = async () => {
    if (!target) return;
    const kobo = parseNairaToKobo(amount);
    if (kobo < 5000) return toast.error("Minimum is ₦50");
    setLoading(true);
    try {
      await apiPost(`/api/virtual-cards/${target.id}/${target.mode}`, { amountKobo: kobo });
      toast.success(target.mode === "fund" ? "Card funded" : "Withdrawn to wallet");
      setAmount(""); onClose(); onDone();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not complete"); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{target?.mode === "fund" ? "Fund card" : "Withdraw to wallet"}</DialogTitle></DialogHeader>
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

// ─── Controls Dialog ──────────────────────────────────────
function ControlsDialog({ card, onClose, onDone }: { card: CardRow | null; onClose: () => void; onDone: () => void }) {
  const [daily, setDaily] = React.useState("");
  const [online, setOnline] = React.useState(true);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (card) {
      (async () => {
        try {
          const c = await apiFetch<any>(`/api/virtual-cards/${card.id}/controls`);
          setDaily(c?.dailyLimitKobo ? String(Math.round(c.dailyLimitKobo / 100)) : "");
          setOnline(c?.onlinePaymentsEnabled !== false);
        } catch (e: any) { if (e?.status === 401) return; /* ignore */ }
      })();
    }
  }, [card]);

  const save = async () => {
    if (!card) return;
    setLoading(true);
    try {
      await apiFetch(`/api/virtual-cards/${card.id}/controls`, {
        method: "PATCH",
        body: JSON.stringify({
          dailyLimitKobo: daily ? parseNairaToKobo(daily) : undefined,
          onlinePaymentsEnabled: online,
        }),
      });
      toast.success("Card controls updated");
      onClose(); onDone();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not update controls"); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={!!card} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5 text-primary" /> Card controls</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Daily spending limit (₦)</Label><Input value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="No limit" inputMode="decimal" /></div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div><p className="text-sm font-medium">Online payments</p><p className="text-xs text-muted-foreground">Allow this card for web/online transactions.</p></div>
            <Switch checked={online} onCheckedChange={setOnline} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={loading}>{loading ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
