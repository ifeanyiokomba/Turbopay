// TurboPay Ledger Service
// Manages wallets, journal entries, settlements, and audit trail
// Providers never own balances — TurboPay owns all financial state

import {
  ProviderName,
  Wallet,
  LedgerEntry,
  LedgerEntryType,
  LedgerEntryStatus,
  JournalEntry,
  JournalLine,
  AuditLog,
  SettlementResponse,
  TransactionStatus
} from '../types';

// =============================================================================
// LEDGER SERVICE
// =============================================================================

export class LedgerService {
  private wallets: Map<string, Wallet> = new Map();
  private ledgerEntries: Map<string, LedgerEntry> = new Map();
  private journalEntries: Map<string, JournalEntry> = new Map();
  private auditLogs: Map<string, AuditLog> = new Map();
  private settlements: Map<string, SettlementResponse> = new Map();

  // ===========================================================================
  // WALLET MANAGEMENT
  // ===========================================================================

  createWallet(userId: string, currency: string = 'NGN'): Wallet {
    const existing = this.findWalletByUser(userId, currency);
    if (existing) return existing;

    const wallet: Wallet = {
      id: this.generateId('wallet'),
      user_id: userId,
      currency,
      balance: 0,
      available_balance: 0,
      held_balance: 0,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    };

    this.wallets.set(wallet.id, wallet);
    this.audit('wallet.created', 'wallet', wallet.id, { currency, user_id: userId });
    return wallet;
  }

  getWallet(walletId: string): Wallet | undefined {
    return this.wallets.get(walletId);
  }

  getWalletByUser(userId: string, currency: string = 'NGN'): Wallet | undefined {
    return this.findWalletByUser(userId, currency);
  }

  getUserWallets(userId: string): Wallet[] {
    return Array.from(this.wallets.values()).filter(w => w.user_id === userId);
  }

  freezeWallet(walletId: string): Wallet {
    const wallet = this.wallets.get(walletId);
    if (!wallet) throw new Error(`Wallet ${walletId} not found`);
    wallet.status = 'frozen';
    wallet.updated_at = new Date();
    this.audit('wallet.frozen', 'wallet', walletId);
    return wallet;
  }

  closeWallet(walletId: string): Wallet {
    const wallet = this.wallets.get(walletId);
    if (!wallet) throw new Error(`Wallet ${walletId} not found`);
    if (wallet.balance !== 0) throw new Error('Cannot close wallet with non-zero balance');
    wallet.status = 'closed';
    wallet.updated_at = new Date();
    this.audit('wallet.closed', 'wallet', walletId);
    return wallet;
  }

  // ===========================================================================
  // LEDGER ENTRIES
  // ===========================================================================

  credit(
    walletId: string,
    amount: number,
    currency: string,
    reference: string,
    provider?: ProviderName,
    providerReference?: string,
    description?: string,
    metadata?: Record<string, any>
  ): LedgerEntry {
    const wallet = this.wallets.get(walletId);
    if (!wallet) throw new Error(`Wallet ${walletId} not found`);
    if (wallet.status !== 'active') throw new Error('Wallet is not active');

    const balanceBefore = wallet.balance;
    const availableBefore = wallet.available_balance;

    wallet.balance += amount;
    wallet.available_balance += amount;
    wallet.updated_at = new Date();

    const entry = this.createLedgerEntry(
      walletId, 'credit', amount, currency, 'completed',
      reference, provider, providerReference, description, metadata,
      balanceBefore, wallet.balance
    );

    this.audit('ledger.credit', 'ledger_entry', entry.id, {
      wallet_id: walletId, amount, currency, reference
    });

    return entry;
  }

  debit(
    walletId: string,
    amount: number,
    currency: string,
    reference: string,
    provider?: ProviderName,
    providerReference?: string,
    description?: string,
    metadata?: Record<string, any>
  ): LedgerEntry {
    const wallet = this.wallets.get(walletId);
    if (!wallet) throw new Error(`Wallet ${walletId} not found`);
    if (wallet.status !== 'active') throw new Error('Wallet is not active');
    if (wallet.available_balance < amount) {
      throw new Error(`Insufficient balance: available ${wallet.available_balance} ${currency}, required ${amount} ${currency}`);
    }

    const balanceBefore = wallet.balance;

    wallet.balance -= amount;
    wallet.available_balance -= amount;
    wallet.updated_at = new Date();

    const entry = this.createLedgerEntry(
      walletId, 'debit', amount, currency, 'completed',
      reference, provider, providerReference, description, metadata,
      balanceBefore, wallet.balance
    );

    this.audit('ledger.debit', 'ledger_entry', entry.id, {
      wallet_id: walletId, amount, currency, reference
    });

    return entry;
  }

