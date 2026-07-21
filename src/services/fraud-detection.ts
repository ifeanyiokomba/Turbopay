// TurboPay Fraud Detection Service
// Rule-based anomaly detection for transactions

import { getLogger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface FraudRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: RiskLevel;
  evaluate: (context: TransactionContext) => FraudResult;
}

export interface TransactionContext {
  user_id: string;
  amount: number;
  currency: string;
  country: string;
  ip_address?: string;
  device_fingerprint?: string;
  provider: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  // Historical data
  recent_transactions?: TransactionRecord[];
  user_profile?: UserProfile;
}

export interface TransactionRecord {
  id: string;
  amount: number;
  currency: string;
  country: string;
  ip_address?: string;
  timestamp: Date;
  status: string;
}

export interface UserProfile {
  id: string;
  created_at: Date;
  kyc_tier: string;
  total_transactions: number;
  average_transaction_amount: number;
  max_transaction_amount: number;
  countries_used: string[];
  devices_used: string[];
  last_transaction_at?: Date;
}

export interface FraudResult {
  risk_level: RiskLevel;
  score: number; // 0-100
  triggered_rules: string[];
  reasons: string[];
  recommended_action: 'approve' | 'review' | 'reject';
}

export interface FraudAlert {
  id: string;
  user_id: string;
  transaction_id?: string;
  risk_level: RiskLevel;
  score: number;
  triggered_rules: string[];
  reasons: string[];
  status: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
  created_at: Date;
  reviewed_at?: Date;
  reviewed_by?: string;
  notes?: string;
}

// =============================================================================
// FRAUD DETECTION SERVICE
// =============================================================================

export class FraudDetectionService {
  private rules: FraudRule[] = [];
  private alerts: Map<string, FraudAlert> = new Map();
  private logger = getLogger();

