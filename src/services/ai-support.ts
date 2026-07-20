// TurboPay AI Support Assistant
// Handles customer support conversations with admin management and takeover
// Replaces the language selector UI space per restructure.txt
//
// Architecture:
// - AI handles FAQ, transaction assistance, account questions, payment troubleshooting
// - Admin can monitor conversations in real-time
// - Admin can take over any conversation at any time
// - Conversation history is persisted and searchable
// - Knowledge base is configurable from admin dashboard

import { PersistenceManager } from '../utils/persistence';

// =============================================================================
// TYPES
// =============================================================================

export type MessageRole = 'user' | 'ai' | 'admin' | 'system';
export type ConversationStatus = 'active' | 'waiting' | 'taken_over' | 'resolved' | 'closed';
export type SentimentType = 'positive' | 'neutral' | 'negative' | 'frustrated';
export type KnowledgeCategory =
  | 'general'
  | 'transactions'
  | 'wallet'
  | 'kyc'
  | 'payments'
  | 'transfers'
  | 'bills'
  | 'cards'
  | 'providers'
  | 'security'
  | 'account'
  | 'fees'
  | 'compliance';

export interface AIMessage {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  sentiment?: SentimentType;
  confidence?: number;
  admin_id?: string;
  admin_name?: string;
  metadata?: Record<string, any>;
}

export interface AIConversation {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  status: ConversationStatus;
  sentiment: SentimentType;
  topic?: string;
  category?: KnowledgeCategory;
  messages: AIMessage[];
  assigned_admin_id?: string;
  assigned_admin_name?: string;
  started_at: Date;
  updated_at: Date;
  resolved_at?: Date;
  satisfaction_rating?: number;
  tags: string[];
  metadata?: Record<string, any>;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  content: string;
  category: KnowledgeCategory;
  keywords: string[];
  priority: number;
  is_active: boolean;
  usage_count: number;
  helpful_count: number;
  not_helpful_count: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

export interface AIFallbackResponse {
  message: string;
  should_escalate: boolean;
  suggested_category?: KnowledgeCategory;
  confidence: number;
}

export interface SupportAnalytics {
  total_conversations: number;
  active_conversations: number;
  resolved_today: number;
  avg_response_time_ms: number;
  avg_resolution_time_ms: number;
  satisfaction_avg: number;
  top_categories: { category: string; count: number }[];
  admin_activity: { admin_id: string; conversations_handled: number }[];
  escalation_rate: number;
}

// =============================================================================
// AI SUPPORT SERVICE
// =============================================================================

export class AISupportService {
  private conversations: Map<string, AIConversation> = new Map();
  private knowledgeBase: Map<string, KnowledgeArticle> = new Map();
  private persistence: PersistenceManager | null = null;

  constructor() {
    this.seedKnowledgeBase();
  }

  registerPersistence(pm: PersistenceManager): void {
    this.persistence = pm;
    pm.register('ai_conversations', this.conversations);
    pm.register('ai_knowledge_base', this.knowledgeBase);
  }

  // ===========================================================================
  // CONVERSATION MANAGEMENT
  // ===========================================================================

  /**
   * Start a new conversation or resume an existing one
   */
  startConversation(
    userId: string,
    userName?: string,
    userEmail?: string,
    initialMessage?: string
  ): AIConversation {
    // Check for existing active conversation
    for (const conv of this.conversations.values()) {
      if (conv.user_id === userId && (conv.status === 'active' || conv.status === 'waiting')) {
        // Resume existing conversation
        if (initialMessage) {
          this.addMessage(conv.id, userId, initialMessage, 'user');
        }
        return conv;
      }
    }

    const convId = this.generateId('conv');
    const conversation: AIConversation = {
      id: convId,
      user_id: userId,
      user_name: userName,
      user_email: userEmail,
      status: 'active',
      sentiment: 'neutral',
      messages: [],
      started_at: new Date(),
      updated_at: new Date(),
      tags: []
    };

    this.conversations.set(convId, conversation);
    this.dirty();

    // Add system message
    this.addMessage(convId, 'system', 'Conversation started. AI assistant is ready to help.', 'system');

    // Add initial user message if provided
    if (initialMessage) {
      this.addMessage(convId, userId, initialMessage, 'user');
    } else {
      // Send welcome message
      this.addMessage(convId, 'ai',
        'Welcome to TurboPay Support! I can help you with:\n\n' +
        '- Transaction questions and troubleshooting\n' +
        '- Wallet and balance inquiries\n' +
        '- Payment methods and fees\n' +
        '- KYC and account verification\n' +
        '- Bill payments\n\n' +
        'How can I assist you today?',
        'ai', undefined, 1.0
      );
    }

    return conversation;
  }

