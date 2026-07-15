/** Reserved usernames that cannot be claimed by users. */
export const RESERVED_USERNAMES = [
  "admin", "administrator", "root", "system", "support", "help", "info",
  "turbopay", "turbocore", "billswift", "api", "bot", "official", "staff",
  "moderator", "mod", "superuser", "test", "demo", "null", "undefined",
  "true", "false", "security", "finance", "compliance", "ops", "dev",
  "developer", "billing", "payments", "wallet", "transfer", "airtime",
  "data", "bills", "kyc", "aml", "support", "team", "sales", "marketing",
  "noreply", "no-reply", "postmaster", "abuse", "webmaster", "hostmaster",
  "admin1", "user1", "test1", "guest", "anonymous", "nobody", "self",
  "all", "everyone", "verify", "verified", "trust", "safe", "secure",
];
export function isReserved(username: string): boolean {
  return RESERVED_USERNAMES.includes(username.toLowerCase());
}
