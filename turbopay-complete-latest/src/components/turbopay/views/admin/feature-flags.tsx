"use client";

import * as React from "react";
import { Flag, Save } from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";

interface FlagOverride { id: string; userId: string; enabled: boolean; }
interface FeatureFlagRow {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  rollout: number;
  product: string | null;
  overrides: FlagOverride[];
  updatedAt: string;
}

export function FeatureFlagsView() {
  const { data, isLoading, error } = useApi<FeatureFlagRow[]>("/api/admin/feature-flags");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Feature Flags"
        description="Toggle platform features and control percentage rollouts. Per-user overrides are listed inline."
        icon={<Flag className="h-5 w-5" />}
      />

      {error ? (
        <Card><CardContent className="p-6 text-sm text-destructive">{(error as Error).message}</CardContent></Card>
      ) : isLoading || !data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 w-full" />)}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState icon={<Flag className="h-6 w-6" />} title="No feature flags" description="Add a flag via the API to get started." />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((f) => <FlagCard key={f.id} flag={f} />)}
        </div>
      )}
    </div>
  );
}

function FlagCard({ flag }: { flag: FeatureFlagRow }) {
  const [rollout, setRollout] = React.useState(flag.rollout);
  const [busy, setBusy] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);

  React.useEffect(() => { setRollout(flag.rollout); }, [flag.rollout]);

  async function toggle(next: boolean) {
    setToggling(true);
    try {
      await apiFetch("/api/admin/feature-flags", {
        method: "POST",
        body: JSON.stringify({ key: flag.key, enabled: next }),
      });
      toast.success(`${flag.key} ${next ? "enabled" : "disabled"}`);
      mutateApi("/api/admin/feature-flags");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not toggle flag");
    } finally {
      setToggling(false);
    }
  }

  async function saveRollout() {
    setBusy(true);
    try {
      await apiFetch("/api/admin/feature-flags", {
        method: "POST",
        body: JSON.stringify({ key: flag.key, rollout }),
      });
      toast.success(`${flag.key} rollout set to ${rollout}%`);
      mutateApi("/api/admin/feature-flags");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not update rollout");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flag className="h-4 w-4" /> <code className="font-mono text-sm">{flag.key}</code>
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {flag.description ?? "No description"}
              {flag.product && <span className="ml-1">· {flag.product}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-[10px]", flag.enabled ? "text-success" : "text-muted-foreground")}>
              {flag.enabled ? "On" : "Off"}
            </Badge>
            <Switch checked={flag.enabled} disabled={toggling} onCheckedChange={toggle} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <Label className="text-xs">Rollout percentage</Label>
            <span className="tabular-nums text-muted-foreground">{rollout}%</span>
          </div>
          <Slider
            value={[rollout]}
            min={0}
            max={100}
            step={5}
            onValueChange={(v) => setRollout(v[0] ?? 0)}
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">Deterministic SHA-256 bucketing per user.</p>
            <Button size="sm" variant="outline" onClick={saveRollout} disabled={busy || rollout === flag.rollout}>
              <Save className="mr-1 h-3 w-3" /> {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {flag.overrides.length > 0 && (
          <div className="rounded-md border p-2">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {flag.overrides.length} per-user override{flag.overrides.length > 1 ? "s" : ""}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {flag.overrides.slice(0, 8).map((o) => (
                <Badge key={o.id} variant="outline" className={cn("text-[10px]", o.enabled ? "text-success" : "text-destructive")}>
                  {o.userId.slice(-6)}: {o.enabled ? "on" : "off"}
                </Badge>
              ))}
              {flag.overrides.length > 8 && (
                <Badge variant="outline" className="text-[10px]">+{flag.overrides.length - 8}</Badge>
              )}
            </div>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">Updated {new Date(flag.updatedAt).toLocaleString("en-NG")}</p>
      </CardContent>
    </Card>
  );
}
