"use client";

import * as React from "react";
import { MessageCircle, X, Send, Bot, User, Loader2, HelpCircle, CreditCard, ArrowRightLeft, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// Quick action suggestions
const QUICK_ACTIONS = [
  { icon: <CreditCard className="h-4 w-4" />, label: "How do I fund my wallet?", query: "How do I fund my wallet?" },
  { icon: <ArrowRightLeft className="h-4 w-4" />, label: "How do I send money?", query: "How do I send money to someone?" },
  { icon: <Shield className="h-4 w-4" />, label: "Is my money safe?", query: "Is my money safe on TurboPay?" },
  { icon: <Zap className="h-4 w-4" />, label: "Pay a bill", query: "How do I pay electricity or cable TV bills?" },
];

// Simple AI responses based on keywords
function generateResponse(input: string): string {
  const lower = input.toLowerCase();

  if (lower.includes("fund") || lower.includes("add money") || lower.includes("deposit")) {
    return "To fund your wallet:\n\n1. Go to **Wallet** and tap **Fund wallet**\n2. Choose your preferred method:\n   - **Bank Transfer** (free) — Transfer to your dedicated account number\n   - **Debit Card** — Pay instantly with your card\n   - **USSD** — Dial the USSD code from your phone\n3. Enter the amount and confirm\n\nFunding is instant for card payments. Bank transfers are credited within minutes.";
  }

  if (lower.includes("send") || lower.includes("transfer")) {
    return "To send money:\n\n1. Go to **Send** from the bottom navigation\n2. Enter the recipient's account number or select from beneficiaries\n3. Enter the amount\n4. Review and confirm with your PIN\n\nTransfers to TurboPay users are instant. Bank transfers are processed via NIP and typically arrive within seconds.";
  }

  if (lower.includes("safe") || lower.includes("secure") || lower.includes("security")) {
    return "Yes, your money is safe on TurboPay! Here's how we protect you:\n\n- **CBN Licensed** — We're a licensed Microfinance Bank\n- **Deposit Insurance** — Your deposits are insured by NDIC\n- **PIN Protection** — All transactions require your PIN\n- **2FA** — Two-factor authentication for sensitive actions\n- **Encryption** — All data is encrypted in transit and at rest\n- **Real-time Monitoring** — Our fraud detection system monitors 24/7";
  }

  if (lower.includes("bill") || lower.includes("electricity") || lower.includes("cable") || lower.includes("dstv") || lower.includes("airtime")) {
    return "To pay bills:\n\n1. Go to **Bills** from the bottom navigation\n2. Select a category (Electricity, Cable TV, Internet, etc.)\n3. Choose your biller\n4. Enter your meter/smartcard number\n5. Validate the customer details\n6. Enter the amount and pay\n\nWe support all major electricity distributors, DStv, GOtv, StarTimes, and more!";
  }

  if (lower.includes("pin") || lower.includes("forgot") || lower.includes("reset")) {
    return "To manage your PIN:\n\n- **Change PIN**: Go to Settings → Security → Change PIN\n- **Forgot PIN**: Go to Settings → Security → Reset PIN (you'll need your email)\n- **Set PIN**: If you haven't set a PIN yet, you'll be prompted to create one on your first transaction";
  }

  if (lower.includes("account number") || lower.includes("virtual account") || lower.includes("account details")) {
    return "Your dedicated virtual account number is shown on your **Wallet** screen.\n\nThis is your personal account number for receiving funds. Share it with anyone who wants to send you money via bank transfer.\n\n- **Account Number**: Displayed on your wallet\n- **Bank Name**: Your partner bank\n- **Account Name**: Your TurboPay account name";
  }

  if (lower.includes("limit") || lower.includes("daily") || lower.includes("maximum")) {
    return "Your transaction limits depend on your KYC tier:\n\n- **Tier 1** (Basic): ₦50,000 daily\n- **Tier 2** (Verified): ₦5,000,000 daily\n- **Tier 3** (Premium): ₦10,000,000 daily\n\nTo increase your limit, complete your KYC verification in Settings → KYC & Limits.";
  }

  if (lower.includes("exchange") || lower.includes("convert") || lower.includes("currency")) {
    return "To exchange currencies:\n\n1. Go to **Wallet** → **Currency Wallets**\n2. Select the wallet you want to fund\n3. Tap **Fund** and choose your source\n4. The exchange rate will be displayed before you confirm\n\nSupported currencies: USD, EUR, GBP, KES, GHS, ZAR, CAD, AUD.";
  }

  if (lower.includes("hello") || lower.includes("hi") || lower.includes("hey")) {
    return "Hello! I'm your TurboPay assistant. How can I help you today?\n\nYou can ask me about:\n- Funding your wallet\n- Sending money\n- Paying bills\n- Account security\n- Transaction limits\n- And more!";
  }

  if (lower.includes("thank")) {
    return "You're welcome! Is there anything else I can help you with?";
  }

  // Default response
  return "I'm here to help! I can assist with:\n\n- **Funding** your wallet\n- **Sending** money to friends and family\n- **Paying** bills (electricity, cable TV, airtime)\n- **Account** security and settings\n- **Transaction** limits and verification\n\nWhat would you like to know?";
}

export function AiSupport() {
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [messages, setMessages] = React.useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hi! I'm your TurboPay assistant. How can I help you today?",
      timestamp: new Date(),
    },
  ]);
  const [loading, setLoading] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    // Simulate thinking delay
    await new Promise((r) => setTimeout(r, 500));

    const response = generateResponse(text);
    const assistantMsg: Message = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: response,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMsg]);
    setLoading(false);
  };

  return (
    <>
      {/* Floating button */}
      <Button
        variant="default"
        size="icon"
        className="fixed bottom-20 right-4 z-50 h-12 w-12 rounded-full shadow-lg lg:bottom-6"
        onClick={() => setOpen(!open)}
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </Button>

      {/* Chat window */}
      {open && (
        <div className="fixed bottom-34 right-4 z-50 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border bg-background shadow-2xl lg:bottom-20">
          {/* Header */}
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
              <Bot className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold">TurboPay Support</p>
              <p className="text-[10px] text-muted-foreground">AI Assistant</p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ maxHeight: "360px" }}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-2",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {msg.role === "assistant" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bot className="h-3 w-3 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[80%] rounded-xl px-3 py-2 text-sm",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}
                >
                  <p className="whitespace-pre-line">{msg.content}</p>
                </div>
                {msg.role === "user" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
                    <User className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-3 w-3 text-primary" />
                </div>
                <div className="rounded-xl bg-muted px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick actions (only show at start) */}
          {messages.length <= 1 && (
            <div className="border-t px-4 py-2">
              <p className="mb-2 text-[10px] font-medium text-muted-foreground">Quick questions</p>
              <div className="grid grid-cols-2 gap-1.5">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => sendMessage(action.query)}
                    className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-accent"
                  >
                    {action.icon}
                    <span className="truncate">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="border-t px-3 py-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage(input);
              }}
              className="flex gap-2"
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask me anything..."
                className="h-9 text-sm"
                disabled={loading}
              />
              <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={loading || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
