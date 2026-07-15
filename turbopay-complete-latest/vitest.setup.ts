/**
 * Vitest setup — loads .env before any test module imports.
 * Without this, env.ts validation fails because DATABASE_URL is undefined.
 */
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(__dirname, ".env") });
