import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { getNonceFromCookie } from "@/lib/turbopay/nonce";
import { SentryInit } from "@/components/sentry-init";
import { RtlProvider } from "@/components/turbopay/parts/rtl-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSansArabic = Noto_Sans_Arabic({
  variable: "--font-noto-arabic",
  subsets: ["arabic"],
});

export const metadata: Metadata = {
  title: "Turbopay — Wallet, Payments & Bills",
  description:
    "Turbopay is a modern Nigerian digital wallet and payments platform. Fund your wallet, transfer money, buy airtime & data, and pay bills — fast, secure, fintech-grade.",
  keywords: [
    "Turbopay",
    "Nigeria fintech",
    "digital wallet",
    "money transfer",
    "airtime",
    "data",
    "bill payments",
    "virtual account",
  ],
  authors: [{ name: "Turbopay" }],
  applicationName: "Turbopay",
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
  openGraph: {
    title: "Turbopay — Wallet, Payments & Bills",
    description:
      "A modern Nigerian digital wallet. Fund, transfer, buy airtime & data, pay bills.",
    siteName: "Turbopay",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Turbopay",
    description: "Modern Nigerian digital wallet & payments.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b6b4f" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1f1a" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = await getNonceFromCookie();

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning nonce={nonce}>
      <head>
        {/* Google Identity Services — for the "Continue with Google" button */}
        <script src="https://accounts.google.com/gsi/client" async defer nonce={nonce} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoSansArabic.variable} antialiased bg-background text-foreground`}
      >
        <SentryInit />
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <RtlProvider>
            {children}
          </RtlProvider>
          <SonnerToaster richColors position="top-center" duration={4000} closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
