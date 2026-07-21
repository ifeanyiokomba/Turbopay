// TurboPay Server Entry Point
// HTTP/HTTPS server that serves the API routes
// This is the file you run to start TurboPay

// Load .env file before anything else
import * as fs from 'fs';
import * as path from 'path';

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    console.log('[Server] Loaded environment from .env');
  }
}

loadEnv();

import { createTurboPay, TurboPayConfig } from './main';

// =============================================================================
// CONFIGURATION
// =============================================================================

const config: TurboPayConfig = {
  port: parseInt(process.env.PORT || '3000'),
  host: process.env.HOST || '0.0.0.0',
  environment: (process.env.NODE_ENV as 'sandbox' | 'production') || 'sandbox',
  providers: {
    // Paystack
    paystack: process.env.PAYSTACK_SECRET_KEY ? {
      secret_key: process.env.PAYSTACK_SECRET_KEY,
      public_key: process.env.PAYSTACK_PUBLIC_KEY || '',
      webhook_secret: process.env.PAYSTACK_WEBHOOK_SECRET
    } : undefined,

    // Flutterwave v4
    flutterwave: process.env.FLUTTERWAVE_CLIENT_ID ? {
      client_id: process.env.FLUTTERWAVE_CLIENT_ID!,
      client_secret: process.env.FLUTTERWAVE_CLIENT_SECRET || '',
      encryption_key: process.env.FLUTTERWAVE_ENCRYPTION_KEY,
      public_key: process.env.FLUTTERWAVE_PUBLIC_KEY,
      webhook_secret: process.env.FLUTTERWAVE_WEBHOOK_SECRET
    } : undefined,

    // Flutterwave v3 (for splits/chargebacks)
    flutterwave_v3: process.env.FLUTTERWAVE_V3_SECRET_KEY ? {
      secret_key: process.env.FLUTTERWAVE_V3_SECRET_KEY,
      public_key: process.env.FLUTTERWAVE_V3_PUBLIC_KEY,
      webhook_secret: process.env.FLUTTERWAVE_V3_WEBHOOK_SECRET
    } : undefined,

    // Monnify
    monnify: process.env.MONNIFY_API_KEY ? {
      api_key: process.env.MONNIFY_API_KEY!,
      api_secret: process.env.MONNIFY_API_SECRET || '',
      contract_code: process.env.MONNIFY_CONTRACT_CODE || '',
      webhook_secret: process.env.MONNIFY_WEBHOOK_SECRET
    } : undefined,

    // Onafriq
    onafriq: process.env.ONAFRIQ_CLIENT_ID ? {
      client_id: process.env.ONAFRIQ_CLIENT_ID!,
      client_secret: process.env.ONAFRIQ_CLIENT_SECRET || '',
      api_key: process.env.ONAFRIQ_API_KEY,
      webhook_secret: process.env.ONAFRIQ_WEBHOOK_SECRET
    } : undefined,

    // Remita
    remita: process.env.REMITA_API_KEY ? {
      api_key: process.env.REMITA_API_KEY!,
      api_secret: process.env.REMITA_API_SECRET || '',
      merchant_id: process.env.REMITA_MERCHANT_ID || '',
      webhook_secret: process.env.REMITA_WEBHOOK_SECRET
    } : undefined,

    // Quickteller
    quickteller: process.env.QUICKTELLER_CLIENT_ID ? {
      client_id: process.env.QUICKTELLER_CLIENT_ID!,
      client_secret: process.env.QUICKTELLER_CLIENT_SECRET || '',
      merchant_code: process.env.QUICKTELLER_MERCHANT_CODE || '',
      terminal_id: process.env.QUICKTELLER_TERMINAL_ID,
      webhook_secret: process.env.QUICKTELLER_WEBHOOK_SECRET
    } : undefined,

    // Mobile Money Providers
    smartcash: process.env.SMARTCASH_CLIENT_ID ? {
      client_id: process.env.SMARTCASH_CLIENT_ID!,
      client_secret: process.env.SMARTCASH_CLIENT_SECRET || '',
      shortcode: process.env.SMARTCASH_SHORTCODE,
      webhook_secret: process.env.SMARTCASH_WEBHOOK_SECRET
    } : undefined,

    airtel_money: process.env.AIRTEL_MONEY_CLIENT_ID ? {
      client_id: process.env.AIRTEL_MONEY_CLIENT_ID!,
      client_secret: process.env.AIRTEL_MONEY_CLIENT_SECRET || '',
      api_key: process.env.AIRTEL_MONEY_API_KEY,
      webhook_secret: process.env.AIRTEL_MONEY_WEBHOOK_SECRET
    } : undefined,

    mtn_momo: process.env.MTN_MOMO_API_KEY ? {
      api_key: process.env.MTN_MOMO_API_KEY!,
      api_secret: process.env.MTN_MOMO_API_SECRET || '',
      subscription_key: process.env.MTN_MOMO_SUBSCRIPTION_KEY || '',
      disbursement_subscription_key: process.env.MTN_MOMO_DISBURSEMENT_SUB_KEY,
      api_user: process.env.MTN_MOMO_API_USER,
      callback_url: process.env.MTN_MOMO_CALLBACK_URL,
      target_environment: process.env.MTN_MOMO_TARGET_ENVIRONMENT
    } : undefined,

    mpesa: process.env.MPESA_CONSUMER_KEY ? {
      consumer_key: process.env.MPESA_CONSUMER_KEY!,
      consumer_secret: process.env.MPESA_CONSUMER_SECRET || '',
      shortcode: process.env.MPESA_SHORTCODE || '',
      passkey: process.env.MPESA_PASSKEY || '',
      callback_url: process.env.MPESA_CALLBACK_URL,
      initiator_name: process.env.MPESA_INITIATOR_NAME,
      security_credential: process.env.MPESA_SECURITY_CREDENTIAL
    } : undefined,

    paga: process.env.PAGA_PRINCIPAL ? {
      principal: process.env.PAGA_PRINCIPAL!,
      credentials: process.env.PAGA_CREDENTIALS || '',
      hash_key: process.env.PAGA_HASH_KEY || '',
      api_key: process.env.PAGA_API_KEY
    } : undefined,
  },
  otp: {
    api_key: process.env.OTP_API_KEY || '',
    sender_id: process.env.OTP_SENDER_ID || 'TurboPay'
  },
  jwt_secret: process.env.JWT_SECRET
};

