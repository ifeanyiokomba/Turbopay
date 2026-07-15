"use client";

import * as React from "react";
import { toast } from "sonner";
import { Send, Users, ArrowRight, Check, ShieldCheck, Star, Trash2, Building2, CreditCard, Globe } from "lucide-react";
import { useApi, apiPost, mutateApi } from "@/lib/turbopay/client";
import { formatNaira, parseNairaToKobo } from "@/lib/turbopay/money";
import type { SessionUser } from "@/lib/turbopay/types";
import { useApp } from "@/components/turbopay/store";
import { usePinDialog } from "@/components/turbopay/parts/pin-dialog";
import { PageHeader } from "@/components/turbopay/parts/layout";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

// Nigerian banks for external transfers
const NIGERIAN_BANKS = [
  { code: "044", name: "Access Bank" },
  { code: "063", name: "Diamond Bank" },
  { code: "050", name: "Ecobank" },
  { code: "045", name: "Equity Bank" },
  { code: "058", name: "GTBank" },
  { code: "030", name: "Heritage Bank" },
  { code: "082", name: "Hotels" },
  { code: "032", name: "Union Bank" },
  { code: "033", name: "United Bank for Africa" },
  { code: "035", name: "Wema Bank" },
  { code: "057", name: "Zenith Bank" },
  { code: "214", name: "First Bank" },
  { code: "232", name: "Sterling Bank" },
  { code: "076", name: "Polaris Bank" },
  { code: "084", name: "Keystone Bank" },
  { code: "301", name: "Jaiz Bank" },
  { code: "100", name: "SunTrust Bank" },
  { code: "090", name: "Stanbic IBTC" },
  { code: "232", name: "Sterling Bank" },
  { code: "000", name: "Central Bank of Nigeria" },
  { code: "999", name: "NIP (Inter-Bank)" },
];

  interface WalletData {
  wallet: { id: string; balanceKobo: number; ledgerBalanceKobo: number; currency: string; status: string };
  virtualAccount: any;
  beneficiaries: { id: string; name: string; accountNumber: string; bankName: string; type: string; bankCode?: string }[];
}

type TransferType = "turbopay" | "bank" | "international";

