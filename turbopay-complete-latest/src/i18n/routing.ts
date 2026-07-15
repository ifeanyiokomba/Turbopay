import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "fr", "sw", "pt", "ar"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});
