// TurboPay Permission Constants
// Granular permissions for the RBAC system
// Each permission follows the format: resource:action or resource:subresource:action

// =============================================================================
// WALLET PERMISSIONS
// =============================================================================

export const WALLET_VIEW = 'wallet:view';
export const WALLET_CREATE = 'wallet:create';
export const WALLET_FUND = 'wallet:fund';
export const WALLET_TRANSFER = 'wallet:transfer';
export const WALLET_CONVERT = 'wallet:convert';
export const WALLET_FREEZE = 'wallet:freeze';
export const WALLET_CLOSE = 'wallet:close';

// =============================================================================
// TRANSACTION PERMISSIONS
// =============================================================================

export const TX_VIEW = 'tx:view';
export const TX_VIEW_OWN = 'tx:view:own';
export const TX_PROCESS = 'tx:process';
export const TX_REVERSE = 'tx:reverse';
export const TX_REFUND = 'tx:refund';
export const TX_EXPORT = 'tx:export';

// =============================================================================
// KYC PERMISSIONS
// =============================================================================

export const KYC_VIEW = 'kyc:view';
export const KYC_SUBMIT = 'kyc:submit';
export const KYC_APPROVE = 'kyc:approve';
export const KYC_REJECT = 'kyc:reject';

// =============================================================================
// BILL PAYMENT PERMISSIONS
// =============================================================================

export const BILL_VIEW = 'bill:view';
export const BILL_PAY = 'bill:pay';
export const BILL_HISTORY = 'bill:history';

// =============================================================================
// VIRTUAL CARD PERMISSIONS
// =============================================================================

export const CARD_VIEW = 'card:view';
export const CARD_CREATE = 'card:create';
export const CARD_BLOCK = 'card:block';
export const CARD_UNBLOCK = 'card:unblock';
export const CARD_DELETE = 'card:delete';

// =============================================================================
// ADMIN USER MANAGEMENT PERMISSIONS
// =============================================================================

export const ADMIN_VIEW_USERS = 'admin:view:users';
export const ADMIN_CREATE_USER = 'admin:create:user';
export const ADMIN_EDIT_USER = 'admin:edit:user';
export const ADMIN_DELETE_USER = 'admin:delete:user';
export const ADMIN_MANAGE_ROLES = 'admin:manage:roles';
export const ADMIN_INVITE_USER = 'admin:invite:user';
export const ADMIN_RESET_PASSWORD = 'admin:reset:password';

// =============================================================================
// ADMIN FINANCE PERMISSIONS
// =============================================================================

export const ADMIN_VIEW_FEES = 'admin:view:fees';
export const ADMIN_MANAGE_FEES = 'admin:manage:fees';
export const ADMIN_VIEW_SETTLEMENTS = 'admin:view:settlements';
export const ADMIN_INITIATE_SETTLEMENT = 'admin:initiate:settlement';
export const ADMIN_VIEW_LEDGER = 'admin:view:ledger';
export const ADMIN_MANAGE_LEDGER = 'admin:manage:ledger';

// =============================================================================
// ADMIN PROVIDER PERMISSIONS
// =============================================================================

export const ADMIN_VIEW_PROVIDERS = 'admin:view:providers';
export const ADMIN_MANAGE_PROVIDERS = 'admin:manage:providers';
export const ADMIN_VIEW_PROVIDER_HEALTH = 'admin:view:provider_health';
export const ADMIN_MANAGE_PROVIDER_CREDENTIALS = 'admin:manage:provider_credentials';

// =============================================================================
// ADMIN AUDIT & COMPLIANCE PERMISSIONS
// =============================================================================

export const ADMIN_VIEW_AUDIT = 'admin:view:audit';
export const ADMIN_EXPORT_AUDIT = 'admin:export:audit';
export const ADMIN_VIEW_COMPLIANCE = 'admin:view:compliance';
export const ADMIN_MANAGE_COMPLIANCE = 'admin:manage:compliance';

// =============================================================================
// ADMIN SYSTEM PERMISSIONS
// =============================================================================

export const ADMIN_VIEW_SYSTEM_HEALTH = 'admin:view:system_health';
export const ADMIN_MANAGE_CONFIG = 'admin:manage:config';
export const ADMIN_VIEW_ANALYTICS = 'admin:view:analytics';
export const ADMIN_VIEW_NOTIFICATIONS = 'admin:view:notifications';
export const ADMIN_MANAGE_NOTIFICATIONS = 'admin:manage:notifications';
export const ADMIN_SEND_NOTIFICATIONS = 'admin:send:notifications';
export const ADMIN_MANAGE_EMAIL_TEMPLATES = 'admin:manage:email_templates';

// =============================================================================
// ADMIN SUPPORT PERMISSIONS
// =============================================================================

export const ADMIN_VIEW_SUPPORT = 'admin:view:support';
export const ADMIN_MANAGE_SUPPORT = 'admin:manage:support';
export const ADMIN_VIEW_KNOWLEDGE_BASE = 'admin:view:knowledge_base';
export const ADMIN_MANAGE_KNOWLEDGE_BASE = 'admin:manage:knowledge_base';

// =============================================================================
// ADMIN COMPLIANCE & TRUST PERMISSIONS
// =============================================================================

export const ADMIN_MANAGE_CERTIFICATIONS = 'admin:manage:certifications';
export const ADMIN_MANAGE_SECURITY_BADGES = 'admin:manage:security_badges';
export const ADMIN_MANAGE_PROVIDER_LOGOS = 'admin:manage:provider_logos';
export const ADMIN_MANAGE_TRUST_MESSAGES = 'admin:manage:trust_messages';

// =============================================================================
// GEO-ROUTING PERMISSIONS
// =============================================================================

