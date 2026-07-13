# TurboPay Payment SDK

Unified payment SDK for multiple payment providers across Africa.

## Supported Providers

| Provider | Collections | Payouts | Bills | Countries |
|----------|-------------|---------|-------|-----------|
| **Flutterwave** | Card, Bank, USSD, MoMo, QR | Bank, MoMo, Bulk | - | 13+ |
| **Paystack** | Card, Bank, USSD, QR | Bank, Bulk | - | 4 |
| **Monnify** | Bank | Bank, Bulk | - | 1 |
| **Onafriq** | Bank, USSD, MoMo, QR | Bank, MoMo, Bulk | Airtime, Data | 35+ |
| **Remita** | Bank | Bank, Bulk | All VAS | 1 |
| **Quickteller** | Card, Bank, USSD, QR | Bank, Bulk | All VAS | 1 |

## Installation

```bash
npm install @turbopay/payment-sdk
```

## Quick Start

```typescript
import { UnifiedPaymentService } from '@turbopay/payment-sdk';

// Initialize service
const service = new UnifiedPaymentService({
  environment: 'sandbox'
});

// Register providers
await service.registerFlutterwave({
  client_id: 'your-client-id',
  client_secret: 'your-client-secret'
});

await service.registerPaystack({
  secret_key: 'your-secret-key',
  public_key: 'your-public-key'
});

// Initialize payment
const payment = await service.initializePayment({
  amount: 5000,
  currency: 'NGN',
  reference: 'order_123',
  customer: {
    email: 'customer@example.com',
    name: { first: 'John', last: 'Doe' }
  },
  redirect_url: 'https://example.com/callback'
}, 'NG', 'NGN');

console.log('Payment URL:', payment.authorization?.redirect_url);
```

## Provider Selection

The SDK automatically selects the best provider based on:
- **Capability**: Does the provider support the operation?
- **Health**: Is the provider currently healthy?
- **Latency**: How fast is the provider responding?
- **Success Rate**: Historical success rate

```typescript
// Manual provider selection
const provider = service.selectProvider('card_collection', 'NG', 'NGN');

// With preferred provider
const provider = service.selectProvider(
  'card_collection',
  'NG',
  'NGN',
  'paystack'
);
```

## Collections

### Card Payment

```typescript
const payment = await service.initializePayment({
  amount: 5000,
  currency: 'NGN',
  reference: 'order_123',
  customer: {
    email: 'customer@example.com',
    name: { first: 'John', last: 'Doe' }
  },
  payment_method: {
    type: 'card',
    encrypted_card_number: '...',
    encrypted_expiry_month: '...',
    encrypted_expiry_year: '...',
    encrypted_cvv: '...',
    nonce: '...'
  }
}, 'NG', 'NGN');
```

### Bank Transfer

```typescript
// Create virtual account for bank transfer
const va = await service.createVirtualAccount({
  reference: 'va_123',
  amount: 10000,
  currency: 'NGN',
  account_type: 'dynamic',
  narration: 'Payment for order',
  bvn: '12345678901'
}, 'NG', 'NGN');

console.log('Account Number:', va.account_number);
console.log('Bank:', va.bank_name);
```

### Mobile Money

```typescript
const payment = await service.initializePayment({
  amount: 100,
  currency: 'GHS',
  reference: 'momo_123',
  customer: {
    email: 'customer@example.com'
  },
  payment_method: {
    type: 'mobile_money',
    country_code: '233',
    network: 'MTN',
    phone_number: '9012345678'
  }
}, 'GH', 'GHS');
```

## Payouts

### Single Transfer

```typescript
const transfer = await service.createTransfer({
  amount: 15000,
  currency: 'NGN',
  reference: 'trf_123',
  narration: 'Salary payment',
  recipient: {
    type: 'bank',
    bank: {
      code: '044',
      account_number: '0690000031'
    },
    name: { first: 'John', last: 'Doe' }
  }
}, 'NG', 'NGN');
```

### Bulk Transfer

```typescript
const bulk = await service.createBulkTransfers([
  {
    amount: 5000,
    currency: 'NGN',
    reference: 'bulk_1',
    recipient: {
      type: 'bank',
      bank: { code: '044', account_number: '0690000031' }
    }
  },
  {
    amount: 10000,
    currency: 'NGN',
    reference: 'bulk_2',
    recipient: {
      type: 'bank',
      bank: { code: '035', account_number: '0690000032' }
    }
  }
], 'NG', 'NGN');
```

### Mobile Money Transfer

```typescript
const transfer = await service.createTransfer({
  amount: 100,
  currency: 'GHS',
  reference: 'momo_trf_123',
  recipient: {
    type: 'mobile_money',
    mobile_money: {
      network: 'MTN',
      phone_number: '9012345678',
      country_code: '233'
    }
  }
}, 'GH', 'GHS');
```

## Bill Payments

```typescript
// List billers
const billers = await service.listBillers();

// Pay bill
const payment = await service.payBill({
  biller_id: '104',
  item_id: '10401',
  amount: 5000,
  customer_reference: '1234567890',
  customer_name: 'John Doe'
});
```

## Webhooks

```typescript
// Express.js example
app.post('/webhooks/flutterwave', (req, res) => {
  const signature = req.headers['x-flutterwave-signature'];
  
  if (!service.validateWebhook('flutterwave', req.body, signature)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }
  
  const event = service.parseWebhookEvent('flutterwave', req.body);
  
  switch (event.event) {
    case 'payment.success':
      // Handle successful payment
      break;
    case 'payment.failed':
      // Handle failed payment
      break;
  }
  
  res.status(200).json({ received: true });
});
```

## Configuration

### Router Config

```typescript
const service = new UnifiedPaymentService({
  environment: 'production',
  router_config: {
    health_check_interval: 60000,
    max_retries: 3,
    retry_delay: 1000,
    failover_enabled: true,
    circuit_breaker_threshold: 5,
    circuit_breaker_timeout: 300000
  }
});
```

## Error Handling

```typescript
import {
  ProviderUnavailableError,
  PaymentFailedError,
  AuthenticationError,
  RateLimitError
} from '@turbopay/payment-sdk';

try {
  const payment = await service.initializePayment(request, 'NG', 'NGN');
} catch (error) {
  if (error instanceof ProviderUnavailableError) {
    console.log('No providers available');
  } else if (error instanceof PaymentFailedError) {
    console.log(`Payment failed at ${error.provider}: ${error.provider_error}`);
  } else if (error instanceof AuthenticationError) {
    console.log('Authentication failed');
  } else if (error instanceof RateLimitError) {
    console.log(`Rate limited, retry after ${error.retry_after}s`);
  }
}
```

## License

MIT