export function TransferView() {
  const user = useApp((s) => s.user) as SessionUser | null;
  const setView = useApp((s) => s.setView);
  const pinDialog = usePinDialog();
  const { data, isLoading } = useApi<WalletData>("/api/wallet");

  const [transferType, setTransferType] = React.useState<TransferType>("turbopay");
  const [recipient, setRecipient] = React.useState("");
  const [recipientName, setRecipientName] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [saveBen, setSaveBen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [done, setDone] = React.useState<null | { reference: string; amountKobo: number; recipientName: string; newBalanceKobo: number }>(null);
  const [favorites, setFavorites] = React.useState<Set<string>>(new Set());

  // Bank transfer fields
  const [bankCode, setBankCode] = React.useState("");
  const [bankName, setBankName] = React.useState("");
  const [accountNumber, setAccountNumber] = React.useState("");
  const [bankSearch, setBankSearch] = React.useState("");
  const [fee, setFee] = React.useState<{ feeKobo: number; totalDebitKobo: number } | null>(null);
  const [resolving, setResolving] = React.useState(false);
  const [resolved, setResolved] = React.useState(false);

  // ─── Bank BIN lookup — first 3 digits → bank code ───
  const BANK_BIN_MAP: Record<string, string> = {
    "044": "044", "063": "063", "050": "050", "045": "045", "058": "058",
    "030": "030", "032": "032", "033": "033", "035": "035", "057": "057",
    "214": "214", "232": "232", "076": "076", "082": "082", "084": "084",
    "301": "301", "100": "100", "090": "090", "000": "000", "999": "999",
  };

  const detectBankFromAccount = (acctNum: string): { code: string; name: string } | null => {
    if (acctNum.length < 3) return null;
    const bin = acctNum.slice(0, 3);
    const code = BANK_BIN_MAP[bin];
    if (!code) return null;
    const bank = NIGERIAN_BANKS.find((b) => b.code === code);
    return bank ? { code: bank.code, name: bank.name } : null;
  };

  // ─── Auto-resolve account name when 10 digits + bank selected ───
  React.useEffect(() => {
    if (accountNumber.length !== 10 || !bankCode) { setResolved(false); return; }
    let cancelled = false;
    setResolving(true);
    apiPost<{ accountName: string; bankName: string }>("/api/banks/resolve", {
      accountNumber: accountNumber.trim(),
      bankCode,
    })
      .then((res) => { if (!cancelled && res.accountName) { setRecipientName(res.accountName); setResolved(true); } })
      .catch(() => { if (!cancelled) setResolved(false); })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [accountNumber, bankCode]);

  // Estimate fee when amount or transfer type changes
  React.useEffect(() => {
    if (!amount || Number(amount) < 50) { setFee(null); return; }
    const amountNaira = Number(amount);
    apiPost<{ feeKobo: number; totalDebitKobo: number }>("/api/transfer/fee", {
      amountNaira,
      type: transferType === "turbopay" ? "internal" : "external",
    }).then(setFee).catch(() => setFee(null));
  }, [amount, transferType]);

  // Load favorites from localStorage
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem("tp_favorites");
      if (stored) setFavorites(new Set(JSON.parse(stored)));
    } catch { /* ignore */ }
  }, []);

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem("tp_favorites", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const removeBeneficiary = async (id: string) => {
    try {
      await fetch(`/api/beneficiaries/${id}`, { method: "DELETE" });
      toast.success("Beneficiary removed");
      mutateApi("/api/wallet");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not remove beneficiary");
    }
  };

  const amountKobo = parseNairaToKobo(amount);
  const insufficient = data && amountKobo > data.wallet.balanceKobo;

  const filteredBanks = NIGERIAN_BANKS.filter(
    (b) => !bankSearch || b.name.toLowerCase().includes(bankSearch.toLowerCase()) || b.code.includes(bankSearch)
  );

  const openConfirm = () => {
    if (transferType === "turbopay") {
      if (!recipient.trim()) return toast.error("Enter a recipient");
    } else {
      if (!accountNumber.trim()) return toast.error("Enter account number");
      if (!bankCode) return toast.error("Select a bank");
    }
    if (amountKobo < 5000) return toast.error("Minimum transfer is ₦50");
    if (insufficient) return toast.error("Insufficient funds");
    if (user && !user.hasTransactionPin) {
      toast.error("Please set your transaction PIN in Settings first.");
      setView("settings");
      return;
    }
    setRecipientName(transferType === "turbopay" ? recipient.trim() : recipientName || accountNumber);
    setConfirmOpen(true);
  };

  const submit = async () => {
    const pin = await pinDialog.request();
    if (!pin) return;
    setConfirmOpen(false);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        amountNaira: amountKobo / 100,
        note: note.trim() || undefined,
        saveBeneficiary: saveBen,
        pin,
      };

      if (transferType === "turbopay") {
        body.recipient = recipient.trim();
      } else {
        body.accountNumber = accountNumber.trim();
        body.bankCode = bankCode;
        body.bankName = bankName;
        body.recipientName = recipientName || accountNumber;
      }

      const res = await apiPost<{ reference: string; amountKobo: number; recipientName: string; newBalanceKobo: number }>(
        "/api/transfer",
        body
      );
      setDone(res);
      mutateApi("/api/wallet");
      mutateApi("/api/dashboard");
      mutateApi("/api/transactions");
      toast.success("Transfer successful");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Transfer failed");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setDone(null);
    setRecipient("");
    setRecipientName("");
    setAmount("");
    setNote("");
    setSaveBen(false);
    setBankCode("");
    setBankName("");
    setAccountNumber("");
    setBankSearch("");
  };

  if (done) {
    return (
      <div className="mx-auto max-w-md">
        <Card className="overflow-hidden">
          <div className="flex flex-col items-center bg-success/10 px-6 py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/20">
              <Check className="h-8 w-8 text-success" />
            </div>
            <h2 className="mt-4 text-xl font-bold">Transfer successful</h2>
            <p className="mt-1 text-sm text-muted-foreground">₦{(done.amountKobo / 100).toLocaleString()} sent to {done.recipientName}</p>
            <p className="mt-3 text-3xl font-bold tabular-nums">{formatNaira(done.amountKobo)}</p>
          </div>
          <CardContent className="space-y-3 pt-5">
            <Row label="Recipient" value={done.recipientName} />
            <Row label="Reference" value={done.reference} mono />
            <Row label="New balance" value={formatNaira(done.newBalanceKobo)} />
            <Separator />
            <Row label="Date" value={new Date().toLocaleString("en-NG")} />
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={reset}>New transfer</Button>
              <Button className="flex-1" onClick={() => setView("history")}>View receipt</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Transfer" description="Send money to Turbopay users or bank accounts." icon={<Send className="h-5 w-5" />} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Send money</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Balance */}
              {isLoading || !data ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
                  <span className="text-sm text-muted-foreground">Available balance</span>
                  <span className="font-semibold tabular-nums">{formatNaira(data.wallet.balanceKobo)}</span>
                </div>
              )}

              {/* Transfer type toggle */}
              <div className="flex rounded-lg border bg-muted/50 p-1">
                <button
                  onClick={() => setTransferType("turbopay")}
                  className={cn(
                    "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    transferType === "turbopay" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <CreditCard className="mr-1.5 inline h-4 w-4" /> Turbopay
                </button>
                <button
                  onClick={() => setTransferType("bank")}
                  className={cn(
                    "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    transferType === "bank" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Building2 className="mr-1.5 inline h-4 w-4" /> Bank
                </button>
                {user?.country && user.country !== "NG" && (
                  <button
                    onClick={() => setTransferType("international")}
                    className={cn(
                      "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      transferType === "international" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Globe className="mr-1.5 inline h-4 w-4" /> International
                  </button>
                )}
              </div>

              {/* Turbopay transfer: recipient field */}
              {transferType === "turbopay" && (
                <div className="space-y-1.5">
                  <Label htmlFor="recipient">Recipient (phone, email, or Turbopay account)</Label>
                  <Input
                    id="recipient"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="+2348098765432 or chidi@example.ng"
                  />
                </div>
              )}

              {/* Bank transfer: bank + account fields */}
              {transferType === "bank" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="bankSearch">Search Bank</Label>
                    <Input
                      id="bankSearch"
                      value={bankSearch}
                      onChange={(e) => setBankSearch(e.target.value)}
                      placeholder="Search by name or code..."
                    />
                  </div>
                  {bankSearch && (
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border">
                      {filteredBanks.map((b) => (
                        <button
                          key={b.code}
                          onClick={() => { setBankCode(b.code); setBankName(b.name); setBankSearch(b.name); }}
                          className={cn(
                            "w-full px-3 py-2 text-left text-sm hover:bg-accent",
                            bankCode === b.code && "bg-accent font-medium"
                          )}
                        >
                          {b.name} ({b.code})
                        </button>
                      ))}
                      {filteredBanks.length === 0 && (
                        <p className="px-3 py-2 text-xs text-muted-foreground">No banks found</p>
                      )}
                    </div>
                  )}
                  {bankName && (
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{bankName}</span>
                      <button onClick={() => { setBankCode(""); setBankName(""); setBankSearch(""); }} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Change</button>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="accountNumber">Account Number</Label>
                    <Input
                      id="accountNumber"
                      value={accountNumber}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
                        setAccountNumber(val);
                        // Auto-detect bank from BIN when user types 3+ digits
                        if (val.length >= 3 && !bankCode) {
                          const detected = detectBankFromAccount(val);
                          if (detected) {
                            setBankCode(detected.code);
                            setBankName(detected.name);
                            setBankSearch(detected.name);
                          }
                        }
                      }}
                      placeholder="10-digit account number"
                      inputMode="numeric"
                    />
                    {accountNumber.length === 10 && bankCode && (
                      <p className="text-xs text-muted-foreground">
                        {resolving ? (
                          <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Resolving account name...</span>
                        ) : resolved ? (
                          <span className="text-green-600 dark:text-green-400">Account verified</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">Could not verify account</span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="recipientName">Recipient Name</Label>
                    <Input
                      id="recipientName"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder={resolving ? "Resolving..." : "Account holder name"}
                      readOnly={resolving}
                    />
                  </div>
                </>
              )}

              {/* Beneficiaries (Turbopay only) */}
              {transferType === "turbopay" && data && data.beneficiaries.length > 0 && (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> Saved beneficiaries
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {data.beneficiaries.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => { setRecipient(b.accountNumber); setRecipientName(b.name); }}
                        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                          {b.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                        </span>
                        {b.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Amount */}
              <div className="space-y-1.5">
                <Label htmlFor="amount">Amount (₦)</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">₦</span>
                  <Input
                    id="amount"
                    inputMode="numeric"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="0.00"
                    className="pl-8 text-lg font-medium tabular-nums"
                  />
                </div>
                {insufficient && (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    Insufficient funds
                  </p>
                )}
              </div>

              {/* Note */}
              <div className="space-y-1.5">
                <Label htmlFor="note">Note (optional)</Label>
                <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's this for?" rows={2} maxLength={100} />
              </div>

              {/* Save beneficiary (Turbopay only) */}
              {transferType === "turbopay" && (
                <div className="flex items-center space-x-2">
                  <Checkbox id="save" checked={saveBen} onCheckedChange={(v) => setSaveBen(v === true)} />
                  <Label htmlFor="save" className="text-sm font-normal cursor-pointer">Save recipient as beneficiary</Label>
                </div>
              )}

              {/* Submit */}
              <Button className="w-full" size="lg" onClick={openConfirm} disabled={submitting || !(transferType === "turbopay" ? recipient : accountNumber) || !amount}>
                {submitting ? "Sending…" : "Continue"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {/* Beneficiaries (Turbopay only) */}
          {transferType === "turbopay" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4" /> Beneficiaries
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoading || !data ? (
                  <Skeleton className="h-8 w-full" />
                ) : data.beneficiaries.length > 0 ? (
                  <div className="max-h-64 space-y-1.5 overflow-y-auto">
                    {data.beneficiaries.map((b) => (
                      <div key={b.id} className="flex items-center gap-2 rounded-lg border p-2 transition-colors hover:bg-accent">
                        <button
                          onClick={() => { setRecipient(b.accountNumber); setRecipientName(b.name); }}
                          className="flex flex-1 items-center gap-2 text-left"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {b.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium">{b.name}</p>
                            <p className="truncate text-[10px] text-muted-foreground">{b.accountNumber}</p>
                          </div>
                        </button>
                        <button onClick={() => toggleFavorite(b.id)} className="shrink-0 rounded p-1 text-muted-foreground hover:text-amber-500" title="Toggle favorite">
                          <Star className={cn("h-3.5 w-3.5", favorites.has(b.id) && "fill-amber-400 text-amber-400")} />
                        </button>
                        <button onClick={() => removeBeneficiary(b.id)} className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive" title="Remove">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-4 text-center">
                    <Users className="mx-auto h-8 w-8 text-muted-foreground/50" />
                    <p className="mt-2 text-xs text-muted-foreground">No saved beneficiaries yet.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Transfer summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Transfer summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <Row label="Type" value={transferType === "turbopay" ? "Turbopay" : transferType === "international" ? "International" : "Bank Transfer"} />
              <Row label="Amount" value={amount ? formatNaira(amountKobo) : "—"} />
              <Row label="Fee" value={transferType === "turbopay" ? formatNaira(0) : fee ? formatNaira(fee.feeKobo) : "Computing…"} />
              <Separator />
              <Row label="Total debit" value={amount ? formatNaira(transferType === "turbopay" ? amountKobo : (fee?.totalDebitKobo ?? amountKobo)) : "—"} bold />
              <p className="pt-1 text-xs text-muted-foreground">
                {transferType === "turbopay"
                  ? "Internal Turbopay transfers are free and instant."
                  : transferType === "international"
                    ? "International transfers use competitive exchange rates."
                    : "External bank transfers may take 1-24 hours."}
              </p>
            </CardContent>
          </Card>

          {/* KYC limit */}
          {user && user.kycTier < 3 && (
            <Card className="bg-primary/5">
              <CardContent className="py-4">
                <p className="text-sm font-medium">Tier {user.kycTier} limit</p>
                <p className="mt-1 text-xs text-muted-foreground">Single transfer limit applies. Upgrade KYC for higher limits.</p>
                <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setView("kyc")}>
                  Upgrade KYC <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Confirm transfer</DialogTitle>
            <DialogDescription>Review the details before entering your PIN.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-lg border p-4 text-sm">
            <Row label="Type" value={transferType === "turbopay" ? "Turbopay" : "Bank Transfer"} />
            <Row label="Recipient" value={recipientName || recipient || accountNumber} />
            <Row label="Amount" value={formatNaira(amountKobo)} bold />
            <Row label="Fee" value={transferType === "turbopay" ? formatNaira(0) : "Varies"} />
            <Separator />
            <Row label="Total debit" value={formatNaira(amountKobo)} bold />
            {note && <Row label="Note" value={note} />}
            {data && <Row label="New balance" value={formatNaira(data.wallet.balanceKobo - amountKobo)} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Processing…" : "Enter PIN to confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, mono, bold }: { label: string; value: string; mono?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm ${bold ? "font-semibold" : "font-medium"} ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}
