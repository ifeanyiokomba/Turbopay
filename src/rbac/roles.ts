// TurboPay Role Definitions
// 10 admin roles with granular permission mappings
// Each role gets a specific subset of the 40+ available permissions

import {
  ALL_WALLET_PERMISSIONS,
  ALL_TX_PERMISSIONS,
  ALL_KYC_PERMISSIONS,
  ALL_BILL_PERMISSIONS,
  ALL_CARD_PERMISSIONS,
  ALL_ADMIN_USER_PERMISSIONS,
  ALL_ADMIN_FINANCE_PERMISSIONS,
  ALL_ADMIN_PROVIDER_PERMISSIONS,
  ALL_ADMIN_AUDIT_PERMISSIONS,
  ALL_ADMIN_COMPLIANCE_PERMISSIONS,
  ALL_ADMIN_SYSTEM_PERMISSIONS,
  ALL_ADMIN_SUPPORT_PERMISSIONS,
  ALL_ADMIN_COMPLIANCE_TRUST_PERMISSIONS,
  ALL_GEO_PERMISSIONS,
  ALL_BULK_PERMISSIONS,
  ALL_INTERNATIONAL_PERMISSIONS,
  ALL_PERMISSIONS,
  // Individual permissions for fine-grained control
  WALLET_VIEW, WALLET_CREATE, WALLET_FUND, WALLET_TRANSFER,
  TX_VIEW, TX_VIEW_OWN, TX_PROCESS, TX_REVERSE, TX_REFUND, TX_EXPORT,
  KYC_VIEW, KYC_SUBMIT, KYC_APPROVE, KYC_REJECT,
  BILL_VIEW, BILL_PAY,
  CARD_VIEW, CARD_CREATE, CARD_BLOCK, CARD_UNBLOCK,
  ADMIN_VIEW_USERS, ADMIN_CREATE_USER, ADMIN_EDIT_USER, ADMIN_INVITE_USER,
  ADMIN_MANAGE_ROLES, ADMIN_VIEW_FEES, ADMIN_MANAGE_FEES,
  ADMIN_VIEW_SETTLEMENTS, ADMIN_INITIATE_SETTLEMENT,
  ADMIN_VIEW_LEDGER, ADMIN_MANAGE_LEDGER,
  ADMIN_VIEW_PROVIDERS, ADMIN_MANAGE_PROVIDERS,
  ADMIN_VIEW_PROVIDER_HEALTH, ADMIN_MANAGE_PROVIDER_CREDENTIALS,
  ADMIN_VIEW_AUDIT, ADMIN_EXPORT_AUDIT,
  ADMIN_VIEW_COMPLIANCE, ADMIN_MANAGE_COMPLIANCE,
  ADMIN_VIEW_SYSTEM_HEALTH, ADMIN_MANAGE_CONFIG, ADMIN_VIEW_ANALYTICS,
  ADMIN_VIEW_NOTIFICATIONS, ADMIN_MANAGE_NOTIFICATIONS, ADMIN_SEND_NOTIFICATIONS, ADMIN_MANAGE_EMAIL_TEMPLATES,
  ADMIN_VIEW_SUPPORT, ADMIN_MANAGE_SUPPORT,
  ADMIN_VIEW_KNOWLEDGE_BASE, ADMIN_MANAGE_KNOWLEDGE_BASE,
  ADMIN_MANAGE_CERTIFICATIONS, ADMIN_MANAGE_SECURITY_BADGES,
  ADMIN_MANAGE_PROVIDER_LOGOS, ADMIN_MANAGE_TRUST_MESSAGES,
  GEO_VIEW, GEO_MANAGE, GEO_VIEW_ANALYTICS,
  BULK_VIEW, BULK_CREATE, BULK_APPROVE,
  INTERNATIONAL_VIEW, INTERNATIONAL_TRANSFER,
} from './permissions';

// =============================================================================
// ADMIN ROLE TYPES
// =============================================================================

export type AdminRole =
  | 'SUPER_ADMIN'
  | 'ADMINISTRATOR'
  | 'FINANCE_OFFICER'
  | 'COMPLIANCE_OFFICER'
  | 'SUPPORT_OFFICER'
  | 'OPERATIONS_OFFICER'
  | 'RISK_OFFICER'
  | 'DEVELOPER'
  | 'AUDITOR'
  | 'READONLY_ANALYST';

// =============================================================================
// ROLE DEFINITIONS
// =============================================================================

export interface RoleDefinition {
  name: AdminRole;
  displayName: string;
  description: string;
  permissions: string[];
}

/**
 * All 10 admin roles with their permission sets.
 *
 * SUPER_ADMIN gets ALL permissions (the "master admin" escalation path).
 * Each other role gets a scoped subset based on its operational domain.
 */
