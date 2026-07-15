"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, StatusBadge, StatCard, DataTable, type Column } from "@/components/admin";

interface MarkupRule {
  id: string;
  name: string;
  provider?: string;
  operation?: string;
  country?: string;
  currency?: string;
  markup_type: string;
  markup_value: number;
  flat_amount?: number;
  is_active: boolean;
  priority: number;
}

export default function MarkupPage() {
  const [rules, setRules] = useState<MarkupRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newRule, setNewRule] = useState({
    name: "",
    markup_type: "percentage",
    markup_value: 0.5,
    flat_amount: 0,
    priority: 0
  });

  useEffect(() => {
    fetch("/api/v1/admin/markup/rules")
      .then(r => r.json())
      .then(data => { setRules(data.rules || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    const res = await fetch("/api/v1/admin/markup/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newRule)
    });
    const data = await res.json();
    if (data.rule) {
      setRules([...rules, data.rule]);
      setShowCreate(false);
      setNewRule({ name: "", markup_type: "percentage", markup_value: 0.5, flat_amount: 0, priority: 0 });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this rule?")) return;
    await fetch(`/api/v1/admin/markup/rules/${id}`, { method: "DELETE" });
    setRules(rules.filter(r => r.id !== id));
  };

  const columns: Column<MarkupRule>[] = [
    { key: "name", header: "Name", sortable: true },
    { key: "markup_type", header: "Type", render: (r) => <span className="capitalize">{r.markup_type}</span> },
    {
      key: "markup_value",
      header: "Value",
      sortable: true,
      render: (r) => <span className="text-success font-medium">{r.markup_value}%</span>,
    },
    { key: "provider", header: "Provider", render: (r) => r.provider || "All" },
    { key: "operation", header: "Operation", render: (r) => r.operation || "All" },
    { key: "priority", header: "Priority", sortable: true },
    {
      key: "is_active",
      header: "Status",
      render: (r) => (
        <StatusBadge variant={r.is_active ? "success" : "muted"} dot={false}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusBadge>
      ),
    },
    {
      key: "id",
      header: "Actions",
      render: (r) => (
        <Button variant="ghost" size="sm" onClick={() => handleDelete(r.id)} className="text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Markup Configuration"
        description="Set platform fees added to provider charges"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Rule
          </Button>
        }
      />

      {/* Info Card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <p className="text-sm">
            <strong>How TurboPay makes money:</strong> Set a percentage markup added to provider fees.
            If Paystack charges 1.5% and you set 0.5% markup, the customer pays 2.0% total.
          </p>
        </CardContent>
      </Card>

      {/* Default Markup Display */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Default Global" value="0.5%" />
        <StatCard title="International" value="1.0%" />
        <StatCard title="Bulk Payments" value="0.3%" />
      </div>

      {/* Create Rule Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Markup Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Rule Name</Label>
              <Input
                value={newRule.name}
                onChange={e => setNewRule({ ...newRule, name: e.target.value })}
                placeholder="e.g., Ghana Mobile Money Markup"
              />
            </div>
            <div>
              <Label>Markup Type</Label>
              <Select value={newRule.markup_type} onValueChange={(v) => setNewRule({ ...newRule, markup_type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="flat">Flat Amount</SelectItem>
                  <SelectItem value="hybrid">Hybrid (Percentage + Flat)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Markup Value (%)</Label>
              <Input
                type="number"
                step="0.1"
                value={newRule.markup_value}
                onChange={e => setNewRule({ ...newRule, markup_value: parseFloat(e.target.value) })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rules Table */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rules}
          searchable
          searchPlaceholder="Search rules..."
          searchKeys={["name", "provider"]}
          emptyMessage="No markup rules configured"
          keyExtractor={(r) => r.id}
        />
      )}
    </div>
  );
}
