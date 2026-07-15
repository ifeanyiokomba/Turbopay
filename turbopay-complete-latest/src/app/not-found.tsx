import Link from "next/link";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 404 Not Found page — branded Turbopay styling.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
        <span className="text-3xl font-bold text-muted-foreground">404</span>
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
      </div>
      <Button asChild>
        <Link href="/">
          <Home className="mr-2 h-4 w-4" /> Back to home
        </Link>
      </Button>
    </div>
  );
}
