/**
 * useCapabilities Hook
 * ====================
 *
 * Fetches available capabilities from the API and provides
 * helper methods to check if a feature is available.
 *
 * Usage:
 *   const { isAvailable, getServices, getCategory } = useCapabilities();
 *   if (isAvailable("airtime")) { ... }
 */

"use client";

import { useApi } from "@/lib/turbopay/client";
import type { CapabilityCategory, CapabilityService } from "@/lib/turbocore/providers/capabilities";

interface ServiceGroup {
  category: CapabilityCategory;
  label: string;
  services: CapabilityService[];
  providers: string[];
}

interface CapabilitiesResponse {
  groups: ServiceGroup[];
  totalCategories: number;
  totalServices: number;
}

interface UseCapabilitiesOptions {
  country?: string;
  currency?: string;
}

interface UseCapabilitiesResult {
  groups: ServiceGroup[];
  isLoading: boolean;
  error: Error | null;

  /** Check if a category is available (has at least one provider) */
  isAvailable: (category: CapabilityCategory) => boolean;

  /** Check if a specific service is available */
  isServiceAvailable: (serviceId: string) => boolean;

  /** Get all services for a category */
  getServices: (category: CapabilityCategory) => CapabilityService[];

  /** Get all providers that support a category */
  getProviders: (category: CapabilityCategory) => string[];

  /** Get a category group by name */
  getCategory: (category: CapabilityCategory) => ServiceGroup | undefined;

  /** Get all available categories */
  getAvailableCategories: () => CapabilityCategory[];

  /** Refetch capabilities */
  refetch: () => void;
}

export function useCapabilities(options?: UseCapabilitiesOptions): UseCapabilitiesResult {
  const params = new URLSearchParams();
  if (options?.country) params.append("country", options.country);
  if (options?.currency) params.append("currency", options.currency);

  const queryString = params.toString();
  const url = `/api/capabilities${queryString ? `?${queryString}` : ""}`;

  const { data, isLoading, error, refetch } = useApi<CapabilitiesResponse>(url);

  const groups = data?.groups ?? [];

  const isAvailable = (category: CapabilityCategory): boolean => {
    return groups.some((g) => g.category === category && g.services.length > 0);
  };

  const isServiceAvailable = (serviceId: string): boolean => {
    return groups.some((g) => g.services.some((s) => s.id === serviceId));
  };

  const getServices = (category: CapabilityCategory): CapabilityService[] => {
    const group = groups.find((g) => g.category === category);
    return group?.services ?? [];
  };

  const getProviders = (category: CapabilityCategory): string[] => {
    const group = groups.find((g) => g.category === category);
    return group?.providers ?? [];
  };

  const getCategory = (category: CapabilityCategory): ServiceGroup | undefined => {
    return groups.find((g) => g.category === category);
  };

  const getAvailableCategories = (): CapabilityCategory[] => {
    return groups.map((g) => g.category);
  };

  return {
    groups,
    isLoading,
    error: error ?? null,
    isAvailable,
    isServiceAvailable,
    getServices,
    getProviders,
    getCategory,
    getAvailableCategories,
    refetch,
  };
}
