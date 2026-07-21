// TurboPay Persistence Manager — Unit Tests
// Covers: JSON file persistence for in-memory Maps

import { PersistenceManager } from '../utils/persistence';
import fs from 'fs';
import path from 'path';

const TEST_DATA_DIR = path.join(__dirname, '../../.test-data');

function cleanupTestData() {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true });
  }
}

beforeAll(() => cleanupTestData());
afterAll(() => cleanupTestData());

describe('PersistenceManager', () => {
  let pm: PersistenceManager;

  beforeEach(() => {
    cleanupTestData();
    pm = new PersistenceManager(TEST_DATA_DIR, 60000); // long interval — manual flush
  });

  afterEach(() => {
    pm.stop();
  });

  describe('Constructor', () => {
    test('creates data directory if it does not exist', () => {
      expect(fs.existsSync(TEST_DATA_DIR)).toBe(true);
    });

    test('does not fail if data directory already exists', () => {
      const pm2 = new PersistenceManager(TEST_DATA_DIR);
      expect(pm2).toBeDefined();
      pm2.stop();
    });
  });

  describe('Register & MarkDirty', () => {
    test('register stores the Map reference', () => {
      const store = new Map<string, any>();
      pm.register('test_store', store);
      // After register, should be able to markDirty without error
      pm.markDirty('test_store');
      pm.flush();
    });

    test('flush writes Map entries to JSON file', () => {
      const store = new Map<string, any>();
      store.set('key1', { name: 'value1' });
      store.set('key2', { name: 'value2' });

      pm.register('flush_test', store);
      pm.markDirty('flush_test');
      pm.flush();

      const filePath = path.join(TEST_DATA_DIR, 'flush_test.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(data).toHaveLength(2);
      expect(data[0][0]).toBe('key1');
      expect(data[0][1].name).toBe('value1');
      expect(data[1][0]).toBe('key2');
    });

    test('markDirty with unregistered key is a no-op', () => {
      pm.markDirty('nonexistent');
      pm.flush(); // should not throw
    });
  });

  describe('Restore from Disk', () => {
    test('register restores Map entries from existing file', () => {
      // First: write some data
      const store1 = new Map<string, any>();
      store1.set('restored_key', { data: 'restored_value' });
      pm.register('restore_test', store1);
      pm.markDirty('restore_test');
      pm.flush();
      pm.stop();

      // Second: create new manager and register same key
      const pm2 = new PersistenceManager(TEST_DATA_DIR, 60000);
      const store2 = new Map<string, any>();
      pm2.register('restore_test', store2);

      expect(store2.has('restored_key')).toBe(true);
      expect(store2.get('restored_key').data).toBe('restored_value');
      pm2.stop();
    });

    test('register handles missing file gracefully', () => {
      const store = new Map<string, any>();
      // No file exists yet — should not throw
      pm.register('new_store', store);
      expect(store.size).toBe(0);
    });

    test('register handles corrupted JSON file gracefully', () => {
      // Write invalid JSON
      const filePath = path.join(TEST_DATA_DIR, 'corrupt.json');
      fs.writeFileSync(filePath, 'NOT VALID JSON {{{', 'utf-8');

      const store = new Map<string, any>();
      // Should not throw — just log error and continue
      pm.register('corrupt', store);
      expect(store.size).toBe(0);
    });
  });

  describe('Stop & Flush', () => {
    test('stop flushes remaining dirty data', () => {
      const store = new Map<string, any>();
      store.set('a', 1);
      pm.register('stop_test', store);
      pm.markDirty('stop_test');

      pm.stop();

      const filePath = path.join(TEST_DATA_DIR, 'stop_test.json');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('stop can be called multiple times safely', () => {
      pm.stop();
      pm.stop(); // should not throw
    });

    test('flush clears dirty set', () => {
      const store = new Map<string, any>();
      store.set('x', 1);
      pm.register('clear_test', store);
      pm.markDirty('clear_test');
      pm.flush();

      // Second flush without new markDirty should not re-write
      // (This is just verifying no error — the file is already there)
      pm.flush();
    });
  });

  describe('Multiple Stores', () => {
    test('multiple stores can be registered and persisted independently', () => {
      const store1 = new Map<string, any>();
      const store2 = new Map<string, any>();

      store1.set('k1', 'v1');
      store2.set('k2', 'v2');

      pm.register('multi_a', store1);
      pm.register('multi_b', store2);

      pm.markDirty('multi_a');
      pm.markDirty('multi_b');
      pm.flush();

      const dataA = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'multi_a.json'), 'utf-8'));
      const dataB = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'multi_b.json'), 'utf-8'));

      expect(dataA[0][0]).toBe('k1');
      expect(dataB[0][0]).toBe('k2');
    });
  });

  describe('Edge Cases', () => {
    test('empty Map flushes to empty array', () => {
      const store = new Map<string, any>();
      pm.register('empty_test', store);
      pm.markDirty('empty_test');
      pm.flush();

      const data = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'empty_test.json'), 'utf-8'));
      expect(data).toEqual([]);
    });

    test('large Map with many entries', () => {
      const store = new Map<string, any>();
      for (let i = 0; i < 1000; i++) {
        store.set(`key_${i}`, { index: i, data: `value_${i}` });
      }

      pm.register('large_test', store);
      pm.markDirty('large_test');
      pm.flush();

      const data = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'large_test.json'), 'utf-8'));
      expect(data).toHaveLength(1000);
    });

    test('nested object values persist correctly', () => {
      const store = new Map<string, any>();
      store.set('nested', {
        level1: { level2: { level3: 'deep_value' } },
        array: [1, 2, 3],
        date: '2026-01-01T00:00:00.000Z',
      });

      pm.register('nested_test', store);
      pm.markDirty('nested_test');
      pm.flush();

      const data = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'nested_test.json'), 'utf-8'));
      expect(data[0][1].level1.level2.level3).toBe('deep_value');
      expect(data[0][1].array).toEqual([1, 2, 3]);
    });
  });
});
