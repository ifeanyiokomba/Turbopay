"use client";

import * as React from "react";
import { toast } from "sonner";
import { Star, Plus, Trash2, Check, X, Eye, EyeOff } from "lucide-react";
import { useApi, apiFetch, mutateApi } from "@/lib/turbopay/client";
import { PageHeader } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface Testimonial {
  id: string;
  name: string;
  role: string;
  location: string | null;
  quote: string;
  rating: number;
  avatarUrl: string | null;
  approved: boolean;
  display: boolean;
  sortOrder: number;
  createdAt: string;
}

/**
 * Admin — Testimonials Management.
 *
 * Create, approve, hide, edit, and delete testimonials shown on the landing
 * page. Only approved + visible testimonials appear publicly.
 */
export function TestimonialsManagement() {
  const { data: testimonials, isLoading } = useApi<Testimonial[]>("/api/admin/testimonials");
  const [showCreate, setShowCreate] = React.useState(false);

  const toggleApprove = async (t: Testimonial) => {
    try {
      await apiFetch(`/api/admin/testimonials/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ approved: !t.approved }),
      });
      toast.success(t.approved ? "Testimonial hidden from public" : "Testimonial approved");
      mutateApi("/api/admin/testimonials");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not update");
    }
  };

  const toggleDisplay = async (t: Testimonial) => {
    try {
      await apiFetch(`/api/admin/testimonials/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ display: !t.display }),
      });
      toast.success(t.display ? "Testimonial hidden" : "Testimonial shown");
      mutateApi("/api/admin/testimonials");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not update");
    }
  };

  const remove = async (t: Testimonial) => {
    if (!confirm(`Delete testimonial from ${t.name}?`)) return;
    try {
      await apiFetch(`/api/admin/testimonials/${t.id}`, { method: "DELETE" });
      toast.success("Testimonial deleted");
      mutateApi("/api/admin/testimonials");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not delete");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Testimonials" description="Manage customer testimonials shown on the landing page." icon={<Star className="h-5 w-5" />} />

      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)}><Plus className="mr-1 h-4 w-4" /> Add testimonial</Button>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : testimonials && testimonials.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {testimonials.map((t) => (
            <Card key={t.id} className={!t.approved || !t.display ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {t.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{t.role}{t.location ? ` · ${t.location}` : ""}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-0.5">
                      {Array.from({ length: t.rating }).map((_, j) => (
                        <Star key={j} className="h-3 w-3 fill-amber-400 text-amber-400" />
                      ))}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground italic">"{t.quote}"</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {t.approved ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600"><Check className="mr-0.5 h-3 w-3" /> Approved</Badge>
                      ) : (
                        <Badge variant="outline"><X className="mr-0.5 h-3 w-3" /> Pending</Badge>
                      )}
                      {t.display ? (
                        <Badge variant="outline"><Eye className="mr-0.5 h-3 w-3" /> Visible</Badge>
                      ) : (
                        <Badge variant="outline"><EyeOff className="mr-0.5 h-3 w-3" /> Hidden</Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggleApprove(t)}>
                    {t.approved ? "Unapprove" : "Approve"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toggleDisplay(t)}>
                    {t.display ? "Hide" : "Show"}
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => remove(t)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="py-8 text-center text-sm text-muted-foreground">No testimonials yet. Click "Add testimonial" to create one.</div>
      )}

      <CreateTestimonialDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}

function CreateTestimonialDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [quote, setQuote] = React.useState("");
  const [rating, setRating] = React.useState(5);
  const [loading, setLoading] = React.useState(false);

  const create = async () => {
    if (!name.trim() || !role.trim() || quote.trim().length < 10) {
      toast.error("Name, role, and a quote (10+ chars) are required");
      return;
    }
    setLoading(true);
    try {
      await apiFetch("/api/admin/testimonials", {
        method: "POST",
        body: JSON.stringify({ name, role, location: location || undefined, quote, rating, approved: true, display: true }),
      });
      toast.success("Testimonial created + approved");
      mutateApi("/api/admin/testimonials");
      onOpenChange(false);
      setName(""); setRole(""); setLocation(""); setQuote(""); setRating(5);
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not create testimonial");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add testimonial</DialogTitle>
          <DialogDescription>Create a new customer testimonial. It will be approved + visible by default.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Adaeze Okafor" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Small business owner" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Location (optional)</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lagos" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Quote</Label>
            <Textarea value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="Turbopay has transformed…" rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Rating</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((r) => (
                <button key={r} type="button" onClick={() => setRating(r)}>
                  <Star className={`h-6 w-6 ${r <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                </button>
              ))}
            </div>
          </div>
          <Button className="w-full" onClick={create} disabled={loading}>
            {loading ? "Creating…" : "Create + approve"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
