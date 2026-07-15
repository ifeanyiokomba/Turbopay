"use client";

import * as React from "react";
import { ArrowRight, Zap, ShieldCheck, Smartphone, ReceiptText, Send, Wallet, Globe, CheckCircle2, Star } from "lucide-react";
import { Logo, Wordmark } from "@/components/turbopay/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useApi } from "@/lib/turbopay/client";

interface Testimonial {
  id: string;
  name: string;
  role: string;
  location: string | null;
  quote: string;
  rating: number;
  avatarUrl: string | null;
}

export function LandingPage({ onGetStarted }: { onGetStarted: (tab?: "login" | "register") => void }) {
  const { data: testimonials } = useApi<Testimonial[]>("/api/testimonials");
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Logo size={36} />
            <Wordmark className="text-xl" />
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">How it works</a>
            <a href="#security" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Security</a>
          </div>
          <Button onClick={() => onGetStarted("register")} size="sm">
            Get Started <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="tp-grain absolute inset-0 opacity-30" />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                <Zap className="h-3.5 w-3.5" /> The fast lane to your money
              </div>
              <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                Your money,<br />
                <span className="text-primary">faster than ever.</span>
              </h1>
              <p className="max-w-md text-lg text-muted-foreground">
                Turbopay is Nigeria's modern digital wallet. Fund instantly, transfer for free,
                buy airtime & data, and pay bills — all from one app.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" onClick={() => onGetStarted("register")}>
                  Create free account <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
                <Button size="lg" variant="outline" onClick={() => onGetStarted("login")}>
                  Sign in
                </Button>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-success" /> No hidden fees</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-success" /> Bank-grade security</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-success" /> Instant transfers</span>
              </div>
            </div>

            {/* Wallet card mockup */}
            <div className="relative lg:ml-8">
              <div className="tp-wallet-card relative overflow-hidden rounded-3xl p-6 shadow-2xl">
                <div className="tp-grain pointer-events-none absolute inset-0 opacity-40" />
                <div className="relative">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Logo size={32} />
                      <span className="text-sm font-semibold opacity-90">Turbopay Wallet</span>
                    </div>
                    <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium">Tier 2</span>
                  </div>
                  <div className="mt-6">
                    <p className="text-xs uppercase tracking-wide opacity-70">Available balance</p>
                    <p className="mt-1 text-4xl font-bold tabular-nums">₦49,400.00</p>
                    <p className="mt-1 text-[11px] opacity-70">Ledger reconciled · ₦49,400.00</p>
                  </div>
                  <div className="mt-6 flex gap-2">
                    {["Fund", "Transfer", "Airtime", "Bills"].map((a) => (
                      <span key={a} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur">{a}</span>
                    ))}
                  </div>
                </div>
              </div>
              {/* Floating stat cards */}
              <div className="absolute -right-4 -top-4 hidden rounded-xl border bg-card p-3 shadow-lg sm:block">
                <p className="text-[10px] uppercase text-muted-foreground">Instant transfer</p>
                <p className="text-lg font-bold text-success">₦0 fee</p>
              </div>
              <div className="absolute -bottom-4 -left-4 hidden rounded-xl border bg-card p-3 shadow-lg sm:block">
                <p className="text-[10px] uppercase text-muted-foreground">Funding speed</p>
                <p className="text-lg font-bold text-primary">Instant</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t bg-muted/30 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything you need in one wallet</h2>
            <p className="mt-3 text-muted-foreground">Powerful features designed for how Nigerians move money.</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard icon={Wallet} title="Wallet & Virtual Account" desc="Get a dedicated Monnify virtual account. Fund your wallet instantly from any Nigerian bank." />
            <FeatureCard icon={Send} title="Free Transfers" desc="Send money to any Turbopay user instantly. No fees, no delays, no hidden charges." />
            <FeatureCard icon={Smartphone} title="Airtime & Data" desc="Buy airtime and data bundles for MTN, Glo, Airtel, and 9mobile at the best prices." />
            <FeatureCard icon={ReceiptText} title="Bill Payments" desc="Pay electricity (8 DISCOs), DStv, GOtv, water, internet, Remita, and more — all in one place." />
            <FeatureCard icon={ShieldCheck} title="Protected at Every Step" desc="Your money is safeguarded with multi-layer security, mandatory transaction PINs, and real-time fraud detection — so you can transact with total confidence." />
            <FeatureCard icon={Globe} title="KYC Tiers" desc="Verify with NIN or BVN to unlock higher transaction limits up to ₦5M per transaction." />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Get started in 3 steps</h2>
            <p className="mt-3 text-muted-foreground">From signup to your first transaction in under 2 minutes.</p>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <StepCard step="1" title="Create your account" desc="Sign up with your name, email, and phone number. Get a virtual account instantly." />
            <StepCard step="2" title="Fund your wallet" desc="Transfer money from any bank to your dedicated virtual account. Funds appear instantly." />
            <StepCard step="3" title="Start transacting" desc="Transfer, buy airtime, pay bills, and manage your money — all from one dashboard." />
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="border-t bg-primary/5 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Security you can trust</h2>
              <p className="mt-3 text-muted-foreground">
                Your money is protected by the same technology used by Nigeria's top banks.
              </p>
              <div className="mt-6 space-y-3">
                <SecurityItem text="Every transaction requires your personal PIN — no one can move your money without it" />
                <SecurityItem text="Your sensitive information is encrypted and stored with bank-level protection" />
                <SecurityItem text="Real-time fraud monitoring watches every transaction 24/7" />
                <SecurityItem text="Funds are held securely by our CBN-licensed banking partners" />
                <SecurityItem text="Instant alerts notify you of every activity on your account" />
                <SecurityItem text="Full compliance with Nigerian data protection regulations (NDPA)" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <StatBox value="₦0" label="Hidden fees" />
              <StatBox value="< 2s" label="Transfer speed" />
              <StatBox value="24/7" label="Always available" />
              <StatBox value="100%" label="NDPR compliant" />
            </div>
          </div>
        </div>
      </section>

      {/* Why Turbopay */}
      <section className="border-t bg-muted/30 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Why Nigerians choose Turbopay</h2>
            <p className="mt-3 text-muted-foreground">Built for speed, designed for trust, priced for everyone.</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="text-center"><CardContent className="p-6"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><Zap className="h-6 w-6" /></div><h3 className="mt-4 font-semibold">Lightning Fast</h3><p className="mt-1 text-sm text-muted-foreground">Transfers and bill payments complete in seconds — no waiting, no delays.</p></CardContent></Card>
            <Card className="text-center"><CardContent className="p-6"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><CheckCircle2 className="h-6 w-6" /></div><h3 className="mt-4 font-semibold">No Hidden Fees</h3><p className="mt-1 text-sm text-muted-foreground">Free wallet, free transfers, free airtime. You always know exactly what you pay.</p></CardContent></Card>
            <Card className="text-center"><CardContent className="p-6"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-6 w-6" /></div><h3 className="mt-4 font-semibold">Always Protected</h3><p className="mt-1 text-sm text-muted-foreground">24/7 fraud monitoring, mandatory PINs, and instant alerts keep your money safe.</p></CardContent></Card>
            <Card className="text-center"><CardContent className="p-6"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><Globe className="h-6 w-6" /></div><h3 className="mt-4 font-semibold">Made for Nigeria</h3><p className="mt-1 text-sm text-muted-foreground">All major banks, DISCOs, and networks supported. Built for how Nigerians move money.</p></CardContent></Card>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Frequently asked questions</h2>
          </div>
          <div className="mt-10 space-y-4">
            <FaqItem q="How do I fund my Turbopay wallet?" a="Transfer money from any Nigerian bank to your dedicated virtual account number. Funds appear in your wallet instantly. You can also use the 'Fund Wallet' button in the app for a quick top-up." />
            <FaqItem q="Are transfers really free?" a="Yes! Internal transfers between Turbopay users are completely free — no fees, no hidden charges. External bank transfers may have a small fee in the future." />
            <FaqItem q="Is my money safe with Turbopay?" a="Yes. Your funds are held securely by our CBN-licensed banking partners. Every transaction requires your personal PIN, our system monitors for fraud 24/7, and you receive instant alerts for every activity on your account. Your sensitive information is always encrypted and protected." />
            <FaqItem q="What are KYC tiers?" a="Tier 1 (phone + email) gives you ₦50K per transaction. Tier 2 (NIN verification) unlocks ₦500K. Tier 3 (BVN) gives you ₦5M per transaction. Higher tiers = higher limits." />
            <FaqItem q="Can I pay electricity bills?" a="Yes! We support all 8 major electricity DISCOs (Ikeja, Eko, Abuja, PH, Ibadan, Kano, Jos, Yola) with instant prepaid token generation. We also support DStv, GOtv, water, internet, and Remita payments." />
            <FaqItem q="What if I forget my password?" a="Click 'Forgot password?' on the login screen. We'll send a 6-digit OTP to your registered email or phone. Enter the OTP and set a new password." />
          </div>
        </div>
      </section>

      {/* Testimonials placeholder */}
      <section className="border-t bg-primary/5 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Loved by Nigerians</h2>
            <p className="mt-3 text-muted-foreground">Real stories from real users.</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {testimonials && testimonials.length > 0 ? (
              testimonials.slice(0, 3).map((t) => (
                <Card key={t.id} className="bg-card">
                  <CardContent className="p-6">
                    <div className="flex gap-1">{Array.from({ length: t.rating }).map((_, j) => <Star key={j} className="h-4 w-4 fill-amber-400 text-amber-400" />)}</div>
                    <p className="mt-3 text-sm text-muted-foreground italic">"{t.quote}"</p>
                    <div className="mt-4 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {t.name.split(" ").map(n => n[0]).slice(0, 2).join("")}
                      </div>
                      <div>
                        <p className="text-xs font-medium">{t.name}</p>
                        <p className="text-[10px] text-muted-foreground">{t.role}{t.location ? ` · ${t.location}` : ""}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              [1, 2, 3].map((i) => (
                <Card key={i} className="bg-card">
                  <CardContent className="p-6">
                    <div className="flex gap-1">{Array.from({ length: 5 }).map((_, j) => <Star key={j} className="h-4 w-4 fill-amber-400 text-amber-400" />)}</div>
                    <p className="mt-3 text-sm text-muted-foreground italic">"Your testimonial here — we're collecting stories from our early users."</p>
                    <div className="mt-4 flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-primary/10" />
                      <div><p className="text-xs font-medium">Coming soon</p><p className="text-[10px] text-muted-foreground">Early user</p></div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ready to move money faster?</h2>
          <p className="mt-3 text-muted-foreground">Join thousands of Nigerians who trust Turbopay with their money.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button size="lg" onClick={() => onGetStarted("register")}>Create your free wallet <ArrowRight className="ml-1 h-4 w-4" /></Button>
            <Button size="lg" variant="outline" onClick={() => onGetStarted("login")}>Sign in</Button>
            <Button size="lg" variant="ghost" onClick={() => onGetStarted("register")}>Become a Partner</Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-background py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-8 md:grid-cols-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2"><Logo size={28} /><Wordmark className="text-base" /></div>
              <p className="text-xs text-muted-foreground">Nigeria's modern digital wallet. Fast, secure, and built for how Nigerians move money.</p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Product</p>
              <div className="flex flex-col gap-1.5 text-sm">
                <a href="#features" className="text-muted-foreground hover:text-foreground">Features</a>
                <a href="#how-it-works" className="text-muted-foreground hover:text-foreground">How it works</a>
                <a href="#security" className="text-muted-foreground hover:text-foreground">Security</a>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Company</p>
              <div className="flex flex-col gap-1.5 text-sm">
                <a href="#" className="text-muted-foreground hover:text-foreground">About</a>
                <a href="#" className="text-muted-foreground hover:text-foreground">Become a Partner</a>
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">Privacy Policy</a>
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">Terms of Service</a>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Support</p>
              <div className="flex flex-col gap-1.5 text-sm">
                <a href="#" className="text-muted-foreground hover:text-foreground">Help Center</a>
                <a href="#" className="text-muted-foreground hover:text-foreground">Contact Support</a>
                <a href="mailto:support@turbopay.com" className="text-muted-foreground hover:text-foreground">support@turbopay.com</a>
              </div>
            </div>
          </div>
          <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t pt-6 sm:flex-row">
            <div className="flex items-center gap-2"><Logo size={20} /><span className="text-xs text-muted-foreground">© {new Date().getFullYear()} Turbopay Technologies · NDPR-aware · CBN-aligned partners</span></div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success" /> All systems operational</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc }: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <Card className="transition-all hover:-translate-y-1 hover:shadow-md">
      <CardContent className="p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}

function StepCard({ step, title, desc }: { step: string; title: string; desc: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-bold">
        {step}
      </div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

function SecurityItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
      <span className="text-sm">{text}</span>
    </div>
  );
}

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-center">
      <p className="text-2xl font-bold text-primary">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function PricingCard({ name, price, period, features, cta, featured, onClick }: { name: string; price: string; period: string; features: string[]; cta: string; featured?: boolean; onClick: () => void }) {
  return (
    <Card className={cn("relative", featured && "border-primary ring-1 ring-primary")}>
      {featured && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-[10px] font-medium text-primary-foreground">MOST POPULAR</span>}
      <CardContent className="p-6">
        <p className="text-sm font-semibold uppercase text-muted-foreground">{name}</p>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="text-3xl font-bold">{price}</span>
          {period && <span className="text-sm text-muted-foreground">{period}</span>}
        </div>
        <ul className="mt-4 space-y-2">
          {features.map((f) => <li key={f} className="flex items-start gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />{f}</li>)}
        </ul>
        <Button className="mt-6 w-full" variant={featured ? "default" : "outline"} onClick={onClick}>{cta}</Button>
      </CardContent>
    </Card>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-xl border">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between p-4 text-left">
        <span className="text-sm font-medium">{q}</span>
        <span className="text-muted-foreground">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="border-t px-4 py-3 text-sm text-muted-foreground">{a}</div>}
    </div>
  );
}
