"use client";

import * as React from "react";
import { Link2, Plus, Copy, Check, ExternalLink, Pause, Play, BarChart3 } from "lucide-react";
import { useApi, apiPost, mutateApi } from "@/lib/turbopay/client";
import { formatNaira } from "@/lib/turbopay/money";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

interface PaymentLink {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  amountKobo: number;
  currency: string;
  allowCustomAmount: boolean;
  maxUses: number | null;
  useCount: number;
  status: string;
  url: string;
  createdAt: string;
}

export function PaymentLinksView() {
  const { data, isLoading, refetch } = useApi<{ data: PaymentLink[] }>("/api/payment-links");
  const [showCreate, setShowCreate] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);

  const links = data?.data ?? [];

  const copyLink = (url: string, ref: string) => {
    navigator.clipboard.writeText(url);
    setCopied(ref);
    toast.success("Payment link copied!");
    setTimeout(() => setCopied(null), 2000);
  };

  const toggleStatus = async (id: string) => {
    try {
      await apiPost(`/api/payment-links/${id}`, {});
      mutateApi("/api/payment-links");
      toast.success("Status updated");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payment Links"
        description="Create shareable payment links for your customers."
        icon={<Link2 className="h-5 w-5" />}
        actions={<Button size="sm" onClick={() => setShowCreate(true)}><Plus className="mr-1.5 h-4 w-4" /> New Link</Button>}
      />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : links.length === 0 ? (
        <EmptyState
          icon={<Link2 className="h-5 w-5" />}
          title="No payment links yet"
          description="Create a payment link to share with your customers."
          action={<Button size="sm" onClick={() => setShowCreate(true)}><Plus className="mr-1.5 h-4 w-4" /> Create your first link</Button>}
        />
      ) : (
        <div className="space-y-3">
          {links.map((link) => (
            <Card key={link.id}>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Link2 className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{link.title}</p>
                    <Badge variant={link.status === "ACTIVE" ? "default" : "secondary"} className="text-[10px]">
                      {link.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {link.amountKobo > 0 ? formatNaira(link.amountKobo) : "Custom amount"} · {link.useCount} payments
                    {link.maxUses && <> / {link.maxUses} max</>}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => copyLink(link.url, link.reference)}>
                    {copied === link.reference ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => window.open(link.url, "_blank")}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleStatus(link.id)}>
                    {link.status === "ACTIVE" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateLinkDialog open={showCreate} onOpenChange={setShowCreate} onCreated={() => { setShowCreate(false); refetch(); }} />
    </div>
  );
}

function CreateLinkDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [title, setTitle] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [customAmount, setCustomAmount] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return toast.error("Title is required");
    setLoading(true);
    try {
      await apiPost("/api/payment-links", {
        title: title.trim(),
        amountNaira: customAmount ? 0 : Number(amount) || 0,
        allowCustomAmount: customAmount,
      });
      toast.success("Payment link created!");
      onCreated();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to create link");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Payment Link</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Payment for Invoice #123" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="custom" checked={customAmount} onChange={(e) => setCustomAmount(e.target.checked)} className="rounded" />
            <Label htmlFor="custom" className="text-sm">Allow customer to enter amount</Label>
          </div>
          {!customAmount && (
            <div className="space-y-1.5">
              <Label>Amount (₦)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? "Creating..." : "Create Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
