"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { PageHeader, StatusBadge, statusVariant, DataTable, type Column } from "@/components/admin";

interface Customer {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  kycTier: number;
  status: string;
  createdAt: string;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/customers")
      .then(r => r.json())
      .then(data => { setCustomers(data.customers || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const columns: Column<Customer>[] = [
    {
      key: "fullName",
      header: "Name",
      sortable: true,
      render: (c) => (
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
            <User className="h-3.5 w-3.5" />
          </div>
          <span className="font-medium">{c.fullName || "N/A"}</span>
        </div>
      ),
    },
    { key: "email", header: "Email", sortable: true },
    {
      key: "phone",
      header: "Phone",
      render: (c) => c.phone || "N/A",
    },
    {
      key: "kycTier",
      header: "KYC Tier",
      sortable: true,
      render: (c) => <span>Tier {c.kycTier || 1}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (c) => (
        <StatusBadge variant={statusVariant(c.status)} dot={false}>
          {c.status}
        </StatusBadge>
      ),
    },
    {
      key: "createdAt",
      header: "Joined",
      sortable: true,
      render: (c) => (
        <span className="text-muted-foreground">
          {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "N/A"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description={`${customers.length} registered users`}
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={customers}
          searchable
          searchPlaceholder="Search by name, email, or phone..."
          searchKeys={["fullName", "email", "phone"]}
          keyExtractor={(c) => c.id}
        />
      )}
    </div>
  );
}
