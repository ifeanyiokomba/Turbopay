// TurboPay Notification Engine
// Real-time alerts via push, email, SMS, and in-app notifications
// Supports WebSocket for live updates, preferences per user, and admin management
//
// Architecture:
// - Event-driven: services emit events, notification engine routes them
// - Multi-channel: email, SMS, push, in-app
// - User preferences: each user controls which channels receive which notifications
// - Admin dashboard: view all notifications, send manual alerts, manage templates

import { PersistenceManager } from '../utils/persistence';

// =============================================================================
// TYPES
// =============================================================================

export type NotificationChannel = 'email' | 'sms' | 'push' | 'in_app';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type NotificationCategory =
  | 'transaction'
  | 'security'
  | 'account'
  | 'kyc'
  | 'wallet'
  | 'transfer'
  | 'bill_payment'
  | 'card'
  | 'compliance'
  | 'system'
  | 'marketing';

export type NotificationEventType =
  | 'payment.success'
  | 'payment.failed'
  | 'payment.pending'
  | 'transfer.success'
  | 'transfer.failed'
  | 'transfer.pending'
  | 'wallet.credited'
  | 'wallet.debited'
  | 'wallet.low_balance'
  | 'kyc.submitted'
  | 'kyc.approved'
  | 'kyc.rejected'
  | 'security.login'
  | 'security.password_changed'
  | 'security.suspicious_activity'
  | 'card.created'
  | 'card.blocked'
  | 'card.transaction'
  | 'bill.paid'
  | 'bill.failed'
  | 'account.verified'
  | 'account.suspended'
  | 'system.maintenance'
  | 'system.update'
  | 'custom';

export interface NotificationTemplate {
  id: string;
  event_type: NotificationEventType;
  category: NotificationCategory;
  channel: NotificationChannel;
  subject?: string;
  title: string;
  body: string;
  variables: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Notification {
  id: string;
  user_id: string;
  event_type: NotificationEventType;
  category: NotificationCategory;
  title: string;
  body: string;
  channels: NotificationChannel[];
  priority: NotificationPriority;
  status: Record<NotificationChannel, 'pending' | 'sent' | 'delivered' | 'failed' | 'disabled'>;
  read: boolean;
  read_at?: Date;
  action_url?: string;
  metadata?: Record<string, any>;
  created_at: Date;
  delivered_at?: Date;
}

export interface NotificationPreferences {
  user_id: string;
  channels: Record<NotificationCategory, NotificationChannel[]>;
  quiet_hours_start?: string; // HH:mm
  quiet_hours_end?: string;
  timezone: string;
  updated_at: Date;
}

export interface NotificationStats {
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  read: number;
  unread: number;
  by_channel: Record<NotificationChannel, number>;
  by_category: Record<string, number>;
  by_priority: Record<string, number>;
}

// WebSocket connection for real-time push
export interface NotificationSocket {
  user_id: string;
  socket_id: string;
  connected_at: Date;
  last_heartbeat: Date;
}

// =============================================================================
// NOTIFICATION ENGINE
// =============================================================================

export class NotificationEngine {
  private notifications: Map<string, Notification> = new Map();
  private templates: Map<string, NotificationTemplate> = new Map();
  private preferences: Map<string, NotificationPreferences> = new Map();
  private sockets: Map<string, NotificationSocket> = new Map();
  private eventHandlers: Map<NotificationEventType, ((notification: Notification) => Promise<void>)[]> = new Map();
  private persistence: PersistenceManager | null = null;

  constructor() {
    this.seedDefaultTemplates();
  }

  registerPersistence(pm: PersistenceManager): void {
    this.persistence = pm;
    pm.register('notifications', this.notifications);
    pm.register('notification_templates', this.templates);
    pm.register('notification_preferences', this.preferences);
  }

  // ===========================================================================
  // CORE: Emit a notification event
  // ===========================================================================

