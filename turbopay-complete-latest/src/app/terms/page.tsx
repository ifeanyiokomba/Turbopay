import { Logo, Wordmark } from "@/components/turbopay/logo";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Terms of Service — TurboPay", description: "The terms and conditions for using TurboPay." };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-4">
          <Logo size={32} />
          <Wordmark className="text-lg" />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-1 text-sm text-muted-foreground">Last updated: July 7, 2026</p>
        <Card className="mt-6">
          <CardContent className="space-y-6 py-6 text-sm leading-relaxed">
            <Section title="1. Acceptance of Terms" body="By creating a TurboPay account or using our services, you agree to these Terms of Service. If you do not agree, please do not use the platform." />
            <Section title="2. Eligibility" body="You must be at least 18 years old and a resident of Nigeria to use TurboPay. You must provide accurate and complete registration information." />
            <Section title="3. Account Registration and Verification" body="You must verify your email and phone number after registration. For higher transaction limits, you must complete KYC verification (NIN for Tier 2, BVN for Tier 3). You are responsible for keeping your password and transaction PIN confidential." />
            <Section title="4. Wallet Services and Transaction Limits" body="Your wallet allows you to fund, transfer, buy airtime/data, and pay bills. Transaction limits are based on your KYC tier: Tier 1 (₦50k single tx), Tier 2 (₦500k single tx), Tier 3 (₦5M single tx). All debits require your transaction PIN." />
            <Section title="5. Prohibited Activities" body="You must not use TurboPay for: fraud, money laundering, terrorism financing, false information, unauthorized transactions, or any activity prohibited by Nigerian law. Violations will result in account suspension and may be reported to authorities." />
            <Section title="6. Fees" body="Internal TurboPay transfers are free. Wallet funding is free. Bill payments are free (provider margin). Card-funded payments carry 1.5% (capped at ₦2,000). SMS alerts incur a configurable charge. See the fee schedule in the app for details." />
            <Section title="7. Service Availability" body="We strive for 99.9% uptime but do not guarantee uninterrupted service. Maintenance windows may be scheduled. We are not liable for losses due to provider outages, network failures, or force majeure events." />
            <Section title="8. Liability Limitations" body="TurboPay's liability is limited to the amount of the disputed transaction. We are not liable for indirect, consequential, or punitive damages. Our total liability shall not exceed ₦100,000." />
            <Section title="9. Dispute Resolution" body="Any disputes shall be resolved in accordance with the laws of the Federal Republic of Nigeria. The courts of Lagos State shall have exclusive jurisdiction. We encourage contacting support@turbopay.com before pursuing legal action." />
            <Section title="10. Amendments" body="We may update these Terms at any time. Material changes will be notified via email or in-app notification. Continued use after changes constitutes acceptance." />
            <Section title="11. Contact" body="For questions about these Terms, contact support@turbopay.com." />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </div>
  );
}
