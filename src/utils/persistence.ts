// TurboPay Persistence Manager
// Provides optional JSON file-based persistence for in-memory Maps.
// Services register their Maps; the manager saves to disk on change and restores on startup.

import fs from 'fs';
import path from 'path';

// =============================================================================
// PERSISTENCE MANAGER
// =============================================================================

export class PersistenceManager {
  private dataDir: string;
  private registries: Map<string, Map<any, any>> = new Map();
  private dirty: Set<string> = new Set();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushIntervalMs: number;

  constructor(dataDir: string = './data', flushIntervalMs: number = 5000) {
    this.dataDir = dataDir;
    this.flushIntervalMs = flushIntervalMs;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  /**
   * Register a Map for persistence under a given key.
   * Restores from disk if a file exists, then starts periodic flush.
   */
  register(key: string, store: Map<any, any>): void {
    this.registries.set(key, store);
    this.restoreFromDisk(key, store);
    this.startAutoFlush();
  }

  /**
   * Mark a key as needing flush to disk.
   * Call this after mutating a registered Map.
   */
  markDirty(key: string): void {
    this.dirty.add(key);
  }

  /**
   * Immediately flush all dirty keys to disk.
   */
  flush(): void {
    for (const key of this.dirty) {
      const store = this.registries.get(key);
      if (store) {
        this.saveToDisk(key, store);
      }
    }
    this.dirty.clear();
  }

  /**
   * Stop auto-flush and flush remaining data.
   */
  stop(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  private saveToDisk(key: string, store: Map<any, any>): void {
    try {
      const filePath = path.join(this.dataDir, `${key}.json`);
      const entries = Array.from(store.entries());
      fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[Persistence] Failed to save ${key}:`, error);
    }
  }

  private restoreFromDisk(key: string, store: Map<any, any>): void {
    try {
      const filePath = path.join(this.dataDir, `${key}.json`);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        const entries: [any, any][] = JSON.parse(data);
        for (const [k, v] of entries) {
          store.set(k, v);
        }
        console.log(`[Persistence] Restored ${store.size} entries for '${key}'`);
      }
    } catch (error) {
      console.error(`[Persistence] Failed to restore ${key}:`, error);
    }
  }

  private startAutoFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
    if (this.flushTimer.unref) this.flushTimer.unref();
  }
}