  /**
   * Emit a notification event — the main entry point
   * Other services call this to trigger notifications
   */
  async emit(
    userId: string,
    eventType: NotificationEventType,
    variables: Record<string, string> = {},
    options: {
      category?: NotificationCategory;
      priority?: NotificationPriority;
      channels?: NotificationChannel[];
      action_url?: string;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<Notification[]> {
    const sent: Notification[] = [];

    // Determine channels from user preferences or options
    const category = options.category || this.eventToCategory(eventType);
    const channels = options.channels || this.getChannelsForUser(userId, category);
    const priority = options.priority || 'normal';

    // Find matching templates
    const templates = this.getTemplatesForEvent(eventType);

    for (const channel of channels) {
      const template = templates.find(t => t.channel === channel);
      if (!template || !template.is_active) continue;

      // Build notification from template
      let title = this.interpolate(template.title, variables);
      let body = this.interpolate(template.body, variables);

      const notification: Notification = {
        id: this.generateId('notif'),
        user_id: userId,
        event_type: eventType,
        category,
        title,
        body,
        channels: [channel],
        priority,
        status: {
          email: 'pending',
          sms: 'pending',
          push: 'pending',
          in_app: 'pending'
        },
        read: false,
        action_url: options.action_url,
        metadata: options.metadata,
        created_at: new Date()
      };

      // Mark other channels as disabled
      for (const ch of ['email', 'sms', 'push', 'in_app'] as NotificationChannel[]) {
        if (ch !== channel) {
          notification.status[ch] = 'disabled';
        }
      }

      this.notifications.set(notification.id, notification);
      sent.push(notification);

      // Deliver via channel
      try {
        await this.deliver(notification, channel);
        notification.status[channel] = 'delivered';
        notification.delivered_at = new Date();
      } catch (error) {
        notification.status[channel] = 'failed';
        console.error(`[NotificationEngine] Failed to deliver ${channel}:`, error);
      }

      // Push to WebSocket if connected
      this.pushToSocket(userId, notification);
    }

    // Fire event handlers
    for (const notification of sent) {
      const handlers = this.eventHandlers.get(eventType) || [];
      for (const handler of handlers) {
        try {
          await handler(notification);
        } catch (e) {
          console.error(`[NotificationEngine] Handler error:`, e);
        }
      }
    }

    this.dirty();
    return sent;
  }

  /**
   * Emit an in-app notification (no channel delivery needed)
   */
  async emitInApp(
    userId: string,
    eventType: NotificationEventType,
    title: string,
    body: string,
    options: {
      category?: NotificationCategory;
      priority?: NotificationPriority;
      action_url?: string;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<Notification> {
    const notification: Notification = {
      id: this.generateId('notif'),
      user_id: userId,
      event_type: eventType,
      category: options.category || this.eventToCategory(eventType),
      title,
      body,
      channels: ['in_app'],
      priority: options.priority || 'normal',
      status: {
        email: 'disabled',
        sms: 'disabled',
        push: 'disabled',
        in_app: 'delivered'
      },
      read: false,
      action_url: options.action_url,
      metadata: options.metadata,
      created_at: new Date(),
      delivered_at: new Date()
    };

    this.notifications.set(notification.id, notification);
    this.pushToSocket(userId, notification);
    this.dirty();
    return notification;
  }

  // ===========================================================================
  // CHANNEL DELIVERY (stubs — integrate with real providers)
  // ===========================================================================

  private async deliver(notification: Notification, channel: NotificationChannel): Promise<void> {
    switch (channel) {
      case 'email':
        await this.sendEmail(notification);
        break;
      case 'sms':
        await this.sendSMS(notification);
        break;
      case 'push':
        await this.sendPush(notification);
        break;
      case 'in_app':
        // Already stored — nothing to deliver
        break;
    }
  }

  private async sendEmail(notification: Notification): Promise<void> {
    // TODO: Integrate with email provider (SendGrid, AWS SES, Resend)
    console.log(`[NotificationEngine] EMAIL → user:${notification.user_id} | "${notification.title}"`);
  }

  private async sendSMS(notification: Notification): Promise<void> {
    // TODO: Integrate with SMS provider (Termii, Africa's Talking)
    console.log(`[NotificationEngine] SMS → user:${notification.user_id} | "${notification.title}"`);
  }

  private async sendPush(notification: Notification): Promise<void> {
    // TODO: Integrate with push provider (Firebase, OneSignal)
    console.log(`[NotificationEngine] PUSH → user:${notification.user_id} | "${notification.title}"`);
  }

  // ===========================================================================
  // WEBSOCKET MANAGEMENT
  // ===========================================================================

  /**
   * Register a WebSocket connection for real-time push
   */
  registerSocket(userId: string, socketId: string): void {
    this.sockets.set(socketId, {
      user_id: userId,
      socket_id: socketId,
      connected_at: new Date(),
      last_heartbeat: new Date()
    });
  }

  unregisterSocket(socketId: string): void {
    this.sockets.delete(socketId);
  }

  heartbeat(socketId: string): void {
    const socket = this.sockets.get(socketId);
    if (socket) socket.last_heartbeat = new Date();
  }

  private pushToSocket(userId: string, notification: Notification): void {
    for (const socket of this.sockets.values()) {
      if (socket.user_id === userId) {
        // In production, use WebSocket.send() to push notification
        console.log(`[NotificationEngine] WS PUSH → ${socket.socket_id}: ${notification.title}`);
      }
    }
  }

  getUserSockets(userId: string): NotificationSocket[] {
    return Array.from(this.sockets.values()).filter(s => s.user_id === userId);
  }

  // ===========================================================================
  // USER NOTIFICATION QUERIES
  // ===========================================================================

  getUserNotifications(userId: string, options: {
    limit?: number;
    offset?: number;
    category?: NotificationCategory;
    unread_only?: boolean;
  } = {}): Notification[] {
    let notifs = Array.from(this.notifications.values())
      .filter(n => n.user_id === userId);

    if (options.category) {
      notifs = notifs.filter(n => n.category === options.category);
    }
    if (options.unread_only) {
      notifs = notifs.filter(n => !n.read);
    }

    notifs.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

    const offset = options.offset || 0;
    const limit = options.limit || 50;
    return notifs.slice(offset, offset + limit);
  }

  getUnreadCount(userId: string): number {
    return Array.from(this.notifications.values())
      .filter(n => n.user_id === userId && !n.read).length;
  }

  markAsRead(notificationId: string): boolean {
    const notif = this.notifications.get(notificationId);
    if (!notif) return false;
    notif.read = true;
    notif.read_at = new Date();
    this.dirty();
    return true;
  }

  markAllAsRead(userId: string): number {
    let count = 0;
    for (const notif of this.notifications.values()) {
      if (notif.user_id === userId && !notif.read) {
        notif.read = true;
        notif.read_at = new Date();
        count++;
      }
    }
    if (count > 0) this.dirty();
    return count;
  }

  deleteNotification(notificationId: string): boolean {
    const deleted = this.notifications.delete(notificationId);
    if (deleted) this.dirty();
    return deleted;
  }

  clearUserNotifications(userId: string): number {
    let count = 0;
    for (const [id, notif] of this.notifications) {
      if (notif.user_id === userId) {
        this.notifications.delete(id);
        count++;
      }
    }
    if (count > 0) this.dirty();
    return count;
  }

  // ===========================================================================
  // USER PREFERENCES
  // ===========================================================================

  getPreferences(userId: string): NotificationPreferences {
    return this.preferences.get(userId) || this.defaultPreferences(userId);
  }

  updatePreferences(userId: string, updates: Partial<NotificationPreferences>): NotificationPreferences {
    const existing = this.getPreferences(userId);
    const updated: NotificationPreferences = {
      ...existing,
      ...updates,
      user_id: userId,
      updated_at: new Date()
    };
    this.preferences.set(userId, updated);
    this.dirty();
    return updated;
  }

  private defaultPreferences(userId: string): NotificationPreferences {
    const allChannels: NotificationChannel[] = ['email', 'sms', 'push', 'in_app'];
    const channelsByCategory: Record<NotificationCategory, NotificationChannel[]> = {
      transaction: allChannels,
      security: allChannels,
      account: ['email', 'in_app'],
      kyc: ['email', 'in_app'],
      wallet: ['email', 'push', 'in_app'],
      transfer: allChannels,
      bill_payment: ['push', 'in_app'],
      card: ['push', 'in_app'],
      compliance: ['email'],
      system: ['in_app'],
      marketing: ['email']
    };

    return {
      user_id: userId,
      channels: channelsByCategory,
      timezone: 'Africa/Lagos',
      updated_at: new Date()
    };
  }

  private getChannelsForUser(userId: string, category: NotificationCategory): NotificationChannel[] {
    const prefs = this.getPreferences(userId);
    return prefs.channels[category] || ['in_app'];
  }

  // ===========================================================================
  // TEMPLATES
  // ===========================================================================

  createTemplate(data: Omit<NotificationTemplate, 'id' | 'created_at' | 'updated_at'>): NotificationTemplate {
    const template: NotificationTemplate = {
      ...data,
      id: this.generateId('tmpl'),
      created_at: new Date(),
      updated_at: new Date()
    };
    this.templates.set(template.id, template);
    this.dirty();
    return template;
  }

  updateTemplate(id: string, updates: Partial<NotificationTemplate>): NotificationTemplate | null {
    const template = this.templates.get(id);
    if (!template) return null;
    const updated = { ...template, ...updates, updated_at: new Date() };
    this.templates.set(id, updated);
    this.dirty();
    return updated;
  }

  deleteTemplate(id: string): boolean {
    const deleted = this.templates.delete(id);
    if (deleted) this.dirty();
    return deleted;
  }

  getAllTemplates(): NotificationTemplate[] {
    return Array.from(this.templates.values());
  }

  getTemplatesForEvent(eventType: NotificationEventType): NotificationTemplate[] {
    return Array.from(this.templates.values())
      .filter(t => t.event_type === eventType && t.is_active);
  }

  // ===========================================================================
  // EVENT HANDLER REGISTRATION
  // ===========================================================================

  on(eventType: NotificationEventType, handler: (notification: Notification) => Promise<void>): void {
    const handlers = this.eventHandlers.get(eventType) || [];
    handlers.push(handler);
    this.eventHandlers.set(eventType, handlers);
  }

  // ===========================================================================
  // ADMIN ANALYTICS
  // ===========================================================================

  getStats(options: {
    start_date?: Date;
    end_date?: Date;
    user_id?: string;
  } = {}): NotificationStats {
    let notifs = Array.from(this.notifications.values());

    if (options.start_date) {
      notifs = notifs.filter(n => n.created_at >= options.start_date!);
    }
    if (options.end_date) {
      notifs = notifs.filter(n => n.created_at <= options.end_date!);
    }
    if (options.user_id) {
      notifs = notifs.filter(n => n.user_id === options.user_id);
    }

    const byChannel: Record<NotificationChannel, number> = { email: 0, sms: 0, push: 0, in_app: 0 };
    const byCategory: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let sent = 0, delivered = 0, failed = 0, read = 0;

    for (const n of notifs) {
      for (const ch of n.channels) {
        if (n.status[ch] === 'delivered' || n.status[ch] === 'sent') {
          byChannel[ch]++;
        }
      }
      byCategory[n.category] = (byCategory[n.category] || 0) + 1;
      byPriority[n.priority] = (byPriority[n.priority] || 0) + 1;
      if (n.read) read++;
      for (const ch of n.channels) {
        if (n.status[ch] === 'sent') sent++;
        if (n.status[ch] === 'delivered') delivered++;
        if (n.status[ch] === 'failed') failed++;
      }
    }

    return {
      total: notifs.length,
      sent,
      delivered,
      failed,
      read,
      unread: notifs.filter(n => !n.read).length,
      by_channel: byChannel,
      by_category: byCategory,
      by_priority: byPriority
    };
  }

  getRecentNotifications(limit: number = 50): Notification[] {
    return Array.from(this.notifications.values())
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit);
  }

  // ===========================================================================
  // SEED DEFAULT TEMPLATES
  // ===========================================================================

  private seedDefaultTemplates(): void {
    const templates: Omit<NotificationTemplate, 'id' | 'created_at' | 'updated_at'>[] = [
      // Transaction notifications
      { event_type: 'payment.success', category: 'transaction', channel: 'email', subject: 'Payment Successful', title: 'Payment Confirmed', body: 'Your payment of {amount} {currency} has been confirmed. Reference: {reference}', variables: ['amount', 'currency', 'reference'], is_active: true },
      { event_type: 'payment.success', category: 'transaction', channel: 'push', title: 'Payment Confirmed', body: '{amount} {currency} payment successful — Ref: {reference}', variables: ['amount', 'currency', 'reference'], is_active: true },
      { event_type: 'payment.failed', category: 'transaction', channel: 'email', subject: 'Payment Failed', title: 'Payment Failed', body: 'Your payment of {amount} {currency} could not be processed. Reason: {reason}', variables: ['amount', 'currency', 'reason'], is_active: true },
      { event_type: 'payment.failed', category: 'transaction', channel: 'push', title: 'Payment Failed', body: '{amount} {currency} payment failed — {reason}', variables: ['amount', 'currency', 'reason'], is_active: true },
      { event_type: 'payment.pending', category: 'transaction', channel: 'push', title: 'Payment Processing', body: 'Your {amount} {currency} payment is being processed.', variables: ['amount', 'currency'], is_active: true },

      // Transfer notifications
      { event_type: 'transfer.success', category: 'transfer', channel: 'email', subject: 'Transfer Completed', title: 'Transfer Successful', body: 'Your transfer of {amount} {currency} to {recipient} has been completed. Ref: {reference}', variables: ['amount', 'currency', 'recipient', 'reference'], is_active: true },
      { event_type: 'transfer.success', category: 'transfer', channel: 'push', title: 'Transfer Sent', body: '{amount} {currency} sent to {recipient} successfully', variables: ['amount', 'currency', 'recipient'], is_active: true },
      { event_type: 'transfer.failed', category: 'transfer', channel: 'email', subject: 'Transfer Failed', title: 'Transfer Failed', body: 'Your transfer of {amount} {currency} to {recipient} failed. Reason: {reason}', variables: ['amount', 'currency', 'recipient', 'reason'], is_active: true },

      // Wallet notifications
      { event_type: 'wallet.credited', category: 'wallet', channel: 'email', subject: 'Wallet Credited', title: 'Wallet Funded', body: 'Your {currency} wallet has been credited with {amount}. New balance: {balance}', variables: ['currency', 'amount', 'balance'], is_active: true },
      { event_type: 'wallet.credited', category: 'wallet', channel: 'push', title: 'Wallet Funded', body: '{amount} {currency} added to your wallet', variables: ['amount', 'currency'], is_active: true },
      { event_type: 'wallet.debited', category: 'wallet', channel: 'push', title: 'Wallet Debited', body: '{amount} {currency} deducted from your wallet', variables: ['amount', 'currency'], is_active: true },
      { event_type: 'wallet.low_balance', category: 'wallet', channel: 'push', title: 'Low Balance Alert', body: 'Your {currency} wallet balance is low: {balance}', variables: ['currency', 'balance'], is_active: true },

      // Security notifications
      { event_type: 'security.login', category: 'security', channel: 'email', subject: 'New Login Detected', title: 'New Login', body: 'A new login was detected on your account from {device} at {time}.', variables: ['device', 'time'], is_active: true },
      { event_type: 'security.login', category: 'security', channel: 'push', title: 'New Login', body: 'New login from {device}', variables: ['device'], is_active: true },
      { event_type: 'security.password_changed', category: 'security', channel: 'email', subject: 'Password Changed', title: 'Password Updated', body: 'Your password was changed at {time}. If this wasn\'t you, contact support immediately.', variables: ['time'], is_active: true },
      { event_type: 'security.suspicious_activity', category: 'security', channel: 'email', subject: 'Suspicious Activity Detected', title: 'Security Alert', body: 'We detected suspicious activity on your account: {details}. Please verify your identity.', variables: ['details'], is_active: true },
      { event_type: 'security.suspicious_activity', category: 'security', channel: 'push', title: 'Security Alert', body: 'Suspicious activity detected on your account', variables: [], is_active: true },

      // KYC notifications
      { event_type: 'kyc.submitted', category: 'kyc', channel: 'email', subject: 'KYC Submitted', title: 'Verification Submitted', body: 'Your identity verification has been submitted and is being reviewed.', variables: [], is_active: true },
      { event_type: 'kyc.approved', category: 'kyc', channel: 'email', subject: 'KYC Approved', title: 'Verification Approved', body: 'Your identity has been verified. Your transaction limits have been increased.', variables: [], is_active: true },
      { event_type: 'kyc.rejected', category: 'kyc', channel: 'email', subject: 'KYC Rejected', title: 'Verification Rejected', body: 'Your identity verification was not approved. Reason: {reason}. Please resubmit.', variables: ['reason'], is_active: true },

      // Bill payment
      { event_type: 'bill.paid', category: 'bill_payment', channel: 'push', title: 'Bill Paid', body: '{amount} {currency} bill payment successful — {biller}', variables: ['amount', 'currency', 'biller'], is_active: true },

      // Card notifications
      { event_type: 'card.created', category: 'card', channel: 'push', title: 'Card Created', body: 'Your virtual {currency} card has been created.', variables: ['currency'], is_active: true },
      { event_type: 'card.transaction', category: 'card', channel: 'push', title: 'Card Transaction', body: '{amount} {currency} charged on your virtual card — {merchant}', variables: ['amount', 'currency', 'merchant'], is_active: true },

      // System notifications
      { event_type: 'system.maintenance', category: 'system', channel: 'in_app', title: 'Scheduled Maintenance', body: 'TurboPay will undergo maintenance on {date} from {start_time} to {end_time}.', variables: ['date', 'start_time', 'end_time'], is_active: true },
    ];

    for (const template of templates) {
      this.createTemplate(template);
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private interpolate(template: string, variables: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  }

  private eventToCategory(eventType: NotificationEventType): NotificationCategory {
    if (eventType.startsWith('payment.') || eventType.startsWith('transfer.')) return 'transaction';
    if (eventType.startsWith('wallet.')) return 'wallet';
    if (eventType.startsWith('security.')) return 'security';
    if (eventType.startsWith('kyc.')) return 'kyc';
    if (eventType.startsWith('bill.')) return 'bill_payment';
    if (eventType.startsWith('card.')) return 'card';
    if (eventType.startsWith('account.')) return 'account';
    if (eventType.startsWith('system.')) return 'system';
    return 'system';
  }

  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }

  private dirty(): void {
    this.persistence?.markDirty('notifications');
    this.persistence?.markDirty('notification_templates');
    this.persistence?.markDirty('notification_preferences');
  }
}

export default NotificationEngine;