export const GEO_VIEW = 'geo:view';
export const GEO_MANAGE = 'geo:manage';
export const GEO_VIEW_ANALYTICS = 'geo:view:analytics';

// =============================================================================
// BULK PAYMENT PERMISSIONS
// =============================================================================

export const BULK_VIEW = 'bulk:view';
export const BULK_CREATE = 'bulk:create';
export const BULK_APPROVE = 'bulk:approve';

// =============================================================================
// INTERNATIONAL TRANSFER PERMISSIONS
// =============================================================================

export const INTERNATIONAL_VIEW = 'international:view';
export const INTERNATIONAL_TRANSFER = 'international:transfer';

// =============================================================================
// PERMISSION GROUPS (for convenience)
// =============================================================================

export const ALL_WALLET_PERMISSIONS = [
  WALLET_VIEW, WALLET_CREATE, WALLET_FUND, WALLET_TRANSFER,
  WALLET_CONVERT, WALLET_FREEZE, WALLET_CLOSE
];

export const ALL_TX_PERMISSIONS = [
  TX_VIEW, TX_VIEW_OWN, TX_PROCESS, TX_REVERSE, TX_REFUND, TX_EXPORT
];

export const ALL_KYC_PERMISSIONS = [
  KYC_VIEW, KYC_SUBMIT, KYC_APPROVE, KYC_REJECT
];

export const ALL_BILL_PERMISSIONS = [
  BILL_VIEW, BILL_PAY, BILL_HISTORY
];

export const ALL_CARD_PERMISSIONS = [
  CARD_VIEW, CARD_CREATE, CARD_BLOCK, CARD_UNBLOCK, CARD_DELETE
];

export const ALL_ADMIN_USER_PERMISSIONS = [
  ADMIN_VIEW_USERS, ADMIN_CREATE_USER, ADMIN_EDIT_USER,
  ADMIN_DELETE_USER, ADMIN_MANAGE_ROLES, ADMIN_INVITE_USER, ADMIN_RESET_PASSWORD
];

export const ALL_ADMIN_FINANCE_PERMISSIONS = [
  ADMIN_VIEW_FEES, ADMIN_MANAGE_FEES, ADMIN_VIEW_SETTLEMENTS,
  ADMIN_INITIATE_SETTLEMENT, ADMIN_VIEW_LEDGER, ADMIN_MANAGE_LEDGER
];

export const ALL_ADMIN_PROVIDER_PERMISSIONS = [
  ADMIN_VIEW_PROVIDERS, ADMIN_MANAGE_PROVIDERS,
  ADMIN_VIEW_PROVIDER_HEALTH, ADMIN_MANAGE_PROVIDER_CREDENTIALS
];

export const ALL_ADMIN_AUDIT_PERMISSIONS = [
  ADMIN_VIEW_AUDIT, ADMIN_EXPORT_AUDIT
];

export const ALL_ADMIN_COMPLIANCE_PERMISSIONS = [
  ADMIN_VIEW_COMPLIANCE, ADMIN_MANAGE_COMPLIANCE
];

export const ALL_ADMIN_SYSTEM_PERMISSIONS = [
  ADMIN_VIEW_SYSTEM_HEALTH, ADMIN_MANAGE_CONFIG, ADMIN_VIEW_ANALYTICS,
  ADMIN_MANAGE_NOTIFICATIONS, ADMIN_SEND_NOTIFICATIONS, ADMIN_MANAGE_EMAIL_TEMPLATES
];

export const ALL_ADMIN_SUPPORT_PERMISSIONS = [
  ADMIN_VIEW_SUPPORT, ADMIN_MANAGE_SUPPORT,
  ADMIN_VIEW_KNOWLEDGE_BASE, ADMIN_MANAGE_KNOWLEDGE_BASE
];

export const ALL_ADMIN_COMPLIANCE_TRUST_PERMISSIONS = [
  ADMIN_MANAGE_CERTIFICATIONS, ADMIN_MANAGE_SECURITY_BADGES,
  ADMIN_MANAGE_PROVIDER_LOGOS, ADMIN_MANAGE_TRUST_MESSAGES
];

export const ALL_GEO_PERMISSIONS = [GEO_VIEW, GEO_MANAGE, GEO_VIEW_ANALYTICS];
export const ALL_BULK_PERMISSIONS = [BULK_VIEW, BULK_CREATE, BULK_APPROVE];
export const ALL_INTERNATIONAL_PERMISSIONS = [INTERNATIONAL_VIEW, INTERNATIONAL_TRANSFER];

// =============================================================================
// ALL PERMISSIONS (master list)
// =============================================================================

export const ALL_PERMISSIONS: string[] = [
  ...ALL_WALLET_PERMISSIONS,
  ...ALL_TX_PERMISSIONS,
  ...ALL_KYC_PERMISSIONS,
  ...ALL_BILL_PERMISSIONS,
  ...ALL_CARD_PERMISSIONS,
  ...ALL_ADMIN_USER_PERMISSIONS,
  ...ALL_ADMIN_FINANCE_PERMISSIONS,
  ...ALL_ADMIN_PROVIDER_PERMISSIONS,
  ...ALL_ADMIN_AUDIT_PERMISSIONS,
  ...ALL_ADMIN_COMPLIANCE_PERMISSIONS,
  ...ALL_ADMIN_SYSTEM_PERMISSIONS,
  ...ALL_ADMIN_SUPPORT_PERMISSIONS,
  ...ALL_ADMIN_COMPLIANCE_TRUST_PERMISSIONS,
  ...ALL_GEO_PERMISSIONS,
  ...ALL_BULK_PERMISSIONS,
  ...ALL_INTERNATIONAL_PERMISSIONS,
];
