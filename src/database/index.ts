// TurboPay Database Service
// PostgreSQL connection and query utilities
// Replaces JSON file persistence for production use
//
// NOTE: Install 'pg' package to use this module: npm install pg @types/pg

import { getLogger } from '../utils/logger';

// Dynamic import types (avoid requiring pg at module load)
type Pool = any;
type PoolClient = any;
type QueryResult<T = any> = { rows: T[]; rowCount: number };

// =============================================================================
// TYPES
// =============================================================================

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  ssl?: boolean | { rejectUnauthorized: boolean };
}

export interface QueryOptions {
  client?: PoolClient;
  timeout?: number;
}

// =============================================================================
// DATABASE SERVICE
// =============================================================================

export class DatabaseService {
  private pool: Pool | null = null;
  private logger = getLogger();
  private config: DatabaseConfig;

  constructor(config?: Partial<DatabaseConfig>) {
    this.config = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'turbopay',
      user: process.env.DB_USER || 'turbopay',
      password: process.env.DB_PASSWORD || '',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      ...config
    };
  }

  // ===========================================================================
  // CONNECTION MANAGEMENT
  // ===========================================================================

  async connect(): Promise<void> {
    try {
      // Dynamic import to avoid requiring pg at module load
      const pg = require('pg');
      this.pool = new pg.Pool(this.config);

      // Test connection
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW()');
      client.release();

      this.logger.info('Database connected', {
        host: this.config.host,
        database: this.config.database,
        server_time: result.rows[0].now
      });
    } catch (error) {
      this.logger.error('Database connection failed', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.logger.info('Database disconnected');
    }
  }

  isConnected(): boolean {
    return this.pool !== null;
  }

  // ===========================================================================
  // QUERY METHODS
  // ===========================================================================

  async query<T = any>(text: string, params?: any[], options?: QueryOptions): Promise<QueryResult<T>> {
    const start = Date.now();

    try {
      let result: QueryResult<T>;

      if (options?.client) {
        result = await options.client.query(text, params);
      } else if (!this.pool) {
        throw new Error('Database not connected');
      } else {
        result = await this.pool.query(text, params);
      }

      const duration = Date.now() - start;

      // Log slow queries
      if (duration > 1000) {
        this.logger.warn('Slow query', { query: text.substring(0, 200), duration_ms: duration });
      }

      return result;
    } catch (error) {
      this.logger.error('Query failed', error, { query: text.substring(0, 200) });
      throw error;
    }
  }

  async queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] || null;
  }

  async queryMany<T = any>(text: string, params?: any[]): Promise<T[]> {
    const result = await this.query<T>(text, params);
    return result.rows;
  }

  // ===========================================================================
  // TRANSACTION SUPPORT
  // ===========================================================================

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error('Database not connected');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Build INSERT query from object
   */
  buildInsert(table: string, data: Record<string, any>): { text: string; values: any[] } {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`);

    return {
      text: `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      values
    };
  }

  /**
   * Build UPDATE query from object
   */
  buildUpdate(table: string, data: Record<string, any>, where: Record<string, any>): { text: string; values: any[] } {
    const setKeys = Object.keys(data);
    const setValues = Object.values(data);
    const whereKeys = Object.keys(where);
    const whereValues = Object.values(where);

    const setClause = setKeys.map((key, i) => `${key} = $${i + 1}`).join(', ');
    const whereClause = whereKeys.map((key, i) => `${key} = $${setKeys.length + i + 1}`).join(' AND ');

    return {
      text: `UPDATE ${table} SET ${setClause} WHERE ${whereClause} RETURNING *`,
      values: [...setValues, ...whereValues]
    };
  }

  /**
   * Build SELECT query with conditions
   */
  buildSelect(table: string, conditions: Record<string, any>, options?: {
    columns?: string[];
    orderBy?: string;
    limit?: number;
    offset?: number;
  }): { text: string; values: any[] } {
    const columns = options?.columns?.join(', ') || '*';
    const keys = Object.keys(conditions);
    const values = Object.values(conditions);

    let whereClause = '';
    if (keys.length > 0) {
      whereClause = 'WHERE ' + keys.map((key, i) => `${key} = $${i + 1}`).join(' AND ');
    }

    let query = `SELECT ${columns} FROM ${table} ${whereClause}`;

    if (options?.orderBy) {
      query += ` ORDER BY ${options.orderBy}`;
    }
    if (options?.limit) {
      query += ` LIMIT $${values.length + 1}`;
      values.push(options.limit);
    }
    if (options?.offset) {
      query += ` OFFSET $${values.length + 1}`;
      values.push(options.offset);
    }

    return { text: query, values };
  }

  /**
   * Check database health
   */
  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string }> {
    const start = Date.now();
    try {
      if (!this.pool) {
        return { healthy: false, latency: 0, error: 'Not connected' };
      }
      await this.pool.query('SELECT 1');
      return { healthy: true, latency: Date.now() - start };
    } catch (error) {
      return { healthy: false, latency: Date.now() - start, error: (error as Error).message };
    }
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let dbInstance: DatabaseService | null = null;

export function getDatabase(): DatabaseService {
  if (!dbInstance) {
    dbInstance = new DatabaseService();
  }
  return dbInstance;
}

export default DatabaseService;
