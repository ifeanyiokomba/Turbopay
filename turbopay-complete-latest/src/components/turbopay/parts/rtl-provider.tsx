"use client";

import { useEffect } from "react";
import { useApp } from "@/components/turbopay/store";

/**
 * Sets the `dir` attribute on <html> based on the current locale.
 * Arabic (ar) uses RTL; all others use LTR.
 */
export function RtlProvider({ children }: { children: React.ReactNode }) {
  const locale = useApp((s) => s.locale);

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("lang", locale);
    html.setAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  }, [locale]);

  return <>{children}</>;
}
