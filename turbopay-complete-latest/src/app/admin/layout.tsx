"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AdminSidebar } from "@/components/admin";

const PUBLIC_ROUTES = ["/admin/login", "/admin/forgot-password", "/admin/reset-password"];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  useEffect(() => {
    if (isPublicRoute) {
      setLoading(false);
      return;
    }

    fetch("/api/admin/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (!data.user) {
          router.push("/admin/login");
        } else {
          setUser(data.user);
          setLoading(false);
        }
      })
      .catch(() => router.push("/admin/login"));
  }, [pathname, router, isPublicRoute]);

  if (isPublicRoute) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar user={user} />
      <main className="flex-1 overflow-auto">
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
