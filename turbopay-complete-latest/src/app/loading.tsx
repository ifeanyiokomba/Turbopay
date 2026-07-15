import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading skeleton — shown while a route segment is loading.
 * Provides a branded, non-janky loading state instead of a blank page.
 */
export default function Loading() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}
