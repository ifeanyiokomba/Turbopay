// TurboPay Provider Integration Example
// Shows how to use the unified interface with all providers

import {
  ProviderRouter,
  ProviderAdapter,
  ProviderName,
  PaymentOperation,
  UnifiedPaymentRequest,
  UnifiedTransferRequest,
  VirtualAccountRequest,
  BillPaymentRequest,
  RouterConfig
} from './unified-provider-interface';
import { FlutterwaveAdapter, FlutterwaveConfig } from './flutterwave-adapter';
// Import other adapters as they are implemented
// import { PaystackAdapter } from './paystack-adapter';
// import { MonnifyAdapter } from './monnify-adapter';
// import { OnafriqAdapter } from './onafriq-adapter';
// import { RemitaAdapter } from './remita-adapter';
// import { QuicktellerAdapter } from './quickteller-adapter';

// =============================================================================
// CONFIGURATION
// =============================================================================

const routerConfig: RouterConfig = {
  health_check_interval: 60000, // 1 minute
  max_retries: 3,
  retry_delay: 1000, // 1 second
  failover_enabled: true,
  circuit_breaker_threshold: 5,
  circuit_breaker_timeout: 300000 // 5 minutes
};

// =============================================================================
// INITIALIZE PROVIDERS
// =============================================================================

async function initializeProviders(): Promise<ProviderRouter> {
  const router = new ProviderRouter(routerConfig);

  // Initialize Flutterwave
  const flutterwaveConfig: FlutterwaveConfig = {
    client_id: process.env.FLW_CLIENT_ID!,
    client_secret: process.env.FLW_CLIENT_SECRET!,
    encryption_key: process.env.FLW_ENCRYPTION_KEY,
    public_key: process.env.FLW_PUBLIC_KEY,
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
    webhook_secret: process.env.FLW_WEBHOOK_SECRET
  };
  const flutterwave = new FlutterwaveAdapter(flutterwaveConfig);
  await flutterwave.authenticate();
  router.registerProvider(flutterwave);

  // Initialize Paystack (example - implement adapter first)
  // const paystackConfig = {
  //   secret_key: process.env.PAYSTACK_SECRET_KEY!,
  //   public_key: process.env.PAYSTACK_PUBLIC_KEY!,
  //   environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'
  // };
  // const paystack = new PaystackAdapter(paystackConfig);
  // router.registerProvider(paystack);

  // Initialize other providers...
  // const monnify = new MonnifyAdapter({ ... });
  // router.registerProvider(monnify);

  // const onafriq = new OnafriqAdapter({ ... });
  // router.registerProvider(onafriq);

  // const remita = new RemitaAdapter({ ... });
  // router.registerProvider(remita);

  // const quickteller = new QuicktellerAdapter({ ... });
  // router.registerProvider(quickteller);

  return router;
}

// =============================================================================
// USAGE EXAMPLES
// =============================================================================

async function main() {
  const router = await initializeProviders();

  // Example 1: Card Payment
  await cardPaymentExample(router);

  // Example 2: Bank Transfer Collection
  await bankTransferCollectionExample(router);

  // Example 3: Transfer/Payout
  await transferExample(router);

  // Example 4: Virtual Account
  await virtualAccountExample(router);

  // Example 5: Bill Payment
  await billPaymentExample(router);

  // Example 6: Cross-border Payment
  await crossBorderPaymentExample(router);
}

// =============================================================================
// CARD PAYMENT EXAMPLE
// =============================================================================

async function cardPaymentExample(router: ProviderRouter) {
  console.log('\n=== Card Payment Example ===');

  // Select best provider for card payment in Nigeria
  const provider = router.selectProvider(
    'card_collection',
    'NG',
    'NGN'
  );

  console.log(`Selected provider: ${provider.name}`);

  const paymentRequest: UnifiedPaymentRequest = {
    amount: 5000,
    currency: 'NGN',
    reference: `ref_${Date.now()}`,
    description: 'Card payment for order #123',
    redirect_url: 'https://example.com/callback',
    customer: {
      email: 'customer@example.com',
      name: {
        first: 'John',
        last: 'Doe'
      },
      phone: {
        country_code: '234',
        number: '9012345678'
      }
    },
    payment_method: {
      type: 'card',
      encrypted_card_number: '{{encrypted_card_number}}',
      encrypted_expiry_month: '{{encrypted_expiry_month}}',
      encrypted_expiry_year: '{{encrypted_expiry_year}}',
      encrypted_cvv: '{{encrypted_cvv}}',
      nonce: '{{nonce}}'
    },
    metadata: {
      order_id: '123',
      product: 'Premium Plan'
    }
  };

  try {
    const result = await router.executeWithFailover(
      'card_collection',
      'NG',
      'NGN',
      async (adapter) => {
        return adapter.initializePayment(paymentRequest);
      }
    );

    console.log('Payment initiated:', {
      id: result.id,
      reference: result.reference,
      status: result.status,
      provider: result.provider,
      redirect_url: result.authorization?.redirect_url
    });
  } catch (error) {
    console.error('Payment failed:', error);
  }
}

