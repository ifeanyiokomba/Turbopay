/**
 * Browser-safe PII masking helpers (pure string operations — no node:crypto).
 * Imported by client components for display masking. The actual
 * encryption/decryption lives in crypto.ts (server-only).
 */

/** Mask a BVN/NIN for display: 12345678901 -> ******8901 */
export function maskId(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length <= 4) return "****";
  return `${"*".repeat(id.length - 4)}${id.slice(-4)}`;
}

/** Mask phone: +2348012345678 -> +234 801 *** 4567 */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return phone;
  return `${phone.slice(0, 6)}***${phone.slice(-4)}`;
}

/** Mask email: john.doe@example.com -> j***@e***.com */
export function maskEmail(email: string | null): string {
  if (!email) return "";
  const [name, domain] = email.split("@");
  if (!domain) return email;
  const [dname, ...rest] = domain.split(".");
  return `${name[0]}***@${dname[0]}***.${rest.join(".")}`;
}
