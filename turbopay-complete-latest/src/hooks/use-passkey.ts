"use client";

import { useState, useCallback } from "react";
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/browser";

/**
 * CLIENT-SIDE PASSKEY HOOKS
 *
 * Two hooks for WebAuthn passkey operations:
 *   - usePasskeyRegistration: enroll a new passkey
 *   - usePasskeyAuthentication: authenticate with a passkey
 *
 * Both handle the full browser-side flow:
 *   1. Fetch challenge from server
 *   2. Call navigator.credentials.create/get
 *   3. Send response back to server for verification
 */

// --- Shared helpers ---

export function isPasskeySupported(): boolean {
  return browserSupportsWebAuthn();
}

async function apiPost(url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error ?? json.message ?? "Request failed");
  }
  return json.data ?? json;
}

// --- usePasskeyRegistration ---

export interface UsePasskeyRegistrationOptions {
  onSuccess?: (credentialId: string) => void;
  onError?: (error: Error) => void;
}

export interface UsePasskeyRegistrationReturn {
  register: (deviceName: string, deviceType?: "singleDevice" | "multiDevice") => Promise<void>;
  isRegistering: boolean;
  error: Error | null;
  success: boolean;
}

/**
 * Hook for registering a new passkey.
 *
 * Usage:
 *   const { register, isRegistering, error, success } = usePasskeyRegistration({
 *     onSuccess: (credId) => console.log("Passkey registered:", credId),
 *   });
 *   await register("My iPhone", "singleDevice");
 */
export function usePasskeyRegistration(
  options?: UsePasskeyRegistrationOptions
): UsePasskeyRegistrationReturn {
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [success, setSuccess] = useState(false);

  const register = useCallback(
    async (deviceName: string, deviceType: "singleDevice" | "multiDevice" = "singleDevice") => {
      setIsRegistering(true);
      setError(null);
      setSuccess(false);

      try {
        const registrationOptions = await apiPost("/api/auth/passkey/register/options");

        const registrationResponse: RegistrationResponseJSON = await startRegistration({
          optionsJSON: registrationOptions,
        });

        const result = await apiPost("/api/auth/passkey/register/verify", {
          deviceName,
          deviceType,
          registrationResponse,
          challengeId: registrationOptions.challengeId,
        });

        if (result.verified) {
          setSuccess(true);
          options?.onSuccess?.(result.credentialId);
        } else {
          throw new Error("Passkey registration was not verified");
        }
      } catch (err: any) {
        if (err.name === "NotAllowedError") {
          const e = new Error("Passkey registration was cancelled");
          setError(e);
          options?.onError?.(e);
        } else if (err.name === "InvalidStateError") {
          const e = new Error("This passkey is already registered on this device");
          setError(e);
          options?.onError?.(e);
        } else {
          const e = err instanceof Error ? err : new Error(String(err));
          setError(e);
          options?.onError?.(e);
        }
      } finally {
        setIsRegistering(false);
      }
    },
    [options]
  );

  return { register, isRegistering, error, success };
}

// --- usePasskeyAuthentication ---

export interface UsePasskeyAuthenticationOptions {
  onSuccess?: (user: any) => void;
  onError?: (error: Error) => void;
}

export interface UsePasskeyAuthenticationReturn {
  authenticate: (identifier?: string) => Promise<any>;
  isAuthenticating: boolean;
  error: Error | null;
  user: any | null;
}

/**
 * Hook for authenticating with a passkey.
 *
 * Two modes:
 *   - Passwordless: authenticate() with no args
 *   - Conditional UI: authenticate("user@example.com")
 */
export function usePasskeyAuthentication(
  options?: UsePasskeyAuthenticationOptions
): UsePasskeyAuthenticationReturn {
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [user, setUser] = useState<any | null>(null);

  const authenticate = useCallback(
    async (identifier?: string) => {
      setIsAuthenticating(true);
      setError(null);
      setUser(null);

      try {
        const authOptions = await apiPost("/api/auth/passkey/authenticate/options", {
          identifier: identifier || undefined,
        });

        const authenticationResponse: AuthenticationResponseJSON =
          await startAuthentication({ optionsJSON: authOptions });

        const userData = await apiPost("/api/auth/passkey/authenticate/verify", {
          authenticationResponse,
          challengeId: authOptions.challengeId,
        });

        setUser(userData);
        options?.onSuccess?.(userData);
        return userData;
      } catch (err: any) {
        if (err.name === "NotAllowedError") {
          const e = new Error("Passkey authentication was cancelled");
          setError(e);
          options?.onError?.(e);
        } else {
          const e = err instanceof Error ? err : new Error(String(err));
          setError(e);
          options?.onError?.(e);
        }
      } finally {
        setIsAuthenticating(false);
      }
    },
    [options]
  );

  return { authenticate, isAuthenticating, error, user };
}

// --- usePasskeys (management) ---

export interface PasskeyInfo {
  id: string;
  credentialId: string;
  deviceName: string;
  deviceType: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface UsePasskeysReturn {
  passkeys: PasskeyInfo[];
  isLoading: boolean;
  load: () => Promise<void>;
  remove: (passkeyId: string) => Promise<boolean>;
}

/**
 * Hook for managing user's passkeys (list, remove).
 */
export function usePasskeys(): UsePasskeysReturn {
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiPost("/api/auth/passkeys");
      setPasskeys(data);
    } catch {
      // Silent fail
    } finally {
      setIsLoading(false);
    }
  }, []);

  const remove = useCallback(async (passkeyId: string) => {
    try {
      await apiPost("/api/auth/passkeys", { passkeyId });
      setPasskeys((prev) => prev.filter((pk) => pk.id !== passkeyId));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { passkeys, isLoading, load, remove };
}
