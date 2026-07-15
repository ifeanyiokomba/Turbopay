import { requireUser } from "@/lib/turbopay/auth";
import { notificationInbox } from "@/lib/turbocore/notifications-inbox";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET(req: Request) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { searchParams } = new URL(req.url);
  const filter: { unreadOnly?: boolean; type?: string } = {};
  if (searchParams.get("unreadOnly") === "true") filter.unreadOnly = true;
  if (searchParams.get("type")) filter.type = searchParams.get("type")!;
  const [items, unreadCount] = await Promise.all([
    notificationInbox.list(user.id, filter),
    notificationInbox.getUnreadCount(user.id),
  ]);
  return json({ data: { items, unreadCount } });
}

export async function PATCH(req: Request) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { searchParams } = new URL(req.url);
  if (searchParams.get("action") === "readAll") return json({ data: await notificationInbox.markAllRead(user.id) });
  return errorJson("Unknown action", 400);
}