// =============================================================================
// SERVER
// =============================================================================

function createServer(turbopay: ReturnType<typeof createTurboPay>) {
  const http = require('http');
  const https = require('https');
  const fs = require('fs');
  const url = require('url');

  // Rate limiting state
  const rateLimits = new Map<string, { count: number; resetAt: number }>();
  const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '100');
  const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');
  const AUTH_RATE_LIMIT_MAX = parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10');

  function checkRateLimit(key: string, max: number): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const record = rateLimits.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + RATE_LIMIT_WINDOW_MS;
    }
    record.count++;
    rateLimits.set(key, record);
    return {
      allowed: record.count <= max,
      remaining: Math.max(0, max - record.count),
      resetAt: record.resetAt
    };
  }

  // Request handler — shared by HTTP and HTTPS
  async function handleRequest(req: any, res: any): Promise<void> {
    // Generate unique request ID for audit trail
    const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    const method = req.method;
    const query = parsedUrl.query;

    // Rate limiting — per IP
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const isAuthRoute = path.startsWith('/api/v1/auth/');
    const rateLimitMax = isAuthRoute ? AUTH_RATE_LIMIT_MAX : RATE_LIMIT_MAX;
    const rl = checkRateLimit(clientIp, rateLimitMax);
    res.setHeader('X-RateLimit-Limit', rateLimitMax.toString());
    res.setHeader('X-RateLimit-Remaining', rl.remaining.toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(rl.resetAt / 1000).toString());
    if (!rl.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded', retry_after: Math.ceil((rl.resetAt - Date.now()) / 1000) }));
      return;
    }

    // CORS headers — restrict to configured origins
    const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').filter(Boolean);
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    // Note: Wildcard CORS ('*') is NEVER allowed — even in sandbox.
    // Use CORS_ALLOWED_ORIGINS to explicitly permit origins.
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    // Handle preflight
    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Request body size limit (1MB)
    const MAX_BODY_SIZE = 1024 * 1024;
    let body = '';
    let bodyTooLarge = false;
    req.on('data', (chunk: any) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        bodyTooLarge = true;
        req.destroy();
      }
    });
    req.on('end', async () => {
      if (bodyTooLarge) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large', max_bytes: MAX_BODY_SIZE }));
        return;
      }

      try {
        // Parse JSON body
        let parsedBody = null;
        if (body) {
          try {
            parsedBody = JSON.parse(body);
          } catch {
            parsedBody = body;
          }
        }

        // Build request object
        const request: any = {
          method,
          path,
          headers: req.headers,
          body: parsedBody,
          query,
          params: {}
        };

        // Build response object
        const response = {
          status(code: number) {
            res.writeHead(code, { 'Content-Type': 'application/json' });
            return response;
          },
          json(data: any) {
            res.end(JSON.stringify(data));
          },
          send(data: any) {
            res.end(data);
          },
          header(name: string, value: string) {
            res.setHeader(name, value);
            return response;
          },
          on(event: string, callback: any) {
            res.on(event, callback);
            return response;
          }
        };

        // Find matching route
        const routes = turbopay.routes.getRoutes();
        let matched = false;

        for (const route of routes) {
          const routePath = route.path;
          const routeMethod = route.method;

          // Simple path matching (convert :param to regex)
          const regexPath = routePath.replace(/:([^/]+)/g, '([^/]+)');
          const regex = new RegExp(`^${regexPath}$`);
          const match = path.match(regex);

          if (match && method === routeMethod) {
            // Extract params
            const paramNames = (routePath.match(/:([^/]+)/g) || []).map((p: string) => p.slice(1));
            paramNames.forEach((name: string, index: number) => {
              request.params[name] = match[index + 1];
            });

            // Enforce auth based on route declaration
            if (route.auth === 'admin') {
              const token = req.headers['authorization']?.replace('Bearer ', '');
              if (!token) {
                response.status(401).json({ error: 'Authorization token required' });
                matched = true;
                break;
              }
              const adminUser = turbopay.adminAuth.validateToken(token);
              if (!adminUser) {
                response.status(401).json({ error: 'Invalid or expired token' });
                matched = true;
                break;
              }
              if (adminUser.role !== 'master_admin' && adminUser.role !== 'admin') {
                response.status(403).json({ error: 'Admin access required' });
                matched = true;
                break;
              }
              request.user = adminUser;
            } else if (route.auth === 'customer') {
              const token = req.headers['authorization']?.replace('Bearer ', '');
              if (!token) {
                response.status(401).json({ error: 'Authorization token required' });
                matched = true;
                break;
              }
              const customerUser = turbopay.customerAuth.validateToken(token);
              if (!customerUser) {
                response.status(401).json({ error: 'Invalid or expired token' });
                matched = true;
                break;
              }
              request.user = customerUser;
            }

            // Validate required body fields for POST/PUT routes
            if (route.requiredBodyFields && (method === 'POST' || method === 'PUT')) {
              if (!parsedBody || typeof parsedBody !== 'object') {
                response.status(400).json({ error: 'Request body is required' });
                matched = true;
                break;
              }
              const missing = route.requiredBodyFields.filter((f: string) => parsedBody[f] === undefined);
              if (missing.length > 0) {
                response.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
                matched = true;
                break;
              }
            }

            // Execute handler
            await route.handler(request, response);
            matched = true;
            break;
          }
        }

        if (!matched) {
          // Check for health endpoint
          if (path === '/health' && method === 'GET') {
            const result = await turbopay.processor.healthCheck();
            response.json(result);
          } else if (path === '/' && method === 'GET') {
            response.json({
              name: 'TurboPay',
              version: '1.0.0',
              status: 'running',
              environment: config.environment,
              providers: turbopay.registry.getNames(),
              timestamp: new Date().toISOString()
            });
          } else {
            response.status(404).json({ error: 'Not found', path });
          }
        }
      } catch (error) {
        console.error('[Server] Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  }

  // Create HTTP or HTTPS server based on SSL config
  const sslCert = process.env.SSL_CERT_PATH;
  const sslKey = process.env.SSL_KEY_PATH;
  let server: any;
  if (sslCert && sslKey && fs.existsSync(sslCert) && fs.existsSync(sslKey)) {
    const options = { cert: fs.readFileSync(sslCert), key: fs.readFileSync(sslKey) };
    server = https.createServer(options, handleRequest);
    console.log('[Server] TLS enabled');
  } else {
    server = http.createServer(handleRequest);
    if (config.environment === 'production') {
      console.warn('[Server] WARNING: Running without TLS in production. Set SSL_CERT_PATH and SSL_KEY_PATH.');
    }
  }

  return server;
}

// =============================================================================
// START SERVER
// =============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('  TurboPay Payment Orchestration System');
  console.log('  Version 1.0.0');
  console.log('='.repeat(60));

  // Create TurboPay instance
  const turbopay = createTurboPay(config);

  // Start services
  await turbopay.start();

  // Create HTTP server
  const server = createServer(turbopay);

  // Start listening
  const protocol = process.env.SSL_CERT_PATH && process.env.SSL_KEY_PATH ? 'https' : 'http';
  server.listen(config.port, config.host, () => {
    console.log('='.repeat(60));
    console.log(`  Server running on ${protocol}://${config.host}:${config.port}`);
    console.log(`  Environment: ${config.environment}`);
    console.log('='.repeat(60));
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Server] Shutting down...');
    await turbopay.stop();
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Server] Shutting down...');
    await turbopay.stop();
    server.close();
    process.exit(0);
  });
}

// Run
main().catch(console.error);