// =============================================================================
// BANK TRANSFER COLLECTION EXAMPLE
// =============================================================================

async function bankTransferCollectionExample(router: ProviderRouter) {
  console.log('\n=== Bank Transfer Collection Example ===');

  const provider = router.selectProvider(
    'bank_transfer_collection',
    'NG',
    'NGN'
  );

  console.log(`Selected provider: ${provider.name}`);

  // For bank transfer, we typically create a virtual account
  if (provider.getCapabilities().virtual_accounts.dynamic) {
    const vaRequest: VirtualAccountRequest = {
      reference: `va_${Date.now()}`,
      customer: {
        email: 'customer@example.com',
        name: {
          first: 'John',
          last: 'Doe'
        }
      },
      amount: 10000,
      currency: 'NGN',
      account_type: 'dynamic',
      narration: 'Payment for order #456',
      bvn: '12345678901',
      expiry: 3600 // 1 hour
    };

    try {
      const result = await router.executeWithFailover(
        'virtual_account',
        'NG',
        'NGN',
        async (adapter) => {
          return adapter.createVirtualAccount(vaRequest);
        }
      );

      console.log('Virtual account created:', {
        id: result.id,
        account_number: result.account_number,
        bank_name: result.bank_name,
        expires_at: result.expires_at
      });
    } catch (error) {
      console.error('Virtual account creation failed:', error);
    }
  }
}

// =============================================================================
// TRANSFER/PAYOUT EXAMPLE
// =============================================================================

async function transferExample(router: ProviderRouter) {
  console.log('\n=== Transfer/Payout Example ===');

  const provider = router.selectProvider(
    'bank_transfer_payout',
    'NG',
    'NGN'
  );

  console.log(`Selected provider: ${provider.name}`);

  const transferRequest: UnifiedTransferRequest = {
    amount: 15000,
    currency: 'NGN',
    reference: `trf_${Date.now()}`,
    narration: 'Salary payment',
    recipient: {
      type: 'bank',
      bank: {
        code: '044', // Access Bank
        account_number: '0690000031',
        name: 'John Doe'
      },
      name: {
        first: 'John',
        last: 'Doe'
      }
    },
    metadata: {
      category: 'salary',
      month: 'January'
    }
  };

  try {
    const result = await router.executeWithFailover(
      'bank_transfer_payout',
      'NG',
      'NGN',
      async (adapter) => {
        return adapter.createTransfer(transferRequest);
      }
    );

    console.log('Transfer initiated:', {
      id: result.id,
      reference: result.reference,
      status: result.status,
      provider: result.provider
    });
  } catch (error) {
    console.error('Transfer failed:', error);
  }
}

// =============================================================================
// VIRTUAL ACCOUNT EXAMPLE
// =============================================================================

async function virtualAccountExample(router: ProviderRouter) {
  console.log('\n=== Virtual Account Example ===');

  const provider = router.selectProvider(
    'virtual_account',
    'NG',
    'NGN'
  );

  console.log(`Selected provider: ${provider.name}`);

  // Create customer first
  const customer = await provider.createCustomer({
    email: 'merchant@example.com',
    name: {
      first: 'Merchant',
      last: 'Business'
    },
    bvn: '12345678901'
  });

  console.log('Customer created:', customer.id);

  // Create static virtual account for recurring payments
  const vaRequest: VirtualAccountRequest = {
    reference: `va_static_${Date.now()}`,
    customer_id: customer.id,
    amount: 0, // Static accounts have amount 0
    currency: 'NGN',
    account_type: 'static',
    narration: 'Business collection account',
    bvn: '12345678901'
  };

  try {
    const result = await provider.createVirtualAccount(vaRequest);

    console.log('Static virtual account created:', {
      id: result.id,
      account_number: result.account_number,
      bank_name: result.bank_name,
      account_type: result.account_type
    });
  } catch (error) {
    console.error('Virtual account creation failed:', error);
  }
}

// =============================================================================
// BILL PAYMENT EXAMPLE
// =============================================================================

