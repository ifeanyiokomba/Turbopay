// TurboPay RBAC Middleware
// Permission checking middleware for route-level access control

import { AdminAuthService, AdminUser } from '../admin/auth/auth.service';
import { getPermissionsForRole, AdminRole } from './roles';

// =============================================================================
// TYPES
// =============================================================================

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: AdminRole | string;
  permissions: string[];
}

export interface RBACRequest {
  user?: AuthenticatedUser;
  [key: string]: any;
}

export interface RBACResponse {
  status(code: number): RBACResponse;
  json(data: any): void;
}

// =============================================================================
// PERMISSION CHECKING
// =============================================================================

/**
 * Get all permissions for a user, combining role-based permissions with
 * any explicit permissions stored on the user record.
 */
export function getUserPermissions(user: AdminUser): string[] {
  const rolePermissions = getPermissionsForRole(user.role as AdminRole);
  const explicitPermissions = user.permissions || [];

  // Combine role permissions with explicit permissions (no duplicates)
  const combined = new Set([...rolePermissions, ...explicitPermissions]);
  return Array.from(combined);
}

/**
 * Check if a user has a specific permission.
 * Super admin bypasses all permission checks.
 */
export function hasPermission(user: AdminUser, permission: string): boolean {
  // Super admin has all permissions
  if (user.role === 'SUPER_ADMIN' || user.role === 'master_admin') {
    return true;
  }

  const permissions = getUserPermissions(user);
  return permissions.includes(permission);
}

/**
 * Check if a user has ALL of the specified permissions.
 */
export function hasAllPermissions(user: AdminUser, permissions: string[]): boolean {
  return permissions.every(p => hasPermission(user, p));
}

/**
 * Check if a user has ANY of the specified permissions.
 */
export function hasAnyPermission(user: AdminUser, permissions: string[]): boolean {
  return permissions.some(p => hasPermission(user, p));
}

// =============================================================================
// MIDDLEWARE FUNCTIONS
// =============================================================================

/**
 * Express-style middleware: require a specific permission.
 * Returns a middleware function that checks if the authenticated user has the permission.
 *
 * Usage:
 *   app.get('/api/v1/admin/users', requirePermission(ADMIN_VIEW_USERS), handler)
 */
export function requirePermission(permission: string) {
  return (req: RBACRequest, res: RBACResponse, next: () => void) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = req.user as any as AdminUser;
    if (!hasPermission(user, permission)) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: permission,
        message: 'Contact your administrator for access'
      });
      return;
    }

    next();
  };
}

/**
 * Express-style middleware: require ANY of the specified permissions.
 */
export function requireAnyPermission(...permissions: string[]) {
  return (req: RBACRequest, res: RBACResponse, next: () => void) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = req.user as any as AdminUser;
    if (!hasAnyPermission(user, permissions)) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: permissions,
        message: 'Contact your administrator for access'
      });
      return;
    }

    next();
  };
}

/**
 * Express-style middleware: require ALL of the specified permissions.
 */
export function requireAllPermissions(...permissions: string[]) {
  return (req: RBACRequest, res: RBACResponse, next: () => void) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = req.user as any as AdminUser;
    if (!hasAllPermissions(user, permissions)) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: permissions,
        message: 'Contact your administrator for access'
      });
      return;
    }

    next();
  };
}

/**
 * Express-style middleware: require a specific role (or higher).
 * Role hierarchy: SUPER_ADMIN > ADMINISTRATOR > other roles
 */
export function requireRole(...roles: string[]) {
  return (req: RBACRequest, res: RBACResponse, next: () => void) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Insufficient role',
        required: roles,
        current: req.user.role,
        message: 'Contact your administrator for access'
      });
      return;
    }

    next();
  };
}

/**
 * Inline permission check for use in route handlers (non-middleware pattern).
 * Returns true if allowed, false if not (and sends 403 response).
 *
 * Usage:
 *   if (!checkPermission(req, res, ADMIN_VIEW_USERS)) return;
 */
export function checkPermission(req: RBACRequest, res: RBACResponse, permission: string): boolean {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }

  const user = req.user as any as AdminUser;
  if (!hasPermission(user, permission)) {
    res.status(403).json({
      error: 'Insufficient permissions',
      required: permission,
      message: 'Contact your administrator for access'
    });
    return false;
  }

  return true;
}
