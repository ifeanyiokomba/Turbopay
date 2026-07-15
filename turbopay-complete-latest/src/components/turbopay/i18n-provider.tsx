"use client";

import * as React from "react";
import { NextIntlClientProvider } from "next-intl";
import { useApp } from "@/components/turbopay/store";

// Default English messages (fallback)
import enMessages from "@/messages/en.json";

type Messages = typeof enMessages;

/**
 * Client-side i18n provider.
 * Loads messages for the current locale and provides them to NextIntlClientProvider.
 * Falls back to English if messages can't be loaded.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useApp((s) => s.locale) ?? "en";
  const [messages, setMessages] = React.useState<Messages>(enMessages as Messages);

  React.useEffect(() => {
    if (locale === "en") {
      setMessages(enMessages as Messages);
      return;
    }
    import(`@/messages/${locale}.json`)
      .then((mod) => setMessages(mod.default as Messages))
      .catch(() => setMessages(enMessages as Messages));
  }, [locale]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
