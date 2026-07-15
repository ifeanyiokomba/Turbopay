"use client";

import * as React from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/turbopay/client";

/**
 * Transaction PIN dialog — used by every debit flow (transfer, airtime, data,
 * bills) before submitting. Wraps the input-otp 4-slot entry + server verify.
 *
 * Usage:
 *   const pin = await PinDialog.request(); // returns pin string or null
 */
interface PinDialogHandle {
  request: () => Promise<string | null>;
}

const PinDialogContext = React.createContext<PinDialogHandle | null>(null);

export function PinDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [verifying, setVerifying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const resolveRef = React.useRef<((v: string | null) => void) | null>(null);

  const request = React.useCallback(() => {
    setPin("");
    setError(null);
    setOpen(true);
    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const close = (value: string | null) => {
    setOpen(false);
    resolveRef.current?.(value);
    resolveRef.current = null;
  };

  const verify = async () => {
    if (pin.length !== 4) return;
    setVerifying(true);
    setError(null);
    try {
      await apiPost("/api/auth/set-pin", { pin: pin, _method: "PUT" }); // not used; verify below
    } catch {
      /* fall through to actual verify */
    }
    try {
      // Use fetch directly to send PUT.
      const res = await fetch("/api/auth/set-pin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Incorrect PIN");
        setPin("");
        setVerifying(false);
        return;
      }
      close(pin);
    } catch {
      setError("Could not verify PIN");
      setPin("");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <PinDialogContext.Provider value={{ request }}>
      {children}
      <Dialog open={open} onOpenChange={(o) => !o && close(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <ShieldCheck className="h-6 w-6 text-primary" />
            </div>
            <DialogTitle className="text-center">Enter transaction PIN</DialogTitle>
            <DialogDescription className="text-center">
              Confirm this transaction with your 4-digit PIN.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            <InputOTP maxLength={4} value={pin} onChange={(v) => { setPin(v); setError(null); }} onComplete={verify}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
              </InputOTPGroup>
            </InputOTP>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" onClick={verify} disabled={verifying || pin.length !== 4}>
              {verifying ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Verifying…</> : "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PinDialogContext.Provider>
  );
}

export function usePinDialog(): PinDialogHandle {
  const ctx = React.useContext(PinDialogContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider (shouldn't happen
    // in normal use) — return a no-op that resolves null.
    return { request: () => Promise.resolve(null) };
  }
  return ctx;
}