  constructor() {
    this.initializeDefaultRules();
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  private initializeDefaultRules(): void {
    this.rules = [
      // High amount rule
      {
        id: 'high_amount',
        name: 'High Transaction Amount',
        description: 'Transaction exceeds user typical amount',
        enabled: true,
        severity: 'medium',
        evaluate: (ctx) => {
          if (!ctx.user_profile) return { risk_level: 'low', score: 0, triggered_rules: [], reasons: [], recommended_action: 'approve' };
          
          const avg = ctx.user_profile.average_transaction_amount;
          const max = ctx.user_profile.max_transaction_amount;
          
          // Flag if amount is 5x average or 2x max
          if (ctx.amount > avg * 5 || ctx.amount > max * 2) {
            return {
              risk_level: 'high',
              score: 75,
              triggered_rules: ['high_amount'],
              reasons: [`Amount ₦${ctx.amount.toLocaleString()} exceeds typical range (avg: ₦${avg.toLocaleString()})`],
              recommended_action: 'review'
            };
          }
          
          // Flag if amount is 3x average
          if (ctx.amount > avg * 3) {
            return {
              risk_level: 'medium',
              score: 50,
              triggered_rules: ['high_amount'],
              reasons: [`Amount ₦${ctx.amount.toLocaleString()} is unusually high (avg: ₦${avg.toLocaleString()})`],
              recommended_action: 'approve'
            };
          }
          
          return { risk_level: 'low', score: 0, triggered_rules: [], reasons: [], recommended_action: 'approve' };
        }
      },

      // Velocity rule (many transactions in short time)
      {
        id: 'velocity_check',
        name: 'Transaction Velocity',
        description: 'Too many transactions in short period',
        enabled: true,
        severity: 'high',
        evaluate: (ctx) => {
          if (!ctx.recent_transactions) return { risk_level: 'low', score: 0, triggered_rules: [], reasons: [], recommended_action: 'approve' };
          
          const now = Date.now();
          const oneHourAgo = now - 60 * 60 * 1000;
          const recentCount = ctx.recent_transactions.filter(
            t => new Date(t.timestamp).getTime() > oneHourAgo
          ).length;
          
          if (recentCount >= 10) {
            return {
              risk_level: 'critical',
              score: 90,
              triggered_rules: ['velocity_check'],
              reasons: [`${recentCount} transactions in the last hour`],
              recommended_action: 'reject'
            };
          }
          
          if (recentCount >= 5) {
            return {
              risk_level: 'high',
              score: 70,
              triggered_rules: ['velocity_check'],
              reasons: [`${recentCount} transactions in the last hour`],
              recommended_action: 'review'
            };
          }
          
          return { risk_level: 'low', score: 0, triggered_rules: [], reasons: [], recommended_action: 'approve' };
        }
      },

      // New device rule
      {
        id: 'new_device',
        name: 'New Device Detected',
        description: 'Transaction from unrecognized device',
        enabled: true,
        severity: 'medium',
        evaluate: (ctx) => {
          if (!ctx.user_profile || !ctx.device_fingerprint) {
            return { risk_level: 'low', score: 0, triggered_rules: [], reasons: [], recommended_action: 'approve' };
          }
          
          const isNewDevice = !ctx.user_profile.devices_used.includes(ctx.device_fingerprint);
          
          if (isNewDevice && ctx.user_profile.total_transactions > 10) {
            return {
              risk_level: 'medium',
              score: 40,
              triggered_rules: ['new_device'],
              reasons: ['Transaction from unrecognized device'],
              recommended_action: 'approve'
            };
          }
          
          return { risk_level: 'low', score: 0, triggered_rules: [], reasons: [], recommended_action: 'approve' };
        }
      },

      // New country rule
      {
        id: 'new_country',
        name: 'New Country Detected',
        description: 'Transaction from new country',
        enabled: true,
        severity: 'medium',
        evaluate: (ctx) => {
          if (!ctx.user_profile) return { risk_level: 'low', score: 0, triggered_rules: [], reasons: [], recommended_action: 'approve' };
          
          const isNewCountry = !ctx.user_profile.countries_used.includes(ctx.country);
          
          if (isNewCountry && ctx.user_profile.total_transactions > 5) {
            return {
              risk_level: 'medium',
              score: 45,
              triggered_rules: ['new_country'],
              reasons: [`Transaction from new country: ${ctx.country}`],
              recommended_action: 'review'
            };
          }
          
          return { risk_level: 'low', score: 0, triggered_rules: [], reasons: [], recommended_action: 'approve' };
        }
      },

      // Large amount + new country (combined risk)
      {
        id: 'large_amount_new_country',
        name: 'Large Amount in New Country',
        description: 'High-value transaction from new location',
        enabled: true,
        severity: 'critical',
        evaluate: (ctx) => {
          if (!ctx.user_profile) return { risk_level: 'low', score: 0, triggered_rules: [], reasons: [], recommended_action: 'approve' };
          
          const isNewCountry = !ctx.user_profile.countries_used.includes(ctx.country);
          const isHighAmount = ctx.amount > 500000; // ₦500,000
          
          if (isNewCountry && isHighAmount) {
            return {
              risk_level: 'critical',
              score: 95,
              triggered_rules: ['large_amount_new_country'],
              reasons: [
                `High-value transaction (₦${ctx.amount.toLocaleString()}) from new country (${ctx.country})`
              ],
              recommended_action: 'reject'
            };
          }
          
          return { risk_level: 'low', score: 0, triggered_rules: [], reasons: [], recommended_action: 'approve' };
        }
      },

      // Suspicious IP
      {
        id: 'suspicious_ip',
        name: 'Suspicious IP Address',
        description: 'Transaction from known suspicious IP',
        enabled: true,
        severity: 'high',
        evaluate: (ctx) => {
          // TODO: Integrate with IP reputation database
          // For now, just check for VPN/proxy patterns
          if (ctx.ip_address) {
            // Placeholder - would check against threat intelligence
            const suspiciousPatterns = ['10.', '192.168.', '172.16.'];
            const isSuspicious = suspiciousPatterns.some(p => ctx.ip_address?.startsWith(p));
            
            if (isSuspicious) {
              return {
                risk_level: 'medium',
                score: 30,
                triggered_rules: ['suspicious_ip'],
                reasons: ['Transaction from private/reserved IP range'],
                recommended_action: 'approve'
              };
            }
          }
          
          return { risk_level: 'low', score: 0, triggered_rules: [], reasons: [], recommended_action: 'approve' };
        }
      },

      // Account age rule
      {
        id: 'new_account',
        name: 'New Account Activity',
        description: 'Transaction on recently created account',
        enabled: true,
        severity: 'low',
        evaluate: (ctx) => {
          if (!ctx.user_profile) return { risk_level: 'low', score: 0, triggered_rules: [], reasons: [], recommended_action: 'approve' };
          
          const accountAge = Date.now() - new Date(ctx.user_profile.created_at).getTime();
          const sevenDays = 7 * 24 * 60 * 60 * 1000;
          
          if (accountAge < sevenDays && ctx.amount > 100000) {
            return {
              risk_level: 'medium',
              score: 35,
              triggered_rules: ['new_account'],
              reasons: ['High-value transaction on account less than 7 days old'],
              recommended_action: 'review'
            };
          }
          
          return { risk_level: 'low', score: 0, triggered_rules: [], reasons: [], recommended_action: 'approve' };
        }
      }
    ];
  }

  // ===========================================================================
  // EVALUATION
  // ===========================================================================

  /**
   * Evaluate transaction for fraud risk
   */
  evaluateTransaction(context: TransactionContext): FraudResult {
    const results: FraudResult[] = [];
    
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      
      const result = rule.evaluate(context);
      if (result.triggered_rules.length > 0) {
        results.push(result);
      }
    }

    // Combine results
    if (results.length === 0) {
      return {
        risk_level: 'low',
        score: 0,
        triggered_rules: [],
        reasons: [],
        recommended_action: 'approve'
      };
    }

    // Get highest risk level
    const riskPriority: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
    const highestRisk = results.reduce((max, r) => 
      riskPriority.indexOf(r.risk_level) > riskPriority.indexOf(max) ? r.risk_level : max
    , 'low' as RiskLevel);

    // Get highest score
    const highestScore = Math.max(...results.map(r => r.score));

    // Combine all triggered rules and reasons
    const allRules = [...new Set(results.flatMap(r => r.triggered_rules))];
    const allReasons = [...new Set(results.flatMap(r => r.reasons))];

    // Determine action
    let recommendedAction: 'approve' | 'review' | 'reject' = 'approve';
    if (highestRisk === 'critical' || highestScore >= 80) {
      recommendedAction = 'reject';
    } else if (highestRisk === 'high' || highestScore >= 50) {
      recommendedAction = 'review';
    }

    return {
      risk_level: highestRisk,
      score: highestScore,
      triggered_rules: allRules,
      reasons: allReasons,
      recommended_action: recommendedAction
    };
  }

