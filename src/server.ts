// TurboPay Server Entry Point
// HTTP server that serves the API routes
// This is the file you run to start TurboPay

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
  }
};

// =============================================================================
// SIMPLE HTTP SERVER
// =============================================================================

function createServer(turbopay: ReturnType<typeof createTurboPay>) {
  const http = require('http');
  const url = require('url');

  const server = http.createServer(async (req: any, res: any) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    const method = req.method;
    const query = parsedUrl.query;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    // Handle preflight
    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Parse body
    let body = '';
    req.on('data', (chunk: any) => { body += chunk; });
    req.on('end', async () => {
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
  });

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
  server.listen(config.port, config.host, () => {
    console.log('='.repeat(60));
    console.log(`  Server running on http://${config.host}:${config.port}`);
    console.log(`  Environment: ${config.environment}`);
    console.log(`  Admin: Admin@okomba.com / Admin@123456`);
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
