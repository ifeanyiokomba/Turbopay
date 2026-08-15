import * as React from "react";
import { cn } from "@/lib/utils";

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

/**
 * Turbopay brand mark — emerald emblem with an amber lightning-bolt "T"
 * and speed lines (turbo). Inline SVG so it adapts to theme/container.
 *
 * IMPORTANT: gradient IDs are unique per instance (via React.useId) to
 * prevent SVG <defs> collisions when multiple logos render on the same
 * page (desktop sidebar + mobile sheet + mobile header).
 */
export function Logo({ size = 40, className, ...props }: LogoProps) {
  const gradId = React.useId();
  const amberId = React.useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Turbopay logo"
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#16a37b" />
          <stop offset="0.55" stopColor="#0b7d5e" />
          <stop offset="1" stopColor="#06543f" />
        </linearGradient>
        <linearGradient id={amberId} x1="10" y1="14" x2="44" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fbbf24" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${gradId})`} />
      <rect x="2" y="2" width="60" height="60" rx="16" fill="black" fillOpacity="0.06" />
      <rect x="18" y="17" width="28" height="5.5" rx="2.75" fill="#ffffff" />
      <path
        d="M34.5 22.5 L26.5 39.5 L31.6 39.5 L27.5 49.5 L40 31.5 L34.2 31.5 L38.2 22.5 Z"
        fill={`url(#${amberId})`}
      />
      <rect x="9" y="26" width="6" height="3" rx="1.5" fill="#ffffff" fillOpacity="0.55" />
      <rect x="7" y="33" width="8" height="3" rx="1.5" fill="#ffffff" fillOpacity="0.75" />
      <rect x="9" y="40" width="6" height="3" rx="1.5" fill="#ffffff" fillOpacity="0.55" />
    </svg>
  );
}

export function Wordmark({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("font-semibold tracking-tight", className)}>
      Turbo<span className={light ? "text-white" : "text-primary"}>pay</span>
    </span>
  );
}
