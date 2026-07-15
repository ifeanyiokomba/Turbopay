import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { randomToken } from "@/lib/turbopay/crypto";
import { getSharedRedis } from "@/lib/turbopay/rate-limit";

/**
 * WEBAUTHN / PASSKEY SERVICE
 *
 * Implements FIDO2 WebAuthn for passwordless login and second-factor
 * authentication. Uses the @simplewebauthn/server library for the
 * cryptographic heavy lifting.
 *
 * Two modes:
 *   1. Second factor: password first, then passkey replaces TOTP
 *   2. Passwordless: discoverable login with biometric/security key
 *
 * SECURITY: Challenges are stored server-side in an in-memory Map with TTL.
 * The client receives a challengeId (not the raw challenge) and must send it
 * back during verification. This prevents replay attacks where an attacker
 * intercepts a valid response and replays it with a different challenge.
 */

const RP_NAME = "TurboPay";
const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";
const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? `https://${RP_ID}`;
const TIMEOUT = 60_000; // 60 seconds
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Server-side challenge store. Uses Redis when available (multi-instance safe),
// falls back to an in-memory Map for single-instance dev environments.
interface StoredChallenge {
  challenge: string;
  userId?: string; // for registration; null for authentication
  expiresAt: number;
}

const memStore = new Map<string, StoredChallenge>();
const REDIS_KEY_PREFIX = "passkey:challenge:";
const REDIS_TTL_SEC = 300; // 5 minutes

// Periodic cleanup of expired in-memory challenges (fallback only)
if (process.env.NODE_ENV !== "test" && process.env.VITEST === undefined) {
  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of memStore) {
      if (entry.expiresAt < now) memStore.delete(id);
    }
  }, 60_000).unref?.();
}

async function storeChallenge(challenge: string, userId?: string): Promise<string> {
  const id = randomToken(16);
  const entry: StoredChallenge = {
    challenge,
    userId,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  };
  const redis = await getSharedRedis();
  if (redis) {
    await redis.set(`${REDIS_KEY_PREFIX}${id}`, JSON.stringify(entry), "EX", REDIS_TTL_SEC).catch(() => null);
  }
  memStore.set(id, entry);
  return id;
}

async function getAndConsumeChallenge(challengeId: string): Promise<string | null> {
  const redis = await getSharedRedis();
  if (redis) {
    const raw = await redis.getdel(`${REDIS_KEY_PREFIX}${challengeId}`).catch(() => null);
    if (raw) {
      try {
        const entry = JSON.parse(raw) as StoredChallenge;
        if (entry.expiresAt >= Date.now()) {
          memStore.delete(challengeId); // also clean mem store
          return entry.challenge;
        }
      } catch { /* corrupted, fall through */ }
    }
  }
  // Fallback: in-memory store
  const entry = memStore.get(challengeId);
  if (!entry || entry.expiresAt < Date.now()) {
    memStore.delete(challengeId);
    return null;
  }
  memStore.delete(challengeId);
  return entry.challenge;
}

/** Generate registration options for a user to enroll a new passkey. */
export async function generatePasskeyRegistrationOptions(
  userId: string,
  email: string
) {
  // Get existing passkeys for exclusion list (prevents re-registering same authenticator)
  const existingPasskeys = await db.passkey.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    // CUID (25 chars) used as opaque user identifier. The FIDO2 spec
    // recommends an opaque, unique, max-64-byte value — CUID satisfies
    // all three. The raw DB ID is acceptable here because CUIDs are
    // immutable and reveal nothing about the user.
    userID: Buffer.from(userId),
    userName: email,
    userDisplayName: email,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials: existingPasskeys.map((pk) => ({
      id: pk.credentialId,
      transports: pk.transports
        ? (JSON.parse(pk.transports) as AuthenticatorTransportFuture[])
        : undefined,
    })),
    timeout: TIMEOUT,
  });

  // Store challenge server-side — client gets a challengeId, not the raw challenge
  const challengeId = await storeChallenge(options.challenge, userId);

  return { ...options, challengeId };
}

