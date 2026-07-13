// TurboPay API Middleware
// Authentication, rate limiting, error handling, and request validation

import { AdminAuthService } from '../admin/auth/auth.service';
import { CustomerAuthService } from '../auth/customer-auth.service';

// =============================================================================
// TYPES
// =============================================================================

export interface Request {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: any;
  query?: Record<string, string>;
  params?: Record<string, string>;
  user?: any;
}

export interface Response {
  status(code: number): Response;
  json(data: any): void;
  send(data: any): void;
  header(name: string, value: string): Response;
}

export interface NextFunction {
  (): void;
}

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================

export function adminAuthMiddleware(adminAuth: AdminAuthService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ error: 'Authorization token required' });
      return;
    }

    const user = adminAuth.validateToken(token);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    req.user = user;
    next();
  };
}

export function customerAuthMiddleware(customerAuth: CustomerAuthService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ error: 'Authorization token required' });
      return;
    }

    const user = customerAuth.validateToken(token);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    req.user = user;
    next();
  };
}

// =============================================================================
// RATE LIMITING
// =============================================================================

export function rateLimitMiddleware(maxRequests: number = 100, windowMs: number = 60000) {
  const requests = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['x-api-key'] || req.headers['x-forwarded-for'] || 'default';
    const now = Date.now();

    const record = requests.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }

    record.count++;
    requests.set(key, record);

    if (record.count > maxRequests) {
      res.status(429).json({ error: 'Rate limit exceeded', retry_after: Math.ceil((record.resetAt - now) / 1000) });
      return;
    }

    res.header('X-RateLimit-Limit', maxRequests.toString());
    res.header('X-RateLimit-Remaining', (maxRequests - record.count).toString());
    res.header('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000).toString());

    next();
  };
}

// =============================================================================
// ERROR HANDLING
// =============================================================================

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error(`[API Error] ${req.method} ${req.path}:`, err);

  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  res.status(status).json({
    error: message,
    code: err.code || 'INTERNAL_ERROR',
    timestamp: new Date().toISOString()
  });
}

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

export function validateBody(requiredFields: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.body) {
      res.status(400).json({ error: 'Request body is required' });
      return;
    }

    const missing = requiredFields.filter(field => req.body[field] === undefined);
    if (missing.length > 0) {
      res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
      return;
    }

    next();
  };
}

// =============================================================================
// LOGGING
// =============================================================================

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  console.log(`[API] ${req.method} ${req.path} - started`);
  next();
}