  /**
   * Send a message in a conversation (user or admin)
   */
  sendMessage(
    conversationId: string,
    senderId: string,
    content: string,
    role: MessageRole = 'user',
    adminName?: string
  ): AIMessage {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error('Conversation not found');

    const message = this.addMessage(conversationId, senderId, content, role, adminName);
    conv.updated_at = new Date();

    // If admin sends, keep status as taken_over
    if (role === 'admin') {
      conv.status = 'taken_over';
      conv.sentiment = 'neutral'; // Admin is handling
    }

    // If user sends while in taken_over status, keep it
    if (role === 'user' && conv.status === 'taken_over') {
      // Admin is handling, just add the message
    }

    // If AI is handling, generate AI response
    if (role === 'user' && conv.status === 'active') {
      this.generateAIResponse(conv, content);
    }

    this.dirty();
    return message;
  }

  /**
   * Admin takes over a conversation
   */
  takeOverConversation(
    conversationId: string,
    adminId: string,
    adminName: string
  ): AIConversation {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error('Conversation not found');

    conv.status = 'taken_over';
    conv.assigned_admin_id = adminId;
    conv.assigned_admin_name = adminName;
    conv.updated_at = new Date();

    // Notify user
    this.addMessage(conversationId, 'system',
      `${adminName} has joined the conversation and will assist you directly.`,
      'system'
    );

    this.dirty();
    return conv;
  }

  /**
   * Admin releases conversation back to AI
   */
  releaseConversation(conversationId: string): AIConversation {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error('Conversation not found');

    conv.status = 'active';
    conv.assigned_admin_id = undefined;
    conv.assigned_admin_name = undefined;
    conv.updated_at = new Date();

    this.addMessage(conversationId, 'system',
      'Admin has released the conversation. AI assistant is back online.',
      'system'
    );

    this.dirty();
    return conv;
  }

  /**
   * Resolve a conversation
   */
  resolveConversation(
    conversationId: string,
    rating?: number
  ): AIConversation {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error('Conversation not found');

    conv.status = 'resolved';
    conv.resolved_at = new Date();
    conv.updated_at = new Date();
    if (rating !== undefined) conv.satisfaction_rating = rating;

    this.addMessage(conversationId, 'system',
      'Conversation resolved. Thank you for using TurboPay Support!',
      'system'
    );

    this.dirty();
    return conv;
  }

  /**
   * Close a conversation
   */
  closeConversation(conversationId: string): void {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error('Conversation not found');
    conv.status = 'closed';
    conv.updated_at = new Date();
    this.dirty();
  }

  /**
   * Add tags to a conversation
   */
  tagConversation(conversationId: string, tags: string[]): void {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error('Conversation not found');
    conv.tags = [...new Set([...conv.tags, ...tags])];
    conv.updated_at = new Date();
    this.dirty();
  }

  // ===========================================================================
  // AI RESPONSE GENERATION
  // ===========================================================================