  hold(
    walletId: string,
    amount: number,
    currency: string,
    reference: string,
    description?: string,
    metadata?: Record<string, any>
  ): LedgerEntry {
    const wallet = this.wallets.get(walletId);
    if (!wallet) throw new Error(`Wallet ${walletId} not found`);
    if (wallet.status !== 'active') throw new Error('Wallet is not active');
    if (wallet.available_balance < amount) {
      throw new Error(`Insufficient available balance to hold: available ${wallet.available_balance}, required ${amount}`);
    }

    const balanceBefore = wallet.balance;

    wallet.available_balance -= amount;
    wallet.held_balance += amount;
    wallet.updated_at = new Date();

    return this.createLedgerEntry(
      walletId, 'hold', amount, currency, 'completed',
      reference, undefined, undefined, description, metadata,
      balanceBefore, wallet.balance
    );
  }

  release(
    walletId: string,
    amount: number,
    currency: string,
    reference: string,
    description?: string,
    metadata?: Record<string, any>
  ): LedgerEntry {
    const wallet = this.wallets.get(walletId);
    if (!wallet) throw new Error(`Wallet ${walletId} not found`);

    const balanceBefore = wallet.balance;

    wallet.available_balance += amount;
    wallet.held_balance -= amount;
    wallet.updated_at = new Date();

    return this.createLedgerEntry(
      walletId, 'release', amount, currency, 'completed',
      reference, undefined, undefined, description, metadata,
      balanceBefore, wallet.balance
    );
  }

  recordFee(
    walletId: string,
    amount: number,
    currency: string,
    reference: string,
    provider: ProviderName,
    description?: string,
    metadata?: Record<string, any>
  ): LedgerEntry {
    const wallet = this.wallets.get(walletId);
    if (!wallet) throw new Error(`Wallet ${walletId} not found`);

    const balanceBefore = wallet.balance;

    wallet.balance -= amount;
    wallet.available_balance -= amount;
    wallet.updated_at = new Date();

    return this.createLedgerEntry(
      walletId, 'fee', amount, currency, 'completed',
      reference, provider, undefined, description || `Fee charged by ${provider}`, metadata,
      balanceBefore, wallet.balance
    );
  }

  // ===========================================================================
  // JOURNAL ENTRIES (double-entry bookkeeping)
  // ===========================================================================

  createJournal(
    reference: string,
    lines: JournalLine[],
    description?: string,
    metadata?: Record<string, any>
  ): JournalEntry {
    const totalDebit = lines.filter(l => l.type === 'debit').reduce((sum, l) => sum + l.amount, 0);
    const totalCredit = lines.filter(l => l.type === 'credit').reduce((sum, l) => sum + l.amount, 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`Journal entries must balance: debit ${totalDebit} != credit ${totalCredit}`);
    }

    const journal: JournalEntry = {
      id: this.generateId('journal'),
      reference,
      wallet_id: lines[0].wallet_id,
      entries: lines,
      status: 'pending',
      description,
      metadata,
      created_at: new Date()
    };

