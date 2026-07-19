"use client";

import * as React from "react";
import {
  Shield, Lock, KeyRound, Eye, Server, UserCheck, Activity, Cloud,
  CheckCircle, ExternalLink, ChevronRight, Info, Award
} from "lucide-react";
import { useApi } from "@/lib/turbopay/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ─── Icon Map ───────────────────────────────────────────────

const ICON_MAP: Record<string, React.ReactNode> = {
  Shield: <Shield className="h-5 w-5" />,
  Lock: <Lock className="h-5 w-5" />,
  KeyRound: <KeyRound className="h-5 w-5" />,
  Eye: <Eye className="h-5 w-5" />,
  Server: <Server className="h-5 w-5" />,
  UserCheck: <UserCheck className="h-5 w-5" />,
  Activity: <Activity className="h-5 w-5" />,
  Cloud: <Cloud className="h-5 w-5" />,
  Award: <Award className="h-5 w-5" />,
};

// ─── Types ──────────────────────────────────────────────────

interface TrustData {
  pciDssCompliant: boolean;
  pciDssCertificate: {
    name: string;
    verificationUrl: string | null;
    certificateNumber: string | null;
  } | null;
  pciDssFallback: string;
  certificates: Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    verificationUrl: string | null;
    certificateNumber: string | null;
    dateIssued: Date | null;
    expiryDate: Date | null;
  }>;
  badges: Array<{
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
  }>;
  logos: Array<{
    id: string;
    name: string;
    logoUrl: string | null;
    websiteUrl: string | null;
    category: string | null;
  }>;
  messages: Array<{
    id: string;
    title: string;
    message: string;
    type: string;
  }>;
}

// ─── Trust Section Component ────────────────────────────────

export function TrustSection() {
  const { data, isLoading } = useApi<TrustData>("/api/trust/homepage");

  if (isLoading) return <TrustSectionSkeleton />;
  if (!data) return null;

  return (
    <section className="py-16 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="text-center mb-12">
          <Badge variant="secondary" className="mb-4">
            <Shield className="mr-1.5 h-3 w-3" /> Trust & Security
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Trusted & Secure
          </h2>
          <p className="mt-3 text-lg text-muted-foreground max-w-2xl mx-auto">
            Your security is our top priority. We use industry-leading measures to protect your money and data.
          </p>
        </div>

        {/* Security Badges Grid */}
        {data.badges.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 mb-12">
            {data.badges.map((badge) => (
              <SecurityBadgeCard key={badge.id} badge={badge} />
            ))}
          </div>
        )}

        {/* PCI DSS + Compliance Certificates */}
        <div className="grid gap-6 lg:grid-cols-3 mb-12">
          {/* PCI DSS Card */}
          <Card className="lg:col-span-1">
            <CardContent className="pt-6">
              {data.pciDssCompliant && data.pciDssCertificate ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-success/10">
                      <CheckCircle className="h-6 w-6 text-success" />
                    </div>
                    <div>
                      <p className="font-semibold">PCI DSS Compliant</p>
                      <p className="text-xs text-muted-foreground">Verified & Active</p>
                    </div>
                  </div>
                  {data.pciDssCertificate.certificateNumber && (
                    <p className="text-xs text-muted-foreground">
                      Certificate: {data.pciDssCertificate.certificateNumber}
                    </p>
                  )}
                  {data.pciDssCertificate.verificationUrl && (
                    <a
                      href={data.pciDssCertificate.verificationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Verify certificate <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                      <Info className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-semibold">Secure Payments</p>
                      <p className="text-xs text-muted-foreground">PCI DSS Partners</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{data.pciDssFallback}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Compliance Certificates */}
          {data.certificates.length > 0 && (
            <Card className="lg:col-span-2">
              <CardContent className="pt-6">
                <p className="text-sm font-semibold mb-4">Compliance & Certifications</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.certificates.map((cert) => (
                    <div
                      key={cert.id}
                      className="flex items-start gap-3 rounded-lg border p-3"
                    >
                      <CheckCircle className="h-4 w-4 mt-0.5 text-success shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{cert.name}</p>
                        {cert.description && (
                          <p className="text-xs text-muted-foreground truncate">{cert.description}</p>
                        )}
                        {cert.verificationUrl && (
                          <a
                            href={cert.verificationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline mt-1"
                          >
                            Verify <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Trust Messages */}
        {data.messages.length > 0 && (
          <div className="space-y-3 mb-12">
            {data.messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-4",
                  msg.type === "info" && "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
                  msg.type === "warning" && "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
                  msg.type === "success" && "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                )}
              >
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                <div>
                  <p className="text-sm font-medium">{msg.title}</p>
                  <p className="text-sm text-muted-foreground">{msg.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Supported Payment Networks */}
        {data.logos.length > 0 && (
          <div className="text-center">
            <p className="text-sm font-semibold mb-6 text-muted-foreground">
              Supported Payment Networks
            </p>
            <div className="flex flex-wrap justify-center gap-6">
              {data.logos.map((logo) => (
                <div
                  key={logo.id}
                  className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-2"
                >
                  {logo.logoUrl ? (
                    <img src={logo.logoUrl} alt={logo.name} className="h-5 w-auto" />
                  ) : (
                    <div className="h-5 w-5 rounded bg-muted" />
                  )}
                  <span className="text-sm font-medium text-muted-foreground">{logo.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Security Badge Card ────────────────────────────────────

function SecurityBadgeCard({ badge }: { badge: TrustData["badges"][0] }) {
  const icon = badge.icon ? ICON_MAP[badge.icon] ?? <Shield className="h-5 w-5" /> : <Shield className="h-5 w-5" />;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Card className="group cursor-pointer transition-all hover:shadow-md hover:border-primary/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                {icon}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{badge.name}</p>
                {badge.description && (
                  <p className="text-[11px] text-muted-foreground truncate">{badge.description}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {icon}
            {badge.name}
          </DialogTitle>
          <DialogDescription>
            {badge.description || "Security feature details"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This security measure helps protect your account and transactions on TurboPay.
          </p>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-success" />
            <span>Active and protecting your account</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Skeleton ───────────────────────────────────────────────

function TrustSectionSkeleton() {
  return (
    <section className="py-16 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="text-center mb-12">
          <Skeleton className="h-6 w-32 mx-auto mb-4" />
          <Skeleton className="h-10 w-64 mx-auto mb-3" />
          <Skeleton className="h-5 w-96 mx-auto" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 mb-12">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-3 mb-12">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl lg:col-span-2" />
        </div>
        <div className="flex flex-wrap justify-center gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-28 rounded-lg" />
          ))}
        </div>
      </div>
    </section>
  );
}