  private generateAIResponse(conv: AIConversation, userMessage: string): void {
    const lowerMsg = userMessage.toLowerCase();

    // Detect sentiment
    conv.sentiment = this.detectSentiment(lowerMsg);

    // Detect category
    const category = this.detectCategory(lowerMsg);
    if (category) conv.category = category;

    // Search knowledge base for relevant articles
    const relevantArticles = this.searchKnowledgeBase(userMessage, category);

    if (relevantArticles.length > 0) {
      // Use the most relevant article
      const article = relevantArticles[0];
      article.usage_count++;

      // Build response from article
      let response = article.content;

      // Add context about the user's issue
      if (conv.sentiment === 'frustrated' || conv.sentiment === 'negative') {
        response = 'I understand this is frustrating. Let me help you resolve this.\n\n' + response;
      }

      this.addMessage(conv.id, 'ai', response, 'ai', undefined, 0.85);

      // Ask if resolved
      this.addMessage(conv.id, 'ai',
        'Does this answer your question? If you need more help, I can connect you with a support agent.',
        'ai', undefined, 0.9
      );
    } else {
      // No relevant knowledge base article — use pattern matching
      const fallback = this.getFallbackResponse(lowerMsg, conv);

      if (fallback.should_escalate) {
        // Escalate to admin
        conv.status = 'waiting';
        this.addMessage(conv.id, 'ai',
          'I want to make sure you get the best help. Let me connect you with a support agent who can assist you further.',
          'ai', undefined, 0.6
        );
        this.addMessage(conv.id, 'system',
          'Conversation is waiting for an admin to take over.',
          'system'
        );
      } else {
        this.addMessage(conv.id, 'ai', fallback.message, 'ai', undefined, fallback.confidence);
      }
    }

    this.dirty();
  }

  private detectSentiment(message: string): SentimentType {
    const frustratedWords = ['angry', 'furious', 'unacceptable', 'terrible', 'worst', 'scam', 'fraud', 'stolen', 'lost my money'];
    const negativeWords = ['failed', 'error', 'problem', 'issue', 'not working', 'broken', 'stuck', 'pending', 'declined', 'wrong'];
    const positiveWords = ['thanks', 'thank you', 'great', 'perfect', 'awesome', 'good', 'helpful', 'resolved'];

    if (frustratedWords.some(w => message.includes(w))) return 'frustrated';
    if (negativeWords.some(w => message.includes(w))) return 'negative';
    if (positiveWords.some(w => message.includes(w))) return 'positive';
    return 'neutral';
  }

  private detectCategory(message: string): KnowledgeCategory | undefined {
    const categoryKeywords: Record<KnowledgeCategory, string[]> = {
      general: ['hello', 'hi', 'help', 'support'],
      transactions: ['transaction', 'payment', 'paid', 'charge', 'deducted', 'debited'],
      wallet: ['wallet', 'balance', 'fund', 'funding', 'credit', 'debit'],
      kyc: ['kyc', 'verify', 'verification', 'bvn', 'nin', 'identity', 'document'],
      payments: ['pay', 'payment', 'card', 'bank transfer', 'ussd', 'qr'],
      transfers: ['transfer', 'send', 'withdraw', 'payout', 'disbursement'],
      bills: ['bill', 'electricity', 'airtime', 'data', 'cable', 'internet', 'education'],
      cards: ['card', 'virtual card', 'block', 'unblock', 'freeze'],
      providers: ['provider', 'paystack', 'flutterwave', 'mtn', 'airtel', 'mpesa', 'paga'],
      security: ['security', 'password', 'pin', 'otp', 'login', 'account', 'hack'],
      account: ['account', 'register', 'signup', 'profile', 'email', 'phone'],
      fees: ['fee', 'charge', 'cost', 'pricing', 'rate', 'markup'],
      compliance: ['compliance', 'pci', 'gdpr', 'regulation', 'license']
    };

    for (const [cat, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(k => message.includes(k))) {
        return cat as KnowledgeCategory;
      }
    }
    return undefined;
  }