    this.journalEntries.set(journal.id, journal);
    this.audit('journal.created', 'journal', journal.id, { reference, line_count: lines.length });
    return journal;
  }

  commitJournal(journalId: string): JournalEntry {
    const journal = this.journalEntries.get(journalId);
    if (!journal) throw new Error(`Journal ${journalId} not found`);
    if (journal.status !== 'pending') throw new Error(`Journal is already ${journal.status}`);

    // Apply each line to the corresponding wallet
    for (const line of journal.entries) {
      if (line.type === 'debit') {
        this.debit(line.wallet_id, line.amount, line.currency, journal.reference, undefined, undefined, journal.description);
      } else {
        this.credit(line.wallet_id, line.amount, line.currency, journal.reference, undefined, undefined, journal.description);
      }
    }

    journal.status = 'committed';
    journal.committed_at = new Date();

    this.audit('journal.committed', 'journal', journal.id, { reference: journal.reference });
    return journal;
  }

  reverseJournal(journalId: string, reason?: string): JournalEntry {
    const journal = this.journalEntries.get(journalId);
    if (!journal) throw new Error(`Journal ${journalId} not found`);
    if (journal.status !== 'committed') throw new Error(`Journal is ${journal.status}, cannot reverse`);

    // Reverse each line
    for (const line of journal.entries) {
      if (line.type === 'debit') {
        this.credit(line.wallet_id, line.amount, line.currency, `${journal.reference}_reversal`, undefined, undefined, reason || 'Journal reversal');
      } else {
        this.debit(line.wallet_id, line.amount, line.currency, `${journal.reference}_reversal`, undefined, undefined, reason || 'Journal reversal');
      }
    }

    journal.status = 'reversed';
    this.audit('journal.reversed', 'journal', journal.id, { reference: journal.reference, reason });
    return journal;
  }

  getJournal(journalId: string): JournalEntry | undefined {
    return this.journalEntries.get(journalId);
  }

  // ===========================================================================
  // SETTLEMENT
  // ===========================================================================

  recordSettlement(
    provider: ProviderName,
    totalAmount: number,
    currency: string,
    fee: number,
    reference: string,
    transactionIds: string[],
    settlementDate: Date = new Date()
  ): SettlementResponse {
    const settlement: SettlementResponse = {
      id: this.generateId('settlement'),
      provider,
      total_amount: totalAmount,
      currency,
      fee,
      net_amount: totalAmount - fee,
      status: 'pending',
      settlement_date: settlementDate,
      reference,
      transactions: transactionIds
    };

    this.settlements.set(settlement.id, settlement);
    this.audit('settlement.created', 'settlement', settlement.id, {
      provider, total_amount: totalAmount, fee
    });

    return settlement;
  }

  completeSettlement(settlementId: string): SettlementResponse {
    const settlement = this.settlements.get(settlementId);
    if (!settlement) throw new Error(`Settlement ${settlementId} not found`);

    settlement.status = 'completed';
    this.audit('settlement.completed', 'settlement', settlement.id);
    return settlement;
  }

  failSettlement(settlementId: string): SettlementResponse {
    const settlement = this.settlements.get(settlementId);
    if (!settlement) throw new Error(`Settlement ${settlementId} not found`);

    settlement.status = 'failed';
    this.audit('settlement.failed', 'settlement', settlement.id);
    return settlement;
  }

  getSettlement(settlementId: string): SettlementResponse | undefined {
    return this.settlements.get(settlementId);
  }

  getProviderSettlements(provider: ProviderName): SettlementResponse[] {
    return Array.from(this.settlements.values()).filter(s => s.provider === provider);
  }

  // ===========================================================================
  // AUDIT TRAIL
  // ===========================================================================

  audit(
    event: string,
    entityType: string,
    entityId: string,
    changes?: Record<string, any>,
    actor?: string,
    ipAddress?: string,
    userAgent?: string
  ): AuditLog {
    const log: AuditLog = {
      id: this.generateId('audit'),
      event,
      entity_type: entityType,
      entity_id: entityId,
      actor,
      changes,
      ip_address: ipAddress,
      user_agent: userAgent,
      created_at: new Date()
    };

    this.auditLogs.set(log.id, log);
    return log;
  }

  getAuditLogs(entityType?: string, entityId?: string, limit: number = 100): AuditLog[] {
    let logs = Array.from(this.auditLogs.values());

    if (entityType) logs = logs.filter(l => l.entity_type === entityType);
    if (entityId) logs = logs.filter(l => l.entity_id === entityId);

    return logs.sort((a, b) => b.created_at.getTime() - a.created_at.getTime()).slice(0, limit);
  }

  // ===========================================================================
  // QUERY METHODS
  // ===========================================================================

  getLedgerEntries(
    walletId: string,
    options?: { type?: LedgerEntryType; status?: LedgerEntryStatus; limit?: number; offset?: number }
  ): LedgerEntry[] {
    let entries = Array.from(this.ledgerEntries.values()).filter(e => e.wallet_id === walletId);

    if (options?.type) entries = entries.filter(e => e.type === options.type);
    if (options?.status) entries = entries.filter(e => e.status === options.status);

    entries.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

    const offset = options?.offset || 0;
    const limit = options?.limit || 50;
    return entries.slice(offset, offset + limit);
  }

  getWalletBalance(walletId: string): { balance: number; available: number; held: number } | null {
    const wallet = this.wallets.get(walletId);
    if (!wallet) return null;
    return {
      balance: wallet.balance,
      available: wallet.available_balance,
      held: wallet.held_balance
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private createLedgerEntry(
    walletId: string,
    type: LedgerEntryType,
    amount: number,
    currency: string,
    status: LedgerEntryStatus,
    reference: string,
    provider?: ProviderName,
    providerReference?: string,
    description?: string,
    metadata?: Record<string, any>,
    balanceBefore?: number,
    balanceAfter?: number
  ): LedgerEntry {
    const entry: LedgerEntry = {
      id: this.generateId('ledger'),
      wallet_id: walletId,
      type,
      amount,
      currency,
      status,
      reference,
      provider,
      provider_reference: providerReference,
      description,
      metadata,
      balance_before: balanceBefore ?? 0,
      balance_after: balanceAfter ?? 0,
      created_at: new Date(),
      updated_at: new Date()
    };

    this.ledgerEntries.set(entry.id, entry);
    return entry;
  }

  private findWalletByUser(userId: string, currency: string): Wallet | undefined {
    return Array.from(this.wallets.values()).find(
      w => w.user_id === userId && w.currency === currency
    );
  }

  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }
}

export default LedgerService;
