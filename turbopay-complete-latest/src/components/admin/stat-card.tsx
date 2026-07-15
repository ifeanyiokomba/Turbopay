"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: React.ReactNode;
  trend?: { value: number; label?: string } | null;
  className?: string;
}

export function StatCard({ title, value, description, icon, trend, className }: StatCardProps) {
  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {icon && (
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              {icon}
            </div>
          )}
        </div>
        {trend && (
          <div className="mt-3 flex items-center gap-1 text-xs">
            {trend.value > 0 ? (
              <TrendingUp className="h-3 w-3 text-success" />
            ) : trend.value < 0 ? (
              <TrendingDown className="h-3 w-3 text-destructive" />
            ) : (
              <Minus className="h-3 w-3 text-muted-foreground" />
            )}
            <span
              className={cn(
                "font-medium",
                trend.value > 0 && "text-success",
                trend.value < 0 && "text-destructive",
                trend.value === 0 && "text-muted-foreground",
              )}
            >
              {Math.abs(trend.value)}%
            </span>
            {trend.label && (
              <span className="text-muted-foreground">{trend.label}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