  private searchKnowledgeBase(query: string, category?: KnowledgeCategory): KnowledgeArticle[] {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scored: { article: KnowledgeArticle; score: number }[] = [];

    for (const article of this.knowledgeBase.values()) {
      if (!article.is_active) continue;

      let score = 0;

      // Category match
      if (category && article.category === category) score += 3;

      // Keyword match
      for (const word of queryWords) {
        if (article.keywords.some(k => k.includes(word) || word.includes(k))) score += 2;
        if (article.title.toLowerCase().includes(word)) score += 1;
        if (article.content.toLowerCase().includes(word)) score += 0.5;
      }

      // Priority boost
      score += article.priority * 0.1;

      if (score > 0) {
        scored.push({ article, score });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .map(s => s.article)
      .slice(0, 3);
  }

  private getFallbackResponse(message: string, conv: AIConversation): AIFallbackResponse {
    // Greeting
    if (/^(hi|hello|hey|good\s*(morning|afternoon|evening))/.test(message)) {
      return {
        message: 'Hello! Welcome to TurboPay Support. How can I help you today?',
        should_escalate: false,
        confidence: 0.95
      };
    }

    // Farewell
    if (/^(bye|goodbye|thanks|thank you)/.test(message)) {
      return {
        message: 'You\'re welcome! If you need anything else, don\'t hesitate to reach out. Have a great day!',
        should_escalate: false,
        confidence: 0.9
      };
    }

    // Status check
    if (message.includes('status') || message.includes('where') || message.includes('when')) {
      return {
        message: 'I can help you check your transaction status. Could you please provide your transaction reference number? You can find it in your transaction history or in the confirmation message you received.',
        should_escalate: false,
        suggested_category: 'transactions',
        confidence: 0.7
      };
    }

    // Help
    if (message.includes('help') || message.includes('what can you')) {
      return {
        message: 'I can assist you with:\n\n' +
          '1. Transaction issues (failed, pending, reversed)\n' +
          '2. Wallet and balance questions\n' +
          '3. Payment methods and supported providers\n' +
          '4. KYC verification help\n' +
          '5. Bill payment guidance\n' +
          '6. Fees and charges information\n' +
          '7. Account security\n\n' +
          'Just describe your issue and I\'ll do my best to help!',
        should_escalate: false,
        confidence: 0.9
      };
    }

    // Complaint / frustration
    if (conv.sentiment === 'frustrated' || conv.sentiment === 'negative') {
      return {
        message: 'I understand your frustration and I apologize for the inconvenience. Let me connect you with a support agent who can resolve this for you.',
        should_escalate: true,
        confidence: 0.8
      };
    }

    // Default — escalate to admin
    return {
      message: 'I want to make sure you get the right help. Let me connect you with a support agent.',
      should_escalate: true,
      confidence: 0.5
    };
  }

  // ===========================================================================
  // KNOWLEDGE BASE MANAGEMENT
  // ===========================================================================

  createArticle(
    data: Omit<KnowledgeArticle, 'id' | 'usage_count' | 'helpful_count' | 'not_helpful_count' | 'created_at' | 'updated_at'>,
    createdBy: string
  ): KnowledgeArticle {
    const article: KnowledgeArticle = {
      ...data,
      id: this.generateId('kb'),
      usage_count: 0,
      helpful_count: 0,
      not_helpful_count: 0,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.knowledgeBase.set(article.id, article);
    this.dirty();
    return article;
  }

  updateArticle(id: string, updates: Partial<KnowledgeArticle>): KnowledgeArticle | null {
    const article = this.knowledgeBase.get(id);
    if (!article) return null;
    const updated = { ...article, ...updates, updated_at: new Date() };
    this.knowledgeBase.set(id, updated);
    this.dirty();
    return updated;
  }

  deleteArticle(id: string): boolean {
    const deleted = this.knowledgeBase.delete(id);
    if (deleted) this.dirty();
    return deleted;
  }

  getArticle(id: string): KnowledgeArticle | undefined {
    return this.knowledgeBase.get(id);
  }

  getAllArticles(): KnowledgeArticle[] {
    return Array.from(this.knowledgeBase.values())
      .sort((a, b) => b.priority - a.priority);
  }

  getArticlesByCategory(category: KnowledgeCategory): KnowledgeArticle[] {
    return this.getAllArticles().filter(a => a.category === category && a.is_active);
  }

  markArticleHelpful(id: string, helpful: boolean): void {
    const article = this.knowledgeBase.get(id);
    if (!article) return;
    if (helpful) article.helpful_count++;
    else article.not_helpful_count++;
    article.updated_at = new Date();
    this.dirty();
  }

  // ===========================================================================
  // CONVERSATION QUERIES
  // ===========================================================================

  getConversation(id: string): AIConversation | undefined {
    return this.conversations.get(id);
  }

  getUserConversations(userId: string): AIConversation[] {
    return Array.from(this.conversations.values())
      .filter(c => c.user_id === userId)
      .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
  }

  getActiveConversations(): AIConversation[] {
    return Array.from(this.conversations.values())
      .filter(c => c.status === 'active' || c.status === 'waiting')
      .sort((a, b) => a.updated_at.getTime() - b.updated_at.getTime());
  }

  getWaitingConversations(): AIConversation[] {
    return Array.from(this.conversations.values())
      .filter(c => c.status === 'waiting')
      .sort((a, b) => a.updated_at.getTime() - b.updated_at.getTime());
  }

  getTakenOverConversations(adminId?: string): AIConversation[] {
    return Array.from(this.conversations.values())
      .filter(c => c.status === 'taken_over' && (!adminId || c.assigned_admin_id === adminId))
      .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
  }

  getRecentConversations(limit: number = 20): AIConversation[] {
    return Array.from(this.conversations.values())
      .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())
      .slice(0, limit);
  }

  // ===========================================================================
  // ANALYTICS
  // ===========================================================================

  getAnalytics(): SupportAnalytics {
    const all = Array.from(this.conversations.values());
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const active = all.filter(c => c.status === 'active' || c.status === 'waiting').length;
    const resolvedToday = all.filter(c =>
      c.status === 'resolved' && c.resolved_at && c.resolved_at >= today
    ).length;

    // Category counts
    const categoryCounts: Record<string, number> = {};
    for (const conv of all) {
      const cat = conv.category || 'general';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
    const topCategories = Object.entries(categoryCounts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Admin activity
    const adminCounts: Record<string, number> = {};
    for (const conv of all) {
      if (conv.assigned_admin_id) {
        adminCounts[conv.assigned_admin_id] = (adminCounts[conv.assigned_admin_id] || 0) + 1;
      }
    }
    const adminActivity = Object.entries(adminCounts)
      .map(([admin_id, conversations_handled]) => ({ admin_id, conversations_handled }));

    // Satisfaction
    const rated = all.filter(c => c.satisfaction_rating !== undefined);
    const satisfactionAvg = rated.length > 0
      ? rated.reduce((sum, c) => sum + (c.satisfaction_rating || 0), 0) / rated.length
      : 0;

    // Escalation rate
    const escalated = all.filter(c => c.status === 'waiting' || c.status === 'taken_over').length;
    const escalationRate = all.length > 0 ? (escalated / all.length) * 100 : 0;

    return {
      total_conversations: all.length,
      active_conversations: active,
      resolved_today: resolvedToday,
      avg_response_time_ms: 0, // Would need message timestamps to calculate
      avg_resolution_time_ms: 0, // Would need resolution timestamps
      satisfaction_avg: Math.round(satisfactionAvg * 10) / 10,
      top_categories: topCategories,
      admin_activity: adminActivity,
      escalation_rate: Math.round(escalationRate * 10) / 10
    };
  }

  // ===========================================================================
  // SEED KNOWLEDGE BASE
  // ===========================================================================

  private seedKnowledgeBase(): void {
    const articles: Omit<KnowledgeArticle, 'id' | 'usage_count' | 'helpful_count' | 'not_helpful_count' | 'created_at' | 'updated_at'>[] = [
      {
        title: 'How to fund your TurboPay wallet',
        content: 'You can fund your TurboPay wallet using:\n\n1. **Bank Transfer** — Transfer to your virtual account number. Funds arrive instantly.\n2. **Card Payment** — Use your debit/credit card via Paystack or Flutterwave.\n3. **Mobile Money** — Use MTN MoMo, Airtel Money, M-Pesa, or Paga depending on your country.\n4. **USSD** — Dial the USSD code for your bank.\n\nAll funding methods are available in the "Fund Wallet" section of your dashboard.',
        category: 'wallet',
        keywords: ['fund', 'wallet', 'top up', 'add money', 'deposit', 'credit'],
        priority: 10,
        is_active: true,
        created_by: 'system'
      },
      {
        title: 'Transaction failed or pending',
        content: 'If your transaction failed or is stuck on pending:\n\n1. Wait 5-10 minutes — some transactions take time to process.\n2. Check your transaction history for the latest status.\n3. If the amount was deducted but the recipient didn\'t receive it, it will be reversed within 24 hours.\n4. For urgent issues, please provide your transaction reference and I\'ll escalate to a support agent.\n\nFailed transactions are automatically reversed to your wallet.',
        category: 'transactions',
        keywords: ['failed', 'pending', 'stuck', 'not received', 'reversed', 'deducted'],
        priority: 9,
        is_active: true,
        created_by: 'system'
      },
      {
        title: 'Supported payment providers by country',
        content: '**Nigeria:** Paystack, Flutterwave, Monnify, Remita, Quickteller, Paga, SmartCash, MTN MoMo\n**Ghana:** Flutterwave, Paystack, MTN MoMo, Airtel Money, Onafriq\n**Kenya:** Flutterwave, M-Pesa, Airtel Money, Paystack\n**South Africa:** Paystack, Flutterwave, Onafriq\n**Uganda:** Flutterwave, MTN MoMo, Airtel Money\n**Tanzania:** Flutterwave, MTN MoMo, Airtel Money\n\nThe system automatically selects the best provider for your country.',
        category: 'providers',
        keywords: ['provider', 'paystack', 'flutterwave', 'mtn', 'airtel', 'mpesa', 'paga', 'supported', 'country'],
        priority: 8,
        is_active: true,
        created_by: 'system'
      },
      {
        title: 'KYC verification requirements',
        content: 'To verify your identity on TurboPay:\n\n**Nigeria:** BVN (Bank Verification Number) required for transfers above ₦50,000\n**Ghana:** Ghana Card required\n**Kenya:** National ID or Passport\n**South Africa:** FICA verification\n\nKYC verification unlocks higher transaction limits and additional features. You can complete verification from your account settings.',
        category: 'kyc',
        keywords: ['kyc', 'verify', 'verification', 'bvn', 'nin', 'identity', 'document', 'limits'],
        priority: 7,
        is_active: true,
        created_by: 'system'
      },
      {
        title: 'Transaction fees and charges',
        content: 'TurboPay charges transparent fees that vary by provider and transaction type:\n\n- **Collections (funding):** 1.0% - 2.0% depending on provider\n- **Transfers (payouts):** ₦10 - ₦50 flat fee + variable percentage\n- **Bill payments:** 1.0% - 1.5%\n- **Currency conversion:** 0.5% - 2.5% depending on corridor\n\nFees are displayed before you confirm any transaction. The system automatically selects the lowest-cost provider for your transaction.',
        category: 'fees',
        keywords: ['fee', 'charge', 'cost', 'pricing', 'rate', 'how much', 'expensive'],
        priority: 7,
        is_active: true,
        created_by: 'system'
      },
      {
        title: 'How to send money internationally',
        content: 'To send money to another country:\n\n1. Go to "Send Money" → "International"\n2. Select the destination country\n3. Enter the amount in your local currency\n4. The system will show you the exchange rate and fees\n5. Confirm and send\n\nSupported corridors include Nigeria ↔ Ghana, Nigeria ↔ Kenya, Kenya ↔ Uganda, and more. Settlement times range from instant to T+2 depending on the corridor.',
        category: 'transfers',
        keywords: ['international', 'send', 'cross border', 'exchange rate', 'corridor', 'abroad'],
        priority: 6,
        is_active: true,
        created_by: 'system'
      },
      {
        title: 'Bill payment guide',
        content: 'Pay bills directly from your TurboPay wallet:\n\n**Electricity:** IKEDC, EKEDC, AEDC, EEDC, PHED, and more\n**Internet:** Smile, Spectranet, FiberOne, Airtel Broadband, MTN Broadband\n**Cable TV:** DSTV, GOtv, Startimes\n**Airtime & Data:** MTN, Airtel, Glo, 9mobile\n**Education:** WAEC, NECO, JAMB\n\nSelect "Pay Bills" → Choose category → Select provider → Enter details → Pay.',
        category: 'bills',
        keywords: ['bill', 'electricity', 'airtime', 'data', 'cable', 'tv', 'internet', 'education'],
        priority: 6,
        is_active: true,
        created_by: 'system'
      },
      {
        title: 'Account security and password reset',
        content: 'To keep your account secure:\n\n1. Use a strong, unique password\n2. Enable two-factor authentication (2FA)\n3. Never share your OTP or PIN with anyone\n4. Log out from shared devices\n\n**Forgot password?** Click "Forgot Password" on the login page. You\'ll receive a reset link via email.\n\n**Suspected unauthorized access?** Contact support immediately to freeze your account.',
        category: 'security',
        keywords: ['password', 'security', 'hack', 'unauthorized', 'otp', 'pin', '2fa', 'reset'],
        priority: 8,
        is_active: true,
        created_by: 'system'
      },
      {
        title: 'Virtual card creation and management',
        content: 'Create and manage virtual cards:\n\n1. Go to "Cards" → "Create Card"\n2. Select currency and set spending limit\n3. Fund the card from your wallet\n\n**Card actions:**\n- **Block:** Temporarily freeze the card\n- **Unblock:** Reactivate a frozen card\n- **View details:** See card number, expiry, CVV\n\nVirtual cards work online everywhere Visa/Mastercard is accepted.',
        category: 'cards',
        keywords: ['card', 'virtual', 'create', 'block', 'unblock', 'online', 'payment'],
        priority: 5,
        is_active: true,
        created_by: 'system'
      },
      {
        title: 'Multi-currency wallet',
        content: 'TurboPay supports multiple currency wallets:\n\n- **NGN** (Nigerian Naira)\n- **GHS** (Ghanaian Cedi)\n- **KES** (Kenyan Shilling)\n- **ZAR** (South African Rand)\n- **USD** (US Dollar)\n- **EUR** (Euro)\n- **GBP** (British Pound)\n\nYou can hold balances in multiple currencies and convert between them at competitive exchange rates. Each wallet has its own balance, transaction history, and funding options.',
        category: 'wallet',
        keywords: ['currency', 'wallet', 'multi', 'convert', 'exchange', 'usd', 'eur', 'gbp'],
        priority: 5,
        is_active: true,
        created_by: 'system'
      }
    ];

    for (const article of articles) {
      this.createArticle(article, 'system');
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private addMessage(
    conversationId: string,
    senderId: string,
    content: string,
    role: MessageRole,
    adminName?: string,
    confidence?: number
  ): AIMessage {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error('Conversation not found');

    const message: AIMessage = {
      id: this.generateId('msg'),
      conversation_id: conversationId,
      role,
      content,
      timestamp: new Date(),
      confidence,
      admin_id: role === 'admin' ? senderId : undefined,
      admin_name: adminName
    };

    conv.messages.push(message);
    conv.updated_at = new Date();
    this.dirty();
    return message;
  }

  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }

  private dirty(): void {
    this.persistence?.markDirty('ai_conversations');
    this.persistence?.markDirty('ai_knowledge_base');
  }
}

export default AISupportService;
