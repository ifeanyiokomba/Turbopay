// TurboPay Audit Log
// System-wide audit trail for all admin actions, provider interactions, and financial operations

import { ProviderName } from '../../types';

// =============================================================================
// TYPES
// =============================================================================

export type AuditEventType =
  | 'admin.login'
  | 'admin.logout'
  | 'admin.user.create'
  | 'admin.user.update'
  | 'admin.user.delete'
  | 'admin.user.role_change'
  | 'admin.user.status_toggle'
  | 'admin.password.reset'
  | 'admin.password.change'
  | 'provider.config.update'
  | 'provider.config.create'
  | 'provider.enable'
  | 'provider.disable'
  | 'provider.credential.update'
  | 'provider.credential.revoke'
  | 'provider.fee.update'
  | 'provider.health.reset'
  | 'provider.service.enable'
  | 'provider.service.disable'
  | 'transaction.initiated'
  | 'transaction.success'
  | 'transaction.failed'
  | 'transaction.refund'
  | 'transaction.reversal'
  | 'webhook.received'
  | 'webhook.processed'
  | 'webhook.failed'
  | 'ledger.credit'
  | 'ledger.debit'
  | 'ledger.hold'
  | 'ledger.release'
  | 'settlement.created'
  | 'settlement.completed'
  | 'bulk_payment.created'
  | 'bulk_payment.processed'
  | 'bulk_payment.completed'
  | 'system.error';

export interface AuditLogEntry {
  id: string;
  event: AuditEventType;
  entity_type: string;
  entity_id: string;
  actor?: string;
  actor_ip?: string;
  actor_user_agent?: string;
  changes?: Record<string, { before: any; after: any }>;
  metadata?: Record<string, any>;
  severity: 'info' | 'warning' | 'error' | 'critical';
  created_at: Date;
}

export interface AuditLogFilter {
  event?: AuditEventType;
  entity_type?: string;
  entity_id?: string;
  actor?: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  start_date?: Date;
  end_date?: Date;
  limit?: number;
  offset?: number;
}

// =============================================================================
// AUDIT LOG SERVICE
// =============================================================================

export class AuditLogService {
  private entries: AuditLogEntry[] = [];
  private readonly MAX_ENTRIES = 500000;

  // ===========================================================================
  // LOGGING
  // ===========================================================================

  log(params: {
    event: AuditEventType;
    entity_type: string;
    entity_id: string;
    actor?: string;
    actor_ip?: string;
    actor_user_agent?: string;
    changes?: Record<string, { before: any; after: any }>;
    metadata?: Record<string, any>;
    severity?: 'info' | 'warning' | 'error' | 'critical';
  }): AuditLogEntry {
    const entry: AuditLogEntry = {
      id: this.generateId(),
      event: params.event,
      entity_type: params.entity_type,
      entity_id: params.entity_id,
      actor: params.actor,
      actor_ip: params.actor_ip,
      actor_user_agent: params.actor_user_agent,
      changes: params.changes,
      metadata: params.metadata,
      severity: params.severity || this.inferSeverity(params.event),
      created_at: new Date()
    };

    this.entries.push(entry);

    // Trim old entries
    if (this.entries.length > this.MAX_ENTRIES) {
      this.entries = this.entries.slice(-this.MAX_ENTRIES);
    }

    // Console output for important events
    if (entry.severity === 'error' || entry.severity === 'critical') {
      console.error(`[AuditLog] ${entry.event}: ${entry.entity_type}/${entry.entity_id}`, entry.changes);
    } else if (entry.severity === 'warning') {
      console.warn(`[AuditLog] ${entry.event}: ${entry.entity_type}/${entry.entity_id}`);
    } else {
      console.log(`[AuditLog] ${entry.event}: ${entry.entity_type}/${entry.entity_id}`);
    }

    return entry;
  }

  // ===========================================================================
  // QUERY
  // ===========================================================================

  query(filter: AuditLogFilter): AuditLogEntry[] {
    let results = [...this.entries];

    if (filter.event) {
      results = results.filter(e => e.event === filter.event);
    }

    if (filter.entity_type) {
      results = results.filter(e => e.entity_type === filter.entity_type);
    }

    if (filter.entity_id) {
      results = results.filter(e => e.entity_id === filter.entity_id);
    }

    if (filter.actor) {
      results = results.filter(e => e.actor === filter.actor);
    }

    if (filter.severity) {
      results = results.filter(e => e.severity === filter.severity);
    }

    if (filter.start_date) {
      results = results.filter(e => e.created_at >= filter.start_date!);
    }

    if (filter.end_date) {
      results = results.filter(e => e.created_at <= filter.end_date!);
    }

    // Sort by date descending
    results.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

    // Apply pagination
    const offset = filter.offset || 0;
    const limit = filter.limit || 100;
    return results.slice(offset, offset + limit);
  }

  getEntry(id: string): AuditLogEntry | undefined {
    return this.entries.find(e => e.id === id);
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  getStats(period: 'hour' | 'day' | 'week' | 'month' = 'day'): {
    total_events: number;
    events_by_severity: Record<string, number>;
    events_by_type: Record<string, number>;
    events_by_actor: Record<string, number>;
  } {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'hour':
        startDate = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    const periodEntries = this.entries.filter(e => e.created_at >= startDate);

    const eventsBySeverity: Record<string, number> = {};
    const eventsByType: Record<string, number> = {};
    const eventsByActor: Record<string, number> = {};

    for (const entry of periodEntries) {
      eventsBySeverity[entry.severity] = (eventsBySeverity[entry.severity] || 0) + 1;
      eventsByType[entry.event] = (eventsByType[entry.event] || 0) + 1;
      if (entry.actor) {
        eventsByActor[entry.actor] = (eventsByActor[entry.actor] || 0) + 1;
      }
    }

    return {
      total_events: periodEntries.length,
      events_by_severity: eventsBySeverity,
      events_by_type: eventsByType,
      events_by_actor: eventsByActor
    };
  }

  // ===========================================================================
  // EXPORT
  // ===========================================================================

  export(format: 'json' | 'csv' = 'json', filter?: AuditLogFilter): string {
    const entries = filter ? this.query(filter) : this.entries;

    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }

    const headers = 'id,event,entity_type,entity_id,actor,severity,created_at\n';
    const rows = entries.map(e =>
      `${e.id},${e.event},${e.entity_type},${e.entity_id},${e.actor || ''},${e.severity},${e.created_at.toISOString()}`
    ).join('\n');

    return headers + rows;
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private inferSeverity(event: AuditEventType): 'info' | 'warning' | 'error' | 'critical' {
    if (event.includes('error') || event.includes('failed')) return 'error';
    if (event.includes('delete') || event.includes('revoke') || event.includes('disable')) return 'warning';
    if (event.includes('critical') || event.includes('security')) return 'critical';
    return 'info';
  }

  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `audit_${timestamp}_${random}`;
  }

  clear(): void {
    this.entries = [];
  }

  getCount(): number {
    return this.entries.length;
  }
}

export default AuditLogService;
