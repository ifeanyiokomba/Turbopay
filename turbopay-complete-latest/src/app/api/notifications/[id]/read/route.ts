import { requireUser } from "@/lib/turbopay/auth";
import { notificationInbox } from "@/lib/turbocore/notifications-inbox";
import { errorJson, json } from "@/lib/turbopay/api";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  return json({ data: await notificationInbox.markRead(id, user.id) });
}
