import { getSessionUser, logout } from "@/lib/turbopay/auth";
import { audit } from "@/lib/turbopay/audit";
import { json } from "@/lib/turbopay/api";

export async function POST() {
  const user = await getSessionUser();
  if (user) {
    await audit({ userId: user.id, action: "USER_LOGOUT", category: "AUTH" });
  }
  await logout();
  return json({ data: { ok: true } });
}
