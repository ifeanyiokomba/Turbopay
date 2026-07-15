"use client";

import * as React from "react";
import { BookOpen, Plus, Pencil, Trash2, Save, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";

interface HelpArticleRow {
  id: string;
  title: string;
  slug: string;
  content: string;
  category: string;
  tags: string | null;
  status: string; // DRAFT | PUBLISHED | UNPUBLISHED
  version: number;
  views: number;
  helpfulCount: number;
  unhelpfulCount: number;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

const KB_CATEGORIES = [
  "GETTING_STARTED", "REGISTRATION", "LOGIN", "RECOVERY", "WALLET", "TRANSFERS",
  "BILLS", "KYC", "SAVINGS", "INVESTMENTS", "CARDS", "INTERNATIONAL", "SECURITY", "FAQ",
] as const;

const STATUS_TONE: Record<string, string> = {
  PUBLISHED: "bg-success/15 text-success",
  DRAFT: "bg-muted text-muted-foreground",
  UNPUBLISHED: "bg-warning/15 text-warning-foreground",
};

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function KnowledgeBaseAdminView() {
  const { data, isLoading, error } = useApi<HelpArticleRow[]>("/api/admin/support/knowledge-base");
  const [editing, setEditing] = React.useState<HelpArticleRow | "new" | null>(null);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Knowledge Base"
        description="Author, edit, and publish self-service help articles shown in the Support FAQ."
        icon={<BookOpen className="h-5 w-5" />}
        actions={<Button onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" /> New article</Button>}
      />

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
          ) : isLoading || !data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : data.length === 0 ? (
            <EmptyState icon={<BookOpen className="h-6 w-6" />} title="No articles yet" description="Write your first help article." />
          ) : (
            <ScrollArea className="max-h-[600px]">
              <div className="divide-y">
                {data.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{a.title}</h3>
                        <Badge className={cn("text-[10px]", STATUS_TONE[a.status] ?? "")}>{a.status}</Badge>
                        <Badge variant="outline" className="text-[10px]">{a.category.replace(/_/g, " ")}</Badge>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <code className="font-mono">/{a.slug}</code>
                        <span>· v{a.version}</span>
                        <span>· {a.views} views</span>
                        <span>· {a.helpfulCount}👍 {a.unhelpfulCount}👎</span>
                        <span>· updated {new Date(a.updatedAt).toLocaleDateString("en-NG")}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => togglePublish(a)}>
                        {a.status === "PUBLISHED" ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(a)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {editing && (
        <ArticleDialog
          article={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

async function togglePublish(a: HelpArticleRow) {
  const next = a.status === "PUBLISHED" ? "UNPUBLISHED" : "PUBLISHED";
  try {
    await apiFetch(`/api/admin/support/knowledge-base/${a.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    toast.success(`Article ${next === "PUBLISHED" ? "published" : "unpublished"}`);
    mutateApi("/api/admin/support/knowledge-base");
  } catch (e: any) {
    if (e?.status === 401) return;
    toast.error(e.message ?? "Update failed");
  }
}

async function remove(a: HelpArticleRow) {
  if (!confirm(`Delete "${a.title}"? This cannot be undone.`)) return;
  try {
    await apiFetch(`/api/admin/support/knowledge-base/${a.id}`, { method: "DELETE" });
    toast.success("Article deleted");
    mutateApi("/api/admin/support/knowledge-base");
  } catch (e: any) {
    if (e?.status === 401) return;
    toast.error(e.message ?? "Delete failed");
  }
}

function ArticleDialog({ article, onClose }: { article: HelpArticleRow | null; onClose: () => void }) {
  const [title, setTitle] = React.useState(article?.title ?? "");
  const [slug, setSlug] = React.useState(article?.slug ?? "");
  const [content, setContent] = React.useState(article?.content ?? "");
  const [category, setCategory] = React.useState<string>(article?.category ?? KB_CATEGORIES[0]);
  const [busy, setBusy] = React.useState(false);
  const [autoSlug, setAutoSlug] = React.useState(!article);

  React.useEffect(() => {
    if (autoSlug) setSlug(slugify(title));
  }, [title, autoSlug]);

  async function submit() {
    if (title.trim().length < 3) { toast.error("Title must be at least 3 chars"); return; }
    if (slug.trim().length < 3) { toast.error("Slug must be at least 3 chars"); return; }
    if (content.trim().length < 10) { toast.error("Content must be at least 10 chars"); return; }
    setBusy(true);
    try {
      if (article) {
        await apiFetch(`/api/admin/support/knowledge-base/${article.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: title.trim(), content: content.trim(), category }),
        });
        toast.success("Article updated");
      } else {
        await apiFetch("/api/admin/support/knowledge-base", {
          method: "POST",
          body: JSON.stringify({ title: title.trim(), slug: slug.trim(), content: content.trim(), category }),
        });
        toast.success("Article created");
      }
      mutateApi("/api/admin/support/knowledge-base");
      onClose();
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{article ? "Edit article" : "New help article"}</DialogTitle>
          <DialogDescription>
            {article
              ? `Editing /${article.slug} · v${article.version}`
              : "Published immediately. Use markdown for content."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="How to reset your PIN" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input
                value={slug}
                onChange={(e) => { setSlug(e.target.value); setAutoSlug(false); }}
                placeholder="how-to-reset-pin"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{KB_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Content (markdown)</Label>
            <Textarea rows={10} value={content} onChange={(e) => setContent(e.target.value)} placeholder="# Reset your PIN\n\n1. Open Settings → Security…" className="font-mono text-sm" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={busy}>
            <Save className="mr-1 h-3.5 w-3.5" /> {busy ? "Saving…" : "Save article"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