async function billPaymentExample(router: ProviderRouter) {
  console.log('\n=== Bill Payment Example ===');

  // For bill payments, we need a provider that supports it
  const provider = router.selectProvider(
    'airtime',
    'NG',
    'NGN'
  );

  console.log(`Selected provider: ${provider.name}`);

  // Check if provider supports bill payments
  const capabilities = provider.getCapabilities();
  if (!capabilities.bills.airtime) {
    console.log('Selected provider does not support airtime payments');
    return;
  }

  // List available billers
  try {
    const billers = await provider.listBillers();
    console.log(`Found ${billers.length} billers`);

    if (billers.length > 0) {
      const airtimeBiller = billers.find(b => b.name.toLowerCase().includes('airtime'));
      if (airtimeBiller) {
        console.log('Airtime biller:', airtimeBiller);
      }
    }
  } catch (error) {
    console.error('Failed to list billers:', error);
  }
}

// =============================================================================
// CROSS-BORDER PAYMENT EXAMPLE
// =============================================================================

async function crossBorderPaymentExample(router: ProviderRouter) {
  console.log('\n=== Cross-border Payment Example ===');

  // Select provider for Ghana payment
  const provider = router.selectProvider(
    'mobile_money_collection',
    'GH',
    'GHS'
  );

  console.log(`Selected provider for Ghana: ${provider.name}`);

  const paymentRequest: UnifiedPaymentRequest = {
    amount: 100,
    currency: 'GHS',
    reference: `intl_${Date.now()}`,
    description: 'International payment from Nigeria',
    redirect_url: 'https://example.com/callback',
    customer: {
      email: 'ghana_customer@example.com',
      name: {
        first: 'Kwame',
        last: 'Asante'
      },
      phone: {
        country_code: '233',
        number: '9012345678'
      }
    },
    payment_method: {
      type: 'mobile_money',
      country_code: '233',
      network: 'MTN',
      phone_number: '9012345678'
    }
  };

  try {
    const result = await router.executeWithFailover(
      'mobile_money_collection',
      'GH',
      'GHS',
      async (adapter) => {
        return adapter.initializePayment(paymentRequest);
      }
    );

    console.log('International payment initiated:', {
      id: result.id,
      reference: result.reference,
      status: result.status,
      provider: result.provider
    });
  } catch (error) {
    console.error('International payment failed:', error);
  }
}

// =============================================================================
// WEBHOOK HANDLING EXAMPLE
// =============================================================================

async function handleWebhook(
  router: ProviderRouter,
  providerName: ProviderName,
  payload: any,
  signature: string
) {
  const provider = router.getProvider(providerName);

  if (!provider) {
    console.error(`Unknown provider: ${providerName}`);
    return;
  }

  // Validate webhook
  if (!provider.validateWebhook(payload, signature)) {
    console.error('Invalid webhook signature');
    return;
  }

  // Parse webhook event
  const event = provider.parseWebhookEvent(payload);

  console.log('Webhook received:', {
    event: event.event,
    provider: event.provider,
    transaction_id: event.data.id,
    status: event.data.status
  });

  // Handle event based on type
  switch (event.event) {
    case 'payment.success':
      await handlePaymentSuccess(event.data);
      break;
    case 'payment.failed':
      await handlePaymentFailed(event.data);
      break;
    case 'transfer.success':
      await handleTransferSuccess(event.data);
      break;
    case 'transfer.failed':
      await handleTransferFailed(event.data);
      break;
    default:
      console.log('Unhandled event type:', event.event);
  }
}

async function handlePaymentSuccess(data: any) {
  console.log('Processing successful payment:', data.id);
  // Update order status in database
  // Send confirmation to customer
  // Trigger fulfillment
}

async function handlePaymentFailed(data: any) {
  console.log('Processing failed payment:', data.id);
  // Update order status
  // Notify customer
  // Log failure reason
}

async function handleTransferSuccess(data: any) {
  console.log('Processing successful transfer:', data.id);
  // Update transfer status
  // Notify recipient
}

async function handleTransferFailed(data: any) {
  console.log('Processing failed transfer:', data.id);
  // Update transfer status
  // Initiate refund if needed
  // Notify merchant
}

// =============================================================================
// EXPRESS.JS WEBHOOK ROUTE EXAMPLE
// =============================================================================

/*
import express from 'express';
const app = express();

app.post('/webhooks/flutterwave', express.json(), async (req, res) => {
  const signature = req.headers['x-flutterwave-signature'] as string;
  
  await handleWebhook(router, 'flutterwave', req.body, signature);
  
  res.status(200).json({ received: true });
});

app.post('/webhooks/paystack', express.json(), async (req, res) => {
  const signature = req.headers['x-paystack-signature'] as string;
  
  await handleWebhook(router, 'paystack', req.body, signature);
  
  res.status(200).json({ received: true });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
*/

// =============================================================================
// RUN EXAMPLE
// =============================================================================

main().catch(console.error);
