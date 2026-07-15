# Phase B — Regulatory/Partnership Status

**Status: PENDING EXTERNAL CONFIRMATION**
**Blocks: Phase E going live with real transfers (NOT sandbox build)**

---

## What the codebase confirms

Source: `src/lib/turbocore/providers/adapters/sandbox-intl.ts` (lines 15–34)

### Nigeria — Inbound (receiving international money)
- CBN Jan 2024 guidelines: fintech companies CANNOT hold an IMTO license directly
- TurboPay must partner with an already-licensed IMTO
- This is a business relationship, not a code gap
- The sandbox-intl adapter simulates this flow for architecture testing

### Nigeria — Outbound (sending money abroad)
- Runs through an Authorized Dealer bank under the CBN Foreign Exchange Manual
- Structurally different regulatory path from IMTO
- The codebase correctly separates these as two distinct contracts (`internationalTransfer` vs `internationalReceiving`)

### Non-Nigerian jurisdictions
- No licensing confirmation in the codebase
- Each jurisdiction (Ghana, Kenya, South Africa, UK, EU) has its own regulatory body and requirements

---

## Open questions requiring external verification

### 1. CBN guidance currency
- **Question:** Has CBN guidance shifted since January 2024? Are there new circulars on IMTO licensing or fintech participation in international transfers?
- **Action:** Check CBN website for 2024–2025 circulars on IMTO operations and FX manual updates

### 2. Provider licensing posture
- **Question:** Which of the following providers actually hold IMTO or Authorized Dealer bank status for Nigeria?
  - Monnify (embedded finance — likely NOT an IMTO)
  - Paystack (payments processor — has IMTO license for Ghana; Nigeria status unclear)
  - Flutterwave (payments processor — has IMTO license in some corridors)
  - Fincra (B2B payments — licensing status unknown)
  - Stripe (global — not an IMTO, but Stripe Connect may enable cross-border via partners)
- **Action:** Contact each provider's partnerships team or check their regulatory filings

### 3. IMTO partnership availability
- **Question:** Which licensed IMTOs are open to embedding their rails via API partnership (not white-label, but programmatic access)?
- **Known IMTOs in Nigeria:** WorldRemit, Remitly, Western Union (traditional); newer licensed IMTOs may offer API access
- **Action:** Outreach to 2-3 IMTOs for partnership conversations

### 4. Non-Nigerian jurisdiction licensing
- **Question:** What licensing is required for each priority country?
  - **Ghana:** Bank of Ghana — Payment Service Provider (PSP) license or IMTO partnership
  - **Kenya:** Central Bank of Kenya — Payment Service Provider license
  - **South Africa:** SARB/FSCA — Electronic Money Institution (EMI) or Authorized Securities Institution
  - **UK:** FCA — Electronic Money Institution (EMI) or Authorized Payment Institution (API)
  - **EU:** PSD2 — Electronic Money Institution (EMI) license (passportable)
- **Action:** Legal review for each priority jurisdiction

### 5. Provider availability per country
- **Question:** Which providers operate in which countries?
  - Paystack: NG, GH, KE, ZA (expanding)
  - Flutterwave: NG, GH, KE, ZA, UK, EU (expanding)
  - Stripe: US, UK, EU, AU, CA, SG, JP (not NG direct, but via Connect)
  - Fincra: NG primarily
- **Action:** Confirm current provider coverage for each target country

---

## What Phase B gates

- **Phase E (Transfers):** The international transfer tab and real FX conversion CANNOT go live until Phase B confirms which providers hold the right licenses and which partnerships are in place
- **Phase E does NOT gate:** Building the architecture in sandbox mode — the sandbox adapters already simulate the full flow

## Recommended next steps

1. Legal review of CBN 2024–2025 circulars
2. Provider partnership outreach (Paystack, Flutterwave, Fincra)
3. IMTO partnership outreach (2-3 candidates)
4. Non-Nigerian jurisdiction licensing review (Ghana first, then others)
5. Document findings in this file
6. Proceed to Phase C (KYC) and Phase D (routing) — these don't require Phase B clearance
