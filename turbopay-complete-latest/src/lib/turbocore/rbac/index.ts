/**
 * TurboCore — RBAC + Permission-based Authorization
 * =================================================
 *
 * Roles are stored in the DB with a JSON array of permission strings.
 * `requirePermission` checks the current user's role against the required
 * permission. Falls back to the simple USER/ADMIN role on the User table
 * if no Role row exists (backward compat with the original TurboPay auth).
 */

import { requireUser, AuthError } from "@/lib/turbopay/auth";
import { db } from "@/lib/db";

/** Canonical permission strings. Extend as the platform grows. */
export const Permissions = {
  // Wallet
  WALLET_VIEW: "wallet:view",
  WALLET_FREEZE: "wallet:freeze",
  WALLET_UNFREEZE: "wallet:unfreeze",
  // Transactions
  TX_VIEW_ALL: "tx:view:all",
  TX_REVERSE: "tx:reverse",
  // KYC
  KYC_APPROVE: "kyc:approve",
  KYC_REJECT: "kyc:reject",
  // AML
  AML_VIEW: "aml:view",
  AML_RESOLVE: "aml:resolve",
  // Admin
  ADMIN_VIEW: "admin:view",
  ADMIN_MANAGE_USERS: "admin:manage:users",
  ADMIN_MANAGE_FEES: "admin:manage:fees",
  ADMIN_MANAGE_FLAGS: "admin:manage:flags",
  ADMIN_MANAGE_PROVIDERS: "admin:manage:providers",
  ADMIN_VIEW_WEBHOOKS: "admin:view:webhooks",
  ADMIN_MANAGE_WEBHOOKS: "admin:manage:webhooks",
  ADMIN_RUN_RECONCILIATION: "admin:run:reconciliation",
  // Platform Configuration
  ADMIN_MANAGE_PROVIDER_CONFIG: "admin:manage:provider:config",
  ADMIN_MANAGE_PROVIDER_CREDENTIALS: "admin:manage:provider:credentials",
  ADMIN_MANAGE_PROVIDER_ROUTING: "admin:manage:provider:routing",
  ADMIN_VIEW_PROVIDER_HEALTH: "admin:view:provider:health",
  ADMIN_MANAGE_KYC_LIMITS: "admin:manage:kyc:limits",
  ADMIN_MANAGE_AML_POLICY: "admin:manage:aml:policy",
  ADMIN_MANAGE_DEPLOYMENT_PROFILES: "admin:manage:deployment:profiles",
  ADMIN_VIEW_SECRETS_STATUS: "admin:view:secrets:status",
  ADMIN_VIEW_CONFIG_HISTORY: "admin:view:config:history",
  ADMIN_MANAGE_COMPLIANCE_CASES: "admin:manage:compliance:cases",
  ADMIN_MANAGE_NOTIFICATIONS: "admin:manage:notifications",
  ADMIN_VIEW_AUDIT: "admin:view:audit",
  ADMIN_VIEW_PII: "admin:view:pii",
  // Operations Platform
  SUPPORT_VIEW_CUSTOMERS: "support:view:customers",
  SUPPORT_ADD_NOTES: "support:add:notes",
  FINANCE_VIEW_REPORTS: "finance:view:reports",
  FINANCE_RUN_RECONCILE: "finance:run:reconcile",
  SYSTEM_VIEW_HEALTH: "system:view:health",
  ADMIN_MANAGE_TEAM: "admin:manage:team",
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

/** Built-in role → permissions mapping (seeded if no Role rows exist). */
export const BUILTIN_ROLES: Record<string, Permission[]> = {
  user: [],
  admin: [
    Permissions.WALLET_VIEW, Permissions.WALLET_FREEZE, Permissions.WALLET_UNFREEZE,
    Permissions.TX_VIEW_ALL, Permissions.TX_REVERSE,
    Permissions.KYC_APPROVE, Permissions.KYC_REJECT,
    Permissions.AML_VIEW, Permissions.AML_RESOLVE,
    Permissions.ADMIN_VIEW, Permissions.ADMIN_MANAGE_USERS, Permissions.ADMIN_MANAGE_FEES,
    Permissions.ADMIN_MANAGE_FLAGS, Permissions.ADMIN_MANAGE_PROVIDERS,
    Permissions.ADMIN_VIEW_WEBHOOKS, Permissions.ADMIN_MANAGE_WEBHOOKS,
    Permissions.ADMIN_RUN_RECONCILIATION,
    // Platform Configuration
    Permissions.ADMIN_MANAGE_PROVIDER_CONFIG, Permissions.ADMIN_MANAGE_PROVIDER_CREDENTIALS, Permissions.ADMIN_MANAGE_PROVIDER_ROUTING,
    Permissions.ADMIN_VIEW_PROVIDER_HEALTH, Permissions.ADMIN_MANAGE_KYC_LIMITS,
    Permissions.ADMIN_MANAGE_AML_POLICY, Permissions.ADMIN_MANAGE_DEPLOYMENT_PROFILES,
    Permissions.ADMIN_VIEW_SECRETS_STATUS, Permissions.ADMIN_VIEW_CONFIG_HISTORY,
    Permissions.ADMIN_MANAGE_COMPLIANCE_CASES, Permissions.ADMIN_MANAGE_NOTIFICATIONS,
    Permissions.ADMIN_VIEW_AUDIT, Permissions.ADMIN_VIEW_PII,
    Permissions.SUPPORT_VIEW_CUSTOMERS, Permissions.SUPPORT_ADD_NOTES,
    Permissions.FINANCE_VIEW_REPORTS, Permissions.FINANCE_RUN_RECONCILE,
    Permissions.SYSTEM_VIEW_HEALTH, Permissions.ADMIN_MANAGE_TEAM,
  ] as Permission[],
  support: [Permissions.WALLET_VIEW, Permissions.TX_VIEW_ALL, Permissions.AML_VIEW, Permissions.ADMIN_VIEW, Permissions.SUPPORT_VIEW_CUSTOMERS, Permissions.SUPPORT_ADD_NOTES, Permissions.SYSTEM_VIEW_HEALTH],
  compliance: [Permissions.TX_VIEW_ALL, Permissions.AML_VIEW, Permissions.AML_RESOLVE, Permissions.KYC_APPROVE, Permissions.KYC_REJECT, Permissions.ADMIN_VIEW, Permissions.SUPPORT_VIEW_CUSTOMERS, Permissions.SUPPORT_ADD_NOTES, Permissions.ADMIN_MANAGE_COMPLIANCE_CASES],
  finance: [Permissions.TX_VIEW_ALL, Permissions.ADMIN_VIEW, Permissions.ADMIN_MANAGE_FEES, Permissions.ADMIN_RUN_RECONCILIATION, Permissions.FINANCE_VIEW_REPORTS, Permissions.FINANCE_RUN_RECONCILE],
};

class RbacService {
  /** Get the permissions for a user's role. Falls back to USER/ADMIN. */
  async getPermissions(role: string): Promise<Permission[]> {
    const roleRow = await db.role.findUnique({ where: { name: role } });
    if (roleRow) {
      try {
        return JSON.parse(roleRow.permissions) as Permission[];
      } catch {
        return [];
      }
    }
    // Backward compat: map the legacy USER/ADMIN roles.
    if (role === "ADMIN") return BUILTIN_ROLES.admin;
    return BUILTIN_ROLES.user;
  }

  /** Check if a user's role has a specific permission. */
  async hasPermission(role: string, permission: Permission): Promise<boolean> {
    const perms = await this.getPermissions(role);
    return perms.includes(permission);
  }

  /** Require the authenticated user to have a specific permission. */
  async requirePermission(permission: Permission) {
    const user = await requireUser();
    const has = await this.hasPermission(user.role, permission);
    if (!has) {
      throw new AuthError("FORBIDDEN", `Missing permission: ${permission}`, 403);
    }
    return user;
  }

  /** Seed the built-in roles if they don't exist. Call at app boot. */
  async seedBuiltinRoles() {
    for (const [name, perms] of Object.entries(BUILTIN_ROLES)) {
      await db.role.upsert({
        where: { name },
        create: { name, description: `Built-in ${name} role`, permissions: JSON.stringify(perms) },
        update: { permissions: JSON.stringify(perms) },
      });
    }
  }
}

export const rbac = new RbacService();

/** Convenience: require a permission (throws AuthError if missing). */
export async function requirePermission(permission: Permission) {
  return rbac.requirePermission(permission);
}