export const ADMIN_ROLES: Record<AdminRole, RoleDefinition> = {
  // =========================================================================
  // SUPER_ADMIN — full access to everything
  // =========================================================================
  SUPER_ADMIN: {
    name: 'SUPER_ADMIN',
    displayName: 'Super Admin',
    description: 'Full access to all TurboPay features and settings. Contact when you hit a wall you shouldn\'t cross.',
    permissions: [...ALL_PERMISSIONS],
  },

  // =========================================================================
  // ADMINISTRATOR — broad admin access minus sensitive system config
  // =========================================================================
  ADMINISTRATOR: {
    name: 'ADMINISTRATOR',
    displayName: 'Administrator',
    description: 'Broad administrative access. Can manage users, providers, and daily operations.',
    permissions: [
      // Users
      ...ALL_ADMIN_USER_PERMISSIONS,
      // Finance (view + some manage)
      ADMIN_VIEW_FEES, ADMIN_MANAGE_FEES, ADMIN_VIEW_SETTLEMENTS, ADMIN_VIEW_LEDGER,
      // Providers
      ADMIN_VIEW_PROVIDERS, ADMIN_MANAGE_PROVIDERS, ADMIN_VIEW_PROVIDER_HEALTH,
      // Audit
      ADMIN_VIEW_AUDIT,
      // Compliance
      ADMIN_VIEW_COMPLIANCE, ADMIN_MANAGE_COMPLIANCE,
      // System (view only)
      ADMIN_VIEW_SYSTEM_HEALTH, ADMIN_VIEW_ANALYTICS,
      // Support
      ADMIN_VIEW_SUPPORT, ADMIN_MANAGE_SUPPORT,
      // Trust & Compliance
      ADMIN_MANAGE_CERTIFICATIONS, ADMIN_MANAGE_SECURITY_BADGES,
      ADMIN_MANAGE_PROVIDER_LOGOS, ADMIN_MANAGE_TRUST_MESSAGES,
      // Geo
      ...ALL_GEO_PERMISSIONS,
      // Bulk
      ...ALL_BULK_PERMISSIONS,
      // International
      ...ALL_INTERNATIONAL_PERMISSIONS,
    ],
  },

  // =========================================================================
  // FINANCE_OFFICER — financial operations focus
  // =========================================================================
  FINANCE_OFFICER: {
    name: 'FINANCE_OFFICER',
    displayName: 'Finance Officer',
    description: 'Manages fees, settlements, ledgers, and financial reporting.',
    permissions: [
      // Wallet
      WALLET_VIEW,
      // Transactions
      TX_VIEW, TX_EXPORT,
      // Finance
      ...ALL_ADMIN_FINANCE_PERMISSIONS,
      // Providers (view)
      ADMIN_VIEW_PROVIDERS, ADMIN_VIEW_PROVIDER_HEALTH,
      // Audit
      ADMIN_VIEW_AUDIT, ADMIN_EXPORT_AUDIT,
      // Analytics
      ADMIN_VIEW_ANALYTICS,
      // Bulk
      BULK_VIEW, BULK_APPROVE,
      // International
      INTERNATIONAL_VIEW,
    ],
  },

  // =========================================================================
  // COMPLIANCE_OFFICER — compliance and KYC focus
  // =========================================================================
  COMPLIANCE_OFFICER: {
    name: 'COMPLIANCE_OFFICER',
    displayName: 'Compliance Officer',
    description: 'Manages KYC verification, compliance certifications, and regulatory requirements.',
    permissions: [
      // KYC
      KYC_VIEW, KYC_APPROVE, KYC_REJECT,
      // Compliance
      ...ALL_ADMIN_COMPLIANCE_PERMISSIONS,
      // Audit
      ADMIN_VIEW_AUDIT, ADMIN_EXPORT_AUDIT,
      // Trust & Compliance
      ...ALL_ADMIN_COMPLIANCE_TRUST_PERMISSIONS,
      // Users (view only)
      ADMIN_VIEW_USERS,
      // Transactions (view only)
      TX_VIEW,
    ],
  },

  // =========================================================================
  // SUPPORT_OFFICER — customer support focus
  // =========================================================================
  SUPPORT_OFFICER: {
    name: 'SUPPORT_OFFICER',
    displayName: 'Support Officer',
    description: 'Handles customer support, knowledge base, and transaction assistance.',
    permissions: [
      // Support
      ...ALL_ADMIN_SUPPORT_PERMISSIONS,
      // Users (view only)
      ADMIN_VIEW_USERS,
      // Transactions (view only)
      TX_VIEW, TX_VIEW_OWN,
      // KYC (view only)
      KYC_VIEW,
      // Wallet (view only)
      WALLET_VIEW,
      // Notifications
      ADMIN_SEND_NOTIFICATIONS,
    ],
  },

  // =========================================================================
  // OPERATIONS_OFFICER — provider and system operations
  // =========================================================================
  OPERATIONS_OFFICER: {
    name: 'OPERATIONS_OFFICER',
    displayName: 'Operations Officer',
    description: 'Manages provider integrations, health monitoring, and system operations.',
    permissions: [
      // Providers
      ...ALL_ADMIN_PROVIDER_PERMISSIONS,
      // System
      ADMIN_VIEW_SYSTEM_HEALTH, ADMIN_VIEW_ANALYTICS,
      // Geo
      ...ALL_GEO_PERMISSIONS,
      // Transactions (view only)
      TX_VIEW,
      // Notifications
      ADMIN_VIEW_NOTIFICATIONS, ADMIN_SEND_NOTIFICATIONS,
    ],
  },

  // =========================================================================
  // RISK_OFFICER — risk and fraud management
  // =========================================================================
  RISK_OFFICER: {
    name: 'RISK_OFFICER',
    displayName: 'Risk Officer',
    description: 'Monitors fraud, manages risk rules, and oversees transaction security.',
    permissions: [
      // Transactions
      TX_VIEW, TX_REVERSE, TX_EXPORT,
      // KYC
      KYC_VIEW,
      // Compliance
      ADMIN_VIEW_COMPLIANCE,
      // Audit
      ADMIN_VIEW_AUDIT, ADMIN_EXPORT_AUDIT,
      // Users (view only)
      ADMIN_VIEW_USERS,
      // Analytics
      ADMIN_VIEW_ANALYTICS,
      // Providers (view only)
      ADMIN_VIEW_PROVIDERS, ADMIN_VIEW_PROVIDER_HEALTH,
    ],
  },

  // =========================================================================
  // DEVELOPER — technical integration focus
  // =========================================================================
  DEVELOPER: {
    name: 'DEVELOPER',
    displayName: 'Developer',
    description: 'Technical access for API integration, webhooks, and provider configuration.',
    permissions: [
      // Providers
      ADMIN_VIEW_PROVIDERS, ADMIN_VIEW_PROVIDER_HEALTH,
      // System
      ADMIN_VIEW_SYSTEM_HEALTH,
      // Geo
      GEO_VIEW,
      // Webhooks (part of provider management)
      ADMIN_MANAGE_PROVIDERS,
      // Transactions (view only)
      TX_VIEW,
    ],
  },

  // =========================================================================
  // AUDITOR — read-only audit focus
  // =========================================================================
  AUDITOR: {
    name: 'AUDITOR',
    displayName: 'Auditor',
    description: 'Read-only access to audit logs, transactions, and compliance records.',
    permissions: [
      // Audit
      ADMIN_VIEW_AUDIT, ADMIN_EXPORT_AUDIT,
      // Compliance (view only)
      ADMIN_VIEW_COMPLIANCE,
      // Transactions (view only)
      TX_VIEW, TX_EXPORT,
      // Users (view only)
      ADMIN_VIEW_USERS,
      // Finance (view only)
      ADMIN_VIEW_FEES, ADMIN_VIEW_SETTLEMENTS, ADMIN_VIEW_LEDGER,
      // Analytics
      ADMIN_VIEW_ANALYTICS,
    ],
  },

  // =========================================================================
  // READONLY_ANALYST — minimal read-only access
  // =========================================================================
  READONLY_ANALYST: {
    name: 'READONLY_ANALYST',
    displayName: 'Read-Only Analyst',
    description: 'Minimal read-only access for reporting and analytics.',
    permissions: [
      // Analytics
      ADMIN_VIEW_ANALYTICS,
      // Transactions (view only)
      TX_VIEW,
      // Providers (view only)
      ADMIN_VIEW_PROVIDERS,
      // Audit (view only)
      ADMIN_VIEW_AUDIT,
    ],
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get all permissions for a given role.
 * Returns empty array for unknown roles.
 */
export function getPermissionsForRole(role: AdminRole): string[] {
  return ADMIN_ROLES[role]?.permissions || [];
}

/**
 * Check if a role has a specific permission.
 */
export function roleHasPermission(role: AdminRole, permission: string): boolean {
  const permissions = getPermissionsForRole(role);
  return permissions.includes(permission);
}

/**
 * Get all available role names.
 */
export function getAllRoleNames(): AdminRole[] {
  return Object.keys(ADMIN_ROLES) as AdminRole[];
}

/**
 * Get role definition by name.
 */
export function getRoleDefinition(role: AdminRole): RoleDefinition | undefined {
  return ADMIN_ROLES[role];
}

/**
 * Validate that a role string is a valid AdminRole.
 */
export function isValidRole(role: string): role is AdminRole {
  return role in ADMIN_ROLES;
}
