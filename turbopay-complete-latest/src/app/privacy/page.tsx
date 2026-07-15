import { Logo, Wordmark } from "@/components/turbopay/logo";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Privacy Policy — TurboPay", description: "How TurboPay collects, uses, and protects your data." };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-4">
          <Logo size={32} />
          <Wordmark className="text-lg" />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-1 text-sm text-muted-foreground">Last updated: July 7, 2026</p>
        <Card className="mt-6">
          <CardContent className="space-y-6 py-6 text-sm leading-relaxed">
            <Section title="1. Who We Are" body="TurboPay is operated by Turbopay Technologies. We provide a digital wallet and payments platform for Nigerian residents. Our services are powered by CBN-licensed partners for fund holding and settlement." />
            <Section title="2. Data We Collect" body="We collect: your full name, email address, phone number, device information (IP, browser, OS), transaction data (amounts, recipients, timestamps), KYC information (NIN, BVN — encrypted at rest), and security event logs. We do NOT store your full card numbers, CVV, or banking credentials." />
            <Section title="3. How We Use It" body="Your data is used for: service delivery (wallet, transfers, bills), identity verification (KYC), fraud prevention and AML monitoring, transaction notifications, customer support, and regulatory compliance as required by CBN and NDPA." />
            <Section title="4. Data Sharing" body="We share your data only with CBN-licensed partners (Monnify, Paystack) for service delivery, and with regulatory authorities when legally required. We never sell your data to third parties." />
            <Section title="5. Your Rights (NDPA)" body="Under the Nigeria Data Protection Act, you have the right to: access your data, correct inaccuracies, request deletion, and export your data in a portable format. Contact support@turbopay.com to exercise these rights." />
            <Section title="6. Data Retention" body="For active accounts, we retain your data for the duration of your relationship with TurboPay. For closed accounts, we retain transaction records for 7 years as required by CBN anti-money laundering regulations." />
            <Section title="7. Security" body="We protect your data with AES-256-GCM encryption at rest, TLS 1.3 in transit, scrypt-hashed passwords and PINs, HttpOnly session cookies, and a double-entry immutable ledger for all financial transactions. Access to your data is logged and audited." />
            <Section title="8. Contact" body="For privacy questions or requests, contact us at support@turbopay.com or write to: Turbopay Technologies, Lagos, Nigeria." />
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
