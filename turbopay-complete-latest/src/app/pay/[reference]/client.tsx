"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, CreditCard, Building2, Smartphone, Shield, Loader2 } from "lucide-react";
import { apiPost } from "@/lib/turbopay/client";
import { formatNaira } from "@/lib/turbopay/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface Props {
  reference: string;
  title: string;
  description: string | null;
  amountKobo: number;
  currency: string;
  allowCustomAmount: boolean;
  minAmountKobo: number | null;
  maxAmountKobo: number | null;
  merchantName: string;
}

type PaymentMethod = "card" | "bank" | "mobile_money";

export function PaymentLinkClient({
  reference,
  title,
  description,
  amountKobo,
  currency,
  allowCustomAmount,
  minAmountKobo,
  maxAmountKobo,
  merchantName,
}: Props) {
  const [amount, setAmount] = React.useState(amountKobo > 0 ? (amountKobo / 100).toString() : "");
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("card");
  const [processing, setProcessing] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const [fee, setFee] = React.useState<number | null>(null);

  const amountNaira = Number(amount) || 0;
  const amountKoboVal = Math.round(amountNaira * 100);
  const isValid = amountNaira > 0 && email.includes("@");

  // Estimate fee when amount changes
  React.useEffect(() => {
    if (amountNaira < 50) { setFee(null); return; }
    apiPost<{ feeKobo: number }>("/api/transfer/fee", { amountNaira, type: "external" })
      .then((r) => setFee(r.feeKobo))
      .catch(() => setFee(null));
  }, [amountNaira]);

  const handlePay = async () => {
    if (!isValid || processing) return;
    setProcessing(true);
    try {
      const result = await apiPost<{ reference: string; authorizationUrl?: string }>(
        "/api/payment/link/initialize",
        {
          reference,
          amountNaira,
          email,
          name,
          method,
        }
      );

      if (result.authorizationUrl) {
        // Redirect to provider's payment page
        window.location.href = result.authorizationUrl;
      } else {
        setSuccess(true);
        toast.success("Payment successful!");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Payment failed");
    } finally {
      setProcessing(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-10">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/20">
              <Check className="h-8 w-8 text-success" />
            </div>
            <h2 className="mt-4 text-xl font-bold">Payment Successful</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Thank you for paying {formatNaira(amountKoboVal)} to {merchantName}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Reference: {reference}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <CreditCard className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-lg">{title}</CardTitle>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          <p className="text-xs text-muted-foreground">Pay to {merchantName}</p>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Amount */}
          <div className="space-y-1.5">
            <Label>Amount ({currency})</Label>
            {allowCustomAmount ? (
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Enter amount"
                min={minAmountKobo ? minAmountKobo / 100 : 0}
                max={maxAmountKobo ? maxAmountKobo / 100 : undefined}
              />
            ) : (
              <div className="rounded-lg border bg-muted/50 px-4 py-3 text-lg font-semibold">
                {formatNaira(amountKoboVal)}
              </div>
            )}
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
            />
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label>Name (optional)</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          {/* Payment method */}
          <div className="space-y-1.5">
            <Label>Payment Method</Label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: "card", icon: CreditCard, label: "Card" },
                { key: "bank", icon: Building2, label: "Bank" },
                { key: "mobile_money", icon: Smartphone, label: "Mobile" },
              ] as const).map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMethod(m.key)}
                  className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-xs transition-colors ${
                    method === m.key
                      ? "border-primary bg-primary/5 text-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  <m.icon className="h-5 w-5" />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Fee breakdown */}
          {fee !== null && amountNaira >= 50 && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <div className="flex justify-between">
                <span>Amount</span>
                <span>{formatNaira(amountKoboVal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Fee</span>
                <span>{formatNaira(fee)}</span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between font-semibold">
                <span>Total</span>
                <span>{formatNaira(amountKoboVal + fee)}</span>
              </div>
            </div>
          )}

          {/* Pay button */}
          <Button
            className="w-full"
            size="lg"
            onClick={handlePay}
            disabled={!isValid || processing}
          >
            {processing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Shield className="mr-2 h-4 w-4" />
            )}
            {processing ? "Processing..." : `Pay ${formatNaira(amountKoboVal)}`}
          </Button>

          <p className="text-center text-[10px] text-muted-foreground">
            Secured by TurboPay · Payments are encrypted end-to-end
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
