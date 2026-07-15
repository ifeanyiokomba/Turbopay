import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { generateReference } from "@/lib/turbopay/reference";
import { notify } from "@/lib/turbocore/notifications";
import * as crypto from "node:crypto";

const TICKET_CATEGORIES = [
  "LOGIN", "WALLET", "TRANSFER", "BILLS", "KYC", "SAVINGS", "INVESTMENTS",
  "CARDS", "INTERNATIONAL", "REFERRAL", "TECHNICAL", "OTHER",
] as const;

const TICKET_STATUSES = [
  "NEW", "OPEN", "PENDING_CUSTOMER", "PENDING_INTERNAL", "IN_PROGRESS",
  "ESCALATED", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED",
] as const;

const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

class SupportService {
  /** Generate a human-friendly ticket number: TP-2026-000123 */
  private async generateTicketNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await db.supportTicket.count({ where: { createdAt: { gte: new Date(`${year}-01-01`) } } });
    return `TP-${year}-${String(count + 1).padStart(6, "0")}`;
  }

  async createTicket(input: {
    userId?: string; fullName: string; email: string; phone?: string; username?: string;
    category: string; subcategory?: string; subject: string; description: string;
    priority?: string; metadata?: Record<string, unknown>;
  }) {
    // Retry on unique constraint violation (concurrent count-then-create race)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ticketNumber = await this.generateTicketNumber();
        const ticket = await db.supportTicket.create({
          data: {
            ticketNumber,
            userId: input.userId ?? null,
            fullName: input.fullName, email: input.email, phone: input.phone ?? null, username: input.username ?? null,
            category: input.category, subcategory: input.subcategory ?? null,
            priority: input.priority ?? "MEDIUM", status: "NEW",
            subject: input.subject, description: input.description,
            metadata: input.metadata ? JSON.stringify(input.metadata) : null,
          },
        });
        await db.supportTicketMessage.create({
          data: { ticketId: ticket.id, authorId: input.userId ?? null, authorName: input.fullName, authorRole: "CUSTOMER", message: input.description },
        });
        if (input.userId) {
          await audit({ userId: input.userId, action: "SUPPORT_TICKET_CREATED", category: "ADMIN", metadata: { ticketNumber, category: input.category } });
        }
        return ticket;
      } catch (e: any) {
        if (e.code === "P2002" && attempt < 2) continue; // unique constraint violation, retry
        throw e;
      }
    }
    // Fallback: random suffix guarantees uniqueness
    const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
    const ticketNumber = `TP-${new Date().getFullYear()}-${rand}`;
    const ticket = await db.supportTicket.create({
      data: {
        ticketNumber,
        userId: input.userId ?? null,
        fullName: input.fullName, email: input.email, phone: input.phone ?? null, username: input.username ?? null,
        category: input.category, subcategory: input.subcategory ?? null,
        priority: input.priority ?? "MEDIUM", status: "NEW",
        subject: input.subject, description: input.description,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
    await db.supportTicketMessage.create({
      data: { ticketId: ticket.id, authorId: input.userId ?? null, authorName: input.fullName, authorRole: "CUSTOMER", message: input.description },
    });
    return ticket;
  }

  async addMessage(ticketId: string, input: { authorId?: string; authorName: string; authorRole: string; message: string; isInternal?: boolean }) {
    return db.supportTicketMessage.create({
      data: { ticketId, authorId: input.authorId ?? null, authorName: input.authorName, authorRole: input.authorRole, message: input.message, isInternal: input.isInternal ?? false },
    });
  }

  async addAttachment(ticketId: string, input: { fileName: string; filePath: string; fileType: string; fileSizeBytes: number; uploadedBy: string; messageId?: string }) {
    return db.supportTicketAttachment.create({ data: { ticketId, ...input, messageId: input.messageId ?? null } });
  }

  async getTicket(ticketId: string) {
    return db.supportTicket.findUnique({
      where: { id: ticketId },
      include: { messages: { orderBy: { createdAt: "asc" } }, attachments: { orderBy: { createdAt: "desc" } } },
    });
  }

  async getTicketByNumber(ticketNumber: string) {
    return db.supportTicket.findUnique({
      where: { ticketNumber },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
  }

  async listTickets(filters: { status?: string; category?: string; priority?: string; assignedTo?: string; userId?: string; q?: string }, page = 1, limit = 50) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.priority) where.priority = filters.priority;
    if (filters.assignedTo) where.assignedTo = filters.assignedTo;
    if (filters.userId) where.userId = filters.userId;
    if (filters.q) {
      where.OR = [
        { ticketNumber: { contains: filters.q } },
        { subject: { contains: filters.q } },
        { description: { contains: filters.q } },
        { fullName: { contains: filters.q } },
        { email: { contains: filters.q } },
      ];
    }
    const [items, total] = await Promise.all([
      db.supportTicket.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: (page - 1) * limit }),
      db.supportTicket.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async updateTicket(ticketId: string, input: { status?: string; priority?: string; assignedTo?: string; subcategory?: string; metadata?: Record<string, unknown> }, actor?: { id: string; name: string }) {
    const data: Record<string, unknown> = {};
    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === "RESOLVED") data.resolvedAt = new Date();
      if (input.status === "CLOSED") data.closedAt = new Date();
      if (input.status === "REOPENED") { data.resolvedAt = null; data.closedAt = null; }
    }
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.assignedTo !== undefined) data.assignedTo = input.assignedTo;
    if (input.subcategory !== undefined) data.subcategory = input.subcategory;
    if (input.metadata !== undefined) data.metadata = JSON.stringify(input.metadata);
    const updated = await db.supportTicket.update({ where: { id: ticketId }, data });
    if (actor) await audit({ userId: actor.id, action: "SUPPORT_TICKET_UPDATED", category: "ADMIN", metadata: { ticketId, fields: Object.keys(data) } });

    // Fire in-app notification to the ticket owner on key transitions
    if (input.status && updated.userId) {
      const statusMessages: Record<string, { title: string; message: string }> = {
        OPEN: { title: "Ticket Updated", message: `Your ticket ${updated.ticketNumber} is now being reviewed.` },
        IN_PROGRESS: { title: "Ticket In Progress", message: `An agent is working on your ticket ${updated.ticketNumber}.` },
        ESCALATED: { title: "Ticket Escalated", message: `Your ticket ${updated.ticketNumber} has been escalated.` },
        RESOLVED: { title: "Ticket Resolved", message: `Your ticket ${updated.ticketNumber} has been resolved.` },
        CLOSED: { title: "Ticket Closed", message: `Your ticket ${updated.ticketNumber} has been closed.` },
        REOPENED: { title: "Ticket Reopened", message: `Your ticket ${updated.ticketNumber} has been reopened.` },
        CANCELLED: { title: "Ticket Cancelled", message: `Your ticket ${updated.ticketNumber} has been cancelled.` },
      };
      const msg = statusMessages[input.status];
      if (msg) {
        notify.sendInApp({
          userId: updated.userId,
          type: "SUPPORT",
          title: msg.title,
          message: msg.message,
          actionUrl: `/support/tickets/${updated.ticketNumber}`,
          actionLabel: "View Ticket",
          metadata: { ticketId, ticketNumber: updated.ticketNumber, status: input.status },
        }).catch(() => null);
      }
    }

    return updated;
  }

  async getUserTickets(userId: string) {
    return db.supportTicket.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, include: { messages: { take: 1, orderBy: { createdAt: "desc" } } } });
  }
}

export const support = new SupportService();
export { TICKET_CATEGORIES, TICKET_STATUSES, TICKET_PRIORITIES };