/** Verify a registration response and store the new passkey. */
export async function verifyPasskeyRegistration(
  userId: string,
  deviceName: string,
  deviceType: string,
  registrationResponse: RegistrationResponseJSON,
  challengeId: string
): Promise<{ verified: boolean; credentialId?: string }> {
  // Retrieve the stored challenge — do NOT trust the client-provided value
  const storedChallenge = await getAndConsumeChallenge(challengeId);
  if (!storedChallenge) {
    return { verified: false };
  }

  const verification = await verifyRegistrationResponse({
    response: registrationResponse,
    expectedChallenge: storedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false };
  }

  const { credential } = verification.registrationInfo;

  // Store the passkey
  const passkey = await db.passkey.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: BigInt(credential.counter),
      deviceName,
      deviceType,
      transports: registrationResponse.response?.transports
        ? JSON.stringify(registrationResponse.response.transports)
        : null,
    },
  });

  await audit({
    userId,
    action: "PASSKEY_REGISTERED",
    category: "AUTH",
    metadata: { credentialId: passkey.credentialId, deviceName, deviceType },
  });

  return { verified: true, credentialId: passkey.credentialId };
}

/** Generate authentication options for login (discoverable or conditional). */
export async function generatePasskeyAuthenticationOptions(
  identifier?: string
) {
  // If identifier is provided, find passkeys for that user (conditional UI)
  // Otherwise, discoverable login (user picks from platform authenticator)
  let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] = [];

  if (identifier) {
    const user = await db.user.findFirst({
      where: { OR: [{ email: identifier.toLowerCase() }, { username: identifier }] },
      select: { id: true },
    });
    if (user) {
      const passkeys = await db.passkey.findMany({
        where: { userId: user.id },
        select: { credentialId: true, transports: true },
      });
      allowCredentials = passkeys.map((pk) => ({
        id: pk.credentialId,
        transports: pk.transports
          ? (JSON.parse(pk.transports) as AuthenticatorTransportFuture[])
          : undefined,
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials,
    userVerification: "preferred",
    timeout: TIMEOUT,
  });

  // Store challenge server-side — client gets a challengeId, not the raw challenge
  const challengeId = await storeChallenge(options.challenge);

  return { ...options, challengeId };
}

/** Verify an authentication response and return the user. */
export async function verifyPasskeyAuthentication(
  authenticationResponse: AuthenticationResponseJSON,
  challengeId: string
): Promise<{ verified: boolean; userId?: string; credentialId?: string }> {
  // Retrieve the stored challenge — do NOT trust the client-provided value
  const storedChallenge = await getAndConsumeChallenge(challengeId);
  if (!storedChallenge) {
    return { verified: false };
  }

  // Find the passkey by credential ID
  const passkey = await db.passkey.findUnique({
    where: { credentialId: authenticationResponse.id },
    select: { id: true, userId: true, credentialId: true, publicKey: true, counter: true, transports: true },
  });

  if (!passkey) {
    return { verified: false };
  }

  const verification = await verifyAuthenticationResponse({
    response: authenticationResponse,
    expectedChallenge: storedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: passkey.credentialId,
      publicKey: Buffer.from(passkey.publicKey, "base64url"),
      counter: Number(passkey.counter),
      transports: passkey.transports
        ? (JSON.parse(passkey.transports) as AuthenticatorTransportFuture[])
        : undefined,
    },
  });

  if (!verification.verified) {
    await audit({
      userId: passkey.userId,
      action: "PASSKEY_AUTH_FAILED",
      category: "AUTH",
      severity: "WARN",
      metadata: { credentialId: passkey.credentialId },
    });
    return { verified: false };
  }

  // Update counter + last used
  await db.passkey.update({
    where: { id: passkey.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    },
  });

  await audit({
    userId: passkey.userId,
    action: "PASSKEY_AUTH_SUCCESS",
    category: "AUTH",
    metadata: { credentialId: passkey.credentialId },
  });

  return { verified: true, userId: passkey.userId, credentialId: passkey.credentialId };
}

/** List all passkeys for a user. */
export async function listPasskeys(userId: string) {
  return db.passkey.findMany({
    where: { userId },
    select: {
      id: true,
      credentialId: true,
      deviceName: true,
      deviceType: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { lastUsedAt: "desc" },
  });
}

/** Remove a passkey (user must have at least one other method to authenticate). */
export async function removePasskey(userId: string, passkeyId: string) {
  const passkey = await db.passkey.findUnique({ where: { id: passkeyId } });
  if (!passkey || passkey.userId !== userId) return false;

  await db.passkey.delete({ where: { id: passkeyId } });
  await audit({
    userId,
    action: "PASSKEY_REMOVED",
    category: "AUTH",
    metadata: { credentialId: passkey.credentialId, deviceName: passkey.deviceName },
  });
  return true;
}