  // ===========================================================================
  // ALERTS
  // ===========================================================================

  /**
   * Create fraud alert
   */
  createAlert(userId: string, result: FraudResult, transactionId?: string): FraudAlert {
    const alert: FraudAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      user_id: userId,
      transaction_id: transactionId,
      risk_level: result.risk_level,
      score: result.score,
      triggered_rules: result.triggered_rules,
      reasons: result.reasons,
      status: 'pending',
      created_at: new Date()
    };

    this.alerts.set(alert.id, alert);
    
    this.logger.warn('Fraud alert created', {
      alertId: alert.id,
      userId,
      riskLevel: result.risk_level,
      score: result.score
    });

    return alert;
  }

  /**
   * Get pending alerts
   */
  getPendingAlerts(): FraudAlert[] {
    return Array.from(this.alerts.values())
      .filter(a => a.status === 'pending')
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  /**
   * Get user alerts
   */
  getUserAlerts(userId: string): FraudAlert[] {
    return Array.from(this.alerts.values())
      .filter(a => a.user_id === userId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  /**
   * Review alert
   */
  reviewAlert(alertId: string, reviewerId: string, action: 'resolved' | 'dismissed', notes?: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.status = action;
    alert.reviewed_at = new Date();
    alert.reviewed_by = reviewerId;
    alert.notes = notes;

    this.alerts.set(alertId, alert);
    return true;
  }

  // ===========================================================================
  // RULE MANAGEMENT
  // ===========================================================================

  /**
   * Get all rules
   */
  getRules(): FraudRule[] {
    return [...this.rules];
  }

  /**
   * Toggle rule
   */
  toggleRule(ruleId: string, enabled: boolean): boolean {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return false;

    rule.enabled = enabled;
    return true;
  }

  /**
   * Add custom rule
   */
  addRule(rule: Omit<FraudRule, 'id'>): FraudRule {
    const newRule: FraudRule = {
      ...rule,
      id: `custom_${Date.now()}`
    };
    this.rules.push(newRule);
    return newRule;
  }

  // ===========================================================================
  // STATS
  // ===========================================================================

  /**
   * Get fraud statistics
   */
  getStats(): {
    total_alerts: number;
    pending_alerts: number;
    by_risk_level: Record<RiskLevel, number>;
  } {
    const alerts = Array.from(this.alerts.values());
    
    return {
      total_alerts: alerts.length,
      pending_alerts: alerts.filter(a => a.status === 'pending').length,
      by_risk_level: {
        low: alerts.filter(a => a.risk_level === 'low').length,
        medium: alerts.filter(a => a.risk_level === 'medium').length,
        high: alerts.filter(a => a.risk_level === 'high').length,
        critical: alerts.filter(a => a.risk_level === 'critical').length,
      }
    };
  }
}

export default FraudDetectionService;
