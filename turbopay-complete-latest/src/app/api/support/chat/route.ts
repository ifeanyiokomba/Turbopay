import { db } from "@/lib/db";
import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";

/**
 * GET /api/support/chat — get or create the user's chat conversation.
 */
export async function GET() {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let conv = await db.chatConversation.findFirst({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  if (!conv) {
    conv = await db.chatConversation.create({
      data: { userId: user.id, status: "ACTIVE" },
    });
  }

  const messages = await db.chatMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return json({
    data: {
      conversation: {
        id: conv.id,
        status: conv.status,
        createdAt: conv.createdAt.toISOString(),
      },
      messages: messages.map((m) => ({
        id: m.id,
        authorName: m.authorName,
        authorRole: m.authorRole,
        body: m.body,
        attachments: m.attachments ? JSON.parse(m.attachments) : null,
        createdAt: m.createdAt.toISOString(),
      })),
    },
  });
}

/**
 * POST /api/support/chat — send a message (with optional attachments).
 * The AI assistant auto-responds. If the question is critical/security-related,
 * it recommends opening a ticket. If a live agent is online, it escalates.
 */
export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const { message, attachments } = body as { message?: string; attachments?: Array<{ url: string; fileName: string; fileType: string; fileSize: number }> };

  if (!message?.trim() && (!attachments || attachments.length === 0)) {
    return errorJson("Message or attachment is required", 400, "VALIDATION");
  }

  // Get or create conversation.
  let conv = await db.chatConversation.findFirst({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  if (!conv) {
    conv = await db.chatConversation.create({
      data: { userId: user.id, status: "ACTIVE" },
    });
  }

  // Save the user's message (with attachments if provided).
  await db.chatMessage.create({
    data: {
      conversationId: conv.id,
      authorName: user.fullName,
      authorRole: "CUSTOMER",
      body: message?.trim() || "(attachment)",
      attachments: attachments ? JSON.stringify(attachments) : null,
    },
  });

  // Generate AI response.
  const aiResult = generateAiReply(message?.trim() || "");

  // Save the AI response.
  await db.chatMessage.create({
    data: {
      conversationId: conv.id,
      authorName: "Turbopay Assistant",
      authorRole: "AI",
      body: aiResult.reply,
    },
  });

  // If escalation is needed, check if a live agent is online.
  if (aiResult.escalate) {
    // Check if any admin is online (has an active session in the last 5 minutes).
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const onlineAgents = await db.session.count({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { role: "ADMIN" },
      },
    });

    if (onlineAgents > 0) {
      // Escalate to live agent — update conversation status.
      await db.chatConversation.update({
        where: { id: conv.id },
        data: { status: "WAITING_AGENT" },
      });
      return json({
        data: {
          reply: aiResult.reply,
          escalated: true,
          escalationType: "LIVE_AGENT",
          message: "A support agent has been notified and will join this chat shortly.",
        },
      });
    } else {
      // No agent online — recommend opening a ticket.
      return json({
        data: {
          reply: aiResult.reply + "\n\n⚠️ No support agents are currently online. For this type of issue, I recommend creating a support ticket — our team will respond as soon as they're available.",
          escalated: true,
          escalationType: "TICKET",
          message: "No agents online. Please create a support ticket for this issue.",
        },
      });
    }
  }

  return json({ data: { reply: aiResult.reply, escalated: false } });
}

interface AiReplyResult {
  reply: string;
  escalate: boolean;
}

function generateAiReply(message: string): AiReplyResult {
  const msg = message.toLowerCase();

  // ─── Critical security questions — always escalate ───
  if (/unauthorized.*transaction|someone.*accessed.*my.*account|account.*hacked|fraud.*report|stolen.*money|suspicious.*activity.*account|my.*account.*was.*compromised|money.*missing|didn.*t.*authorize/.test(msg)) {
    return {
      reply: "I take security concerns very seriously. This type of issue requires immediate attention from our security team. I'm escalating this to a human agent who can investigate and secure your account right away.",
      escalate: true,
    };
  }

  if (/forgot.*pin|reset.*pin|lost.*pin|pin.*not.*working|locked.*out|account.*locked|forgot.*password|reset.*password/.test(msg)) {
    return {
      reply: "For PIN or password recovery: go to Settings → Transaction PIN → 'Forgot PIN' for PIN reset via OTP, or click 'Forgot password?' on the login screen for password reset. If you need further assistance, I can connect you with a support agent.",
      escalate: false,
    };
  }

  // ─── General queries — AI answers directly ───
  if (/how.*fund.*wallet|fund.*account|add.*money|deposit/.test(msg)) {
    return {
      reply: "To fund your wallet: go to Wallet → Fund wallet, or transfer from any Nigerian bank to your dedicated virtual account (shown on the Wallet page). Funds appear instantly. Minimum funding is ₦100.",
      escalate: false,
    };
  }
  if (/how.*transfer|send.*money/.test(msg)) {
    return {
      reply: "To transfer: go to Transfer → enter recipient (phone, email, or Turbopay account) → enter amount → confirm with your 4-digit transaction PIN. Internal Turbopay transfers are free and instant. Minimum transfer is ₦50.",
      escalate: false,
    };
  }
  if (/kyc|verify.*identity|nin|bvn|limit/.test(msg)) {
    return {
      reply: "For KYC: go to KYC & Limits. Tier 1 (phone + email) = ₦50K per transaction. Tier 2 (NIN) = ₦500K. Tier 3 (BVN) = ₦5M. Your verified details (name, date of birth, state of origin, LGA) from NIN/BVN will automatically update your profile. Verification usually completes within minutes.",
      escalate: false,
    };
  }
  if (/airtime|data/.test(msg)) {
    return {
      reply: "To buy airtime or data: go to Airtime & Data → select network → enter phone → choose plan (for data) → confirm with PIN. Airtime is instant; data activates within 30 seconds.",
      escalate: false,
    };
  }
  if (/bill|electricity|cable|water|dstv|gotv/.test(msg)) {
    return {
      reply: "To pay bills: go to Pay Bills → choose category (electricity, cable TV, water, internet) → validate your customer/meter number → enter amount → confirm. Prepaid electricity generates a token instantly.",
      escalate: false,
    };
  }
  if (/fee|charge|cost/.test(msg)) {
    return {
      reply: "Internal Turbopay transfers are free. Wallet funding via virtual account is free. Airtime has no fee. Bill payments have no fee. Card-funded payments carry 1.5% (capped at ₦2,000).",
      escalate: false,
    };
  }
  if (/support|help|agent|human|ticket|talk.*to.*someone/.test(msg)) {
    return {
      reply: "I can help you create a support ticket for more complex issues. Go to Support → Tickets → New ticket, choose a category, and describe your issue. Our team responds within 60 minutes during business hours. You can also email support@turbopay.com.",
      escalate: false,
    };
  }

  // Default — try to help, offer escalation.
  return {
    reply: "I'm here to help! I can assist with funding your wallet, transfers, KYC verification, airtime/data, bill payments, PIN issues, and more. Could you describe what you need help with? For complex issues, I can connect you with a support agent or help you create a support ticket.",
    escalate: false,
  };
}
