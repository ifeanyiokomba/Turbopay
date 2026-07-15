# TurboPay API Documentation

## Authentication

All protected routes require either:
- `tp_session` cookie (browser flow)
- `Authorization: Bearer <token>` header (iframe/API flow)

### POST /api/auth/register
Create a new user account.

**Body:**
```json
{
  "fullName": "John Doe",
  "email": "john@example.com",
  "phone": "+2348012345678",
  "password": "SecurePass123",
  "referralCode": "ABC123" // optional
}
```

**Response:** `{ data: { id, email, ... } }`

### POST /api/auth/login
Authenticate with email/phone/username + password.

**Body:**
```json
{
  "identifier": "john@example.com",
  "password": "SecurePass123"
}
```

**Response:** `{ data: { id, sessionToken, refreshToken, ... } }`

### POST /api/auth/passkey/authenticate/options
Generate WebAuthn authentication options.

**Body:** `{ "identifier": "john@example.com" }` (optional)

**Response:** `{ data: { challenge, rpID, allowCredentials, ... } }`

### POST /api/auth/passkey/authenticate/verify
Verify passkey authentication.

**Body:**
```json
{
  "authenticationResponse": { ... },
  "challengeId": "abc123"
}
```

---

## Wallet

### GET /api/wallet
Get wallet balance and details.

**Response:**
```json
{
  "data": {
    "balanceKobo": 500000,
    "ledgerBalanceKobo": 500000,
    "currency": "NGN",
    "status": "ACTIVE"
  }
}
```

---

## International Payments

### GET /api/intl/quote
Get FX quote for currency conversion.

**Query:** `?from=USD&to=NGN&amountMinor=100000`

**Response:**
```json
{
  "data": {
    "from": "USD",
    "to": "NGN",
    "rate": 1485.50,
    "sourceAmountMinor": 100000,
    "destinationAmountMinor": 148550,
    "platformFeeMinor": 500
  }
}
```

### POST /api/intl/send
Send outbound international transfer.

**Body:**
```json
{
  "sourceCurrency": "NGN",
  "destinationCurrency": "USD",
  "amountMinor": 500000,
  "beneficiary": {
    "name": "John Smith",
    "account": "1234567890",
    "bank": "Chase",
    "country": "US"
  },
  "purpose": "Family support",
  "pin": "1234"
}
```

**Response:**
```json
{
  "data": {
    "transactionId": "...",
    "reference": "INTL-XXXX",
    "quotedRate": 1485.50,
    "destinationAmountMinor": 3365,
    "feesMinor": 5000
  }
}
```

---

## BillSwift

### POST /api/billswift/pay
Pay a bill via BillSwift.

**Body:**
```json
{
  "productCode": "IKEDC-PREPAID",
  "customer": "1234567890",
  "customerName": "John Doe",
  "productName": "Ikeja Electric Prepaid",
  "category": "ELECTRICITY",
  "amountNaira": 5000,
  "meterType": "PREPAID",
  "pin": "1234"
}
```

**Response:**
```json
{
  "data": {
    "ok": true,
    "reference": "BS-XXXX",
    "providerRef": "...",
    "newBalanceKobo": 450000
  }
}
```

---

## Savings

### POST /api/savings
Create a new savings product.

**Body:**
```json
{
  "name": "My Emergency Fund",
  "type": "GOAL",
  "targetAmountKobo": 10000000,
  "interestRateBps": 500
}
```

### POST /api/savings/[id]/deposit
Deposit into savings.

**Body:** `{ "amountKobo": 50000 }`

---

## Investments

### POST /api/investments/[id]/invest
Invest in a product.

**Body:** `{ "amountKobo": 100000 }`

### POST /api/investments/[id]/liquidate
Liquidate an investment.

**Response:**
```json
{
  "data": {
    "liquidated": true,
    "principalKobo": 100000,
    "returnKobo": 5000,
    "totalCreditedKobo": 105000
  }
}
```

---

## Virtual Cards

### POST /api/virtual-cards/[id]/fund
Fund a virtual card from wallet.

**Body:** `{ "amountKobo": 50000 }`

### POST /api/virtual-cards/[id]/reveal
Reveal card details (PAN, CVV).

**Response:**
```json
{
  "data": {
    "pan": "4388431234567890",
    "cvv": "123",
    "expiryMonth": 12,
    "expiryYear": 2029
  }
}
```

---

## Referrals

### GET /api/referrals
Get or create referral code.

**Response:**
```json
{
  "data": {
    "code": "JOHN1234",
    "link": "https://turbopay.ng/r/JOHN1234"
  }
}
```

### POST /api/referrals/lookup
Look up a referral by code.

**Body:** `{ "code": "JOHN1234" }`

---

## Admin Analytics

### GET /api/admin/analytics
Get dashboard analytics.

**Query:** `?from=2026-01-01&to=2026-07-01&section=user-growth`

**Sections:** `user-growth`, `transaction-volume`, `revenue`, `wallets`, `providers`, `kyc`, `support`, `aml`

---

## Health Check

### GET /api/health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-07-04T12:00:00Z",
  "checks": {
    "database": { "status": "ok", "latencyMs": 5 },
    "memory": { "status": "ok", "latencyMs": 128 },
    "uptime": { "status": "ok", "latencyMs": 86400 }
  }
}
```
