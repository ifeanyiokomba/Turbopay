import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    // Increase timeout for heavy DB operations (ledger, auth, transfers).
    // Tests that call route handlers with Prisma transactions need more than
    // the default 5s, especially against a remote Neon database.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
