"use client";

import * as React from "react";
import { toast } from "sonner";
import { Users, Plus, Trash2, UserPlus, Send } from "lucide-react";
import { useApi, apiPost, apiFetch, mutateApi } from "@/lib/turbopay/client";
import { useApp } from "@/components/turbopay/store";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface Beneficiary { id: string; name: string; accountNumber: string; bankName: string; bankCode: string; type: string }

export function BeneficiariesView() {
  const { data, isLoading, refetch } = useApi<Beneficiary[]>("/api/beneficiaries");
  const setView = useApp((s) => s.setView);
  const [addOpen, setAddOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [acct, setAcct] = React.useState("");
  const [bank, setBank] = React.useState("Turbopay MFB");
  const [loading, setLoading] = React.useState(false);

  const add = async () => {
    if (!name || !acct) return toast.error("Enter name and account number");
    setLoading(true);
    try {
      await apiPost("/api/beneficiaries", { name, accountNumber: acct, bankName: bank, bankCode: "999001", type: "TURBOPAY" });
      toast.success("Beneficiary saved");
      setName(""); setAcct(""); setAddOpen(false);
      refetch();
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Could not save");
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await apiFetch(`/api/beneficiaries?id=${id}`, { method: "DELETE" });
      toast.success("Beneficiary removed");
      refetch();
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Could not remove");
    }
  };

  const items = data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Beneficiaries"
        description="People you send money to often."
        icon={<Users className="h-5 w-5" />}
        actions={<Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Add beneficiary</Button>}
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : items.length === 0 ? (
        <Card><CardContent><EmptyState icon={<Users className="h-6 w-6" />} title="No beneficiaries yet" description="Save frequent recipients to send money in one tap." action={<Button onClick={() => setAddOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Add beneficiary</Button>} /></CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((b) => (
            <Card key={b.id}>
              <CardContent className="flex items-center gap-3 py-4">
                <Avatar className="h-11 w-11 border">
                  <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                    {b.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{b.name}</p>
                  <p className="truncate text-xs text-muted-foreground tabular-nums">{b.accountNumber}</p>
                  <p className="text-xs text-muted-foreground">{b.bankName}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setView("transfer")}><Send className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => remove(b.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle><UserPlus className="mr-2 inline h-5 w-5" /> Add beneficiary</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bname">Name</Label>
              <Input id="bname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Chidi Nwosu" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bacct">Account number</Label>
              <Input id="bacct" value={acct} onChange={(e) => setAcct(e.target.value.replace(/[^0-9]/g, ""))} placeholder="8098765432" className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bbank">Bank</Label>
              <Input id="bbank" value={bank} onChange={(e) => setBank(e.target.value)} />
            </div>
            <Badge variant="secondary" className="text-xs">Turbopay internal recipient</Badge>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={add} disabled={loading}>{loading ? "Saving…" : "Save beneficiary"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
