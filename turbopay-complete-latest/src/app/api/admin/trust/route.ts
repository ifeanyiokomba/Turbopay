/**
 * Admin Trust Center API
 * =======================
 *
 * GET /api/admin/trust — List all trust center data
 * POST /api/admin/trust — Create a new entity
 * PUT /api/admin/trust — Update an entity
 * DELETE /api/admin/trust — Delete an entity
 *
 * Query params:
 * - entity: "certificate" | "badge" | "logo" | "message"
 * - id: entity ID (for GET single, PUT, DELETE)
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { requireUser } from "@/lib/turbopay/auth";
import { trustCenter } from "@/lib/turbocore/services/trust-center";
import { rateLimit } from "@/lib/turbopay/rate-limit";

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    throw Object.assign(new Error("Admin access required"), { status: 403 });
  }
  return user;
}

export async function GET(req: Request) {
  let user;
  try { user = await requireAdmin(); } catch (e: any) { return errorJson(e.message, e.status ?? 401); }

  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const id = url.searchParams.get("id");

  try {
    switch (entity) {
      case "certificate": {
        if (id) {
          const cert = await trustCenter.getCertificate(id);
          if (!cert) return errorJson("Certificate not found", 404);
          return json({ data: cert });
        }
        const certs = await trustCenter.getCertificates();
        return json({ data: certs });
      }
      case "badge": {
        if (id) {
          const badge = await trustCenter.getBadge(id);
          if (!badge) return errorJson("Badge not found", 404);
          return json({ data: badge });
        }
        const badges = await trustCenter.getBadges();
        return json({ data: badges });
      }
      case "logo": {
        if (id) {
          const logo = await trustCenter.getLogo(id);
          if (!logo) return errorJson("Logo not found", 404);
          return json({ data: logo });
        }
        const logos = await trustCenter.getLogos();
        return json({ data: logos });
      }
      case "message": {
        if (id) {
          const msg = await trustCenter.getMessage(id);
          if (!msg) return errorJson("Message not found", 404);
          return json({ data: msg });
        }
        const msgs = await trustCenter.getMessages();
        return json({ data: msgs });
      }
      default: {
        // Return all data
        const [certificates, badges, logos, messages] = await Promise.all([
          trustCenter.getCertificates(),
          trustCenter.getBadges(),
          trustCenter.getLogos(),
          trustCenter.getMessages(),
        ]);
        return json({ data: { certificates, badges, logos, messages } });
      }
    }
  } catch (e: any) {
    return errorJson(e.message, 500);
  }
}

export async function POST(req: Request) {
  let user;
  try { user = await requireAdmin(); } catch (e: any) { return errorJson(e.message, e.status ?? 401); }

  const limited = await rateLimit(req, { key: "admin-trust", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  let body;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { entity, ...data } = body;
  const actor = { id: user.id, name: user.fullName ?? user.email };

  try {
    switch (entity) {
      case "certificate":
        return json({ data: await trustCenter.createCertificate(data, actor) });
      case "badge":
        return json({ data: await trustCenter.createBadge(data, actor) });
      case "logo":
        return json({ data: await trustCenter.createLogo(data, actor) });
      case "message":
        return json({ data: await trustCenter.createMessage(data, actor) });
      default:
        return errorJson("Invalid entity type", 400);
    }
  } catch (e: any) {
    return errorJson(e.message, 500);
  }
}

export async function PUT(req: Request) {
  let user;
  try { user = await requireAdmin(); } catch (e: any) { return errorJson(e.message, e.status ?? 401); }

  const limited = await rateLimit(req, { key: "admin-trust", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  let body;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }

  const { entity, id, ...data } = body;
  if (!id) return errorJson("Missing entity ID", 400);
  const actor = { id: user.id, name: user.fullName ?? user.email };

  try {
    switch (entity) {
      case "certificate":
        return json({ data: await trustCenter.updateCertificate(id, data, actor) });
      case "badge":
        return json({ data: await trustCenter.updateBadge(id, data, actor) });
      case "logo":
        return json({ data: await trustCenter.updateLogo(id, data, actor) });
      case "message":
        return json({ data: await trustCenter.updateMessage(id, data, actor) });
      default:
        return errorJson("Invalid entity type", 400);
    }
  } catch (e: any) {
    return errorJson(e.message, 500);
  }
}

export async function DELETE(req: Request) {
  let user;
  try { user = await requireAdmin(); } catch (e: any) { return errorJson(e.message, e.status ?? 401); }

  const limited = await rateLimit(req, { key: "admin-trust", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const id = url.searchParams.get("id");
  if (!entity || !id) return errorJson("Missing entity and id params", 400);

  const actor = { id: user.id, name: user.fullName ?? user.email };

  try {
    switch (entity) {
      case "certificate":
        await trustCenter.deleteCertificate(id, actor);
        break;
      case "badge":
        await trustCenter.deleteBadge(id, actor);
        break;
      case "logo":
        await trustCenter.deleteLogo(id, actor);
        break;
      case "message":
        await trustCenter.deleteMessage(id, actor);
        break;
      default:
        return errorJson("Invalid entity type", 400);
    }
    return json({ data: { deleted: true } });
  } catch (e: any) {
    return errorJson(e.message, 500);
  }
}
