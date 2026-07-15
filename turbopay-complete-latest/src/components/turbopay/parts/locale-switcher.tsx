"use client";

import * as React from "react";
import { Globe } from "lucide-react";
import { useApp } from "@/components/turbopay/store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LOCALES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "sw", label: "Kiswahili", flag: "🇰🇪" },
  { code: "pt", label: "Português", flag: "🇧🇷" },
  { code: "ar", label: "العربية", flag: "🇸🇦" },
] as const;

export function LocaleSwitcher() {
  const locale = useApp((s) => s.locale);
  const setLocale = useApp((s) => s.setLocale);
  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
          <Globe className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{current.flag} {current.label}</span>
          <span className="sm:hidden">{current.flag}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => setLocale(l.code)}
            className={locale === l.code ? "bg-accent font-medium" : ""}
          >
            <span className="mr-2">{l.flag}</span>
            {l.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
