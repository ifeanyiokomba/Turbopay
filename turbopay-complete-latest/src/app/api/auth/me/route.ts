import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return errorJson("Not authenticated", 401, "UNAUTHORIZED");
  return json({ data: user });
}
