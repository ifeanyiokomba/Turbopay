import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules — warn rather than error to avoid blocking the build
    // while existing `any` usage is cleaned up incrementally.
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/ban-ts-comment": "warn",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",

    // React rules — catch stale closure bugs in payment flows
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/purity": "warn",
    // Disabled: set-state-in-effect fires on standard data-fetching patterns
    // (setState inside useEffect for async data loading). This is a common
    // and correct React pattern — the rule is too strict for this codebase.
    "react-hooks/set-state-in-effect": "off",
    "react-hooks/preserve-manual-memoization": "warn",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",

    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",

    // General JavaScript rules — critical safety rules are errors,
    // style preferences are warnings or off.
    "prefer-const": "warn",
    "no-unused-vars": "off", // handled by @typescript-eslint/no-unused-vars above
    "no-console": ["warn", { allow: ["warn", "error", "info", "log"] }],
    "no-debugger": "error",
    "no-empty": "warn",
    "no-irregular-whitespace": "warn",
    "no-case-declarations": "warn",
    "no-fallthrough": "error",
    "no-mixed-spaces-and-tabs": "warn",
    "no-redeclare": "error",
    "no-undef": "off", // TypeScript handles this
    "no-unreachable": "error",
    "no-useless-escape": "warn",

    // ─── Architecture enforcement ─────────────────────────────
    // Route handlers must NOT import the database directly — they
    // should call the service layer instead. This prevents business
    // logic from leaking into HTTP handlers and ensures the enforced
    // transaction pipeline (PIN → AML → hold → provider → audit) is
    // always used.
    //
    // NOTE: This is currently a WARNING (not error) because 70 routes
    // still import db. Once the service layer migration is complete,
    // change to "error".
    "no-restricted-imports": ["warn", {
      patterns: [{
        group: ["@/lib/db"],
        message: "Route handlers should use the service layer, not import db directly. See src/lib/turbopay/services/ for the service methods."
      }],
      paths: [{
        name: "@/lib/db",
        message: "Route handlers should use the service layer (src/lib/turbopay/services/), not import db directly."
      }]
    }],
  },
}, {
  // The db import restriction applies ONLY to route handlers — not to
  // services, lib modules, or scripts (which legitimately need db access).
  ignores: [
    "node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts",
    "examples/**", "skills", "mini-services/**",
    // Non-route files that legitimately import db:
    "src/lib/**", "src/scripts/**", "src/middleware.ts", "src/app/layout.tsx",
    "src/app/page.tsx", "src/app/globals.css",
    // Route files that are admin/CRON and legitimately need db (will be refactored later):
    "src/app/api/admin/**", "src/app/api/cron/**", "src/app/api/webhooks/**",
  ]
}];

export default eslintConfig;
