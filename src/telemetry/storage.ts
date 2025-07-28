import type { TelemetryStorage } from '../types';
import { isStorageAvailable, isIndexedDBAvailable } from './utils';

/**
 * LocalStorage implementation of TelemetryStorage
 */
export class LocalStorageAdapter implements TelemetryStorage {
  private prefix: string;

  constructor(prefix: string = 'nexus_telemetry_') {
    this.prefix = prefix;
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!isStorageAvailable('localStorage')) {
      throw new Error('localStorage is not available');
    }

    try {
      const serializedValue = JSON.stringify(value);
      localStorage.setItem(this.prefix + key, serializedValue);
    } catch (error) {
      throw new Error(`Failed to set localStorage item: ${error}`);
    }
  }

  async get(key: string): Promise<unknown> {
    if (!isStorageAvailable('localStorage')) {
      throw new Error('localStorage is not available');
    }

    try {
      const item = localStorage.getItem(this.prefix + key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      throw new Error(`Failed to get localStorage item: ${error}`);
    }
  }

  async remove(key: string): Promise<void> {
    if (!isStorageAvailable('localStorage')) {
      throw new Error('localStorage is not available');
    }

    try {
      localStorage.removeItem(this.prefix + key);
    } catch (error) {
      throw new Error(`Failed to remove localStorage item: ${error}`);
    }
  }

  async clear(): Promise<void> {
    if (!isStorageAvailable('localStorage')) {
      throw new Error('localStorage is not available');
    }

    try {
      const keys = await this.keys();
      keys.forEach(key => {
        localStorage.removeItem(this.prefix + key);
      });
    } catch (error) {
      throw new Error(`Failed to clear localStorage: ${error}`);
    }
  }

  async keys(): Promise<string[]> {
    if (!isStorageAvailable('localStorage')) {
      throw new Error('localStorage is not available');
    }

    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.prefix)) {
          keys.push(key.slice(this.prefix.length));
        }
      }
      return keys;
    } catch (error) {
      throw new Error(`Failed to get localStorage keys: ${error}`);
    }
  }

  async size(): Promise<number> {
    if (!isStorageAvailable('localStorage')) {
      throw new Error('localStorage is not available');
    }

    try {
      const keys = await this.keys();
      return keys.length;
    } catch (error) {
      throw new Error(`Failed to get localStorage size: ${error}`);
    }
  }
}

/**
 * SessionStorage implementation of TelemetryStorage
 */
export class SessionStorageAdapter implements TelemetryStorage {
  private prefix: string;

  constructor(prefix: string = 'nexus_telemetry_') {
    this.prefix = prefix;
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!isStorageAvailable('sessionStorage')) {
      throw new Error('sessionStorage is not available');
    }

    try {
      const serializedValue = JSON.stringify(value);
      sessionStorage.setItem(this.prefix + key, serializedValue);
    } catch (error) {
      throw new Error(`Failed to set sessionStorage item: ${error}`);
    }
  }

  async get(key: string): Promise<unknown> {
    if (!isStorageAvailable('sessionStorage')) {
      throw new Error('sessionStorage is not available');
    }

    try {
      const item = sessionStorage.getItem(this.prefix + key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      throw new Error(`Failed to get sessionStorage item: ${error}`);
    }
  }

  async remove(key: string): Promise<void> {
    if (!isStorageAvailable('sessionStorage')) {
      throw new Error('sessionStorage is not available');
    }

    try {
      sessionStorage.removeItem(this.prefix + key);
    } catch (error) {
      throw new Error(`Failed to remove sessionStorage item: ${error}`);
    }
  }

  async clear(): Promise<void> {
    if (!isStorageAvailable('sessionStorage')) {
      throw new Error('sessionStorage is not available');
    }

    try {
      const keys = await this.keys();
      keys.forEach(key => {
        sessionStorage.removeItem(this.prefix + key);
      });
    } catch (error) {
      throw new Error(`Failed to clear sessionStorage: ${error}`);
    }
  }

  async keys(): Promise<string[]> {
    if (!isStorageAvailable('sessionStorage')) {
      throw new Error('sessionStorage is not available');
    }

    try {
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(this.prefix)) {
          keys.push(key.slice(this.prefix.length));
        }
      }
      return keys;
    } catch (error) {
      throw new Error(`Failed to get sessionStorage keys: ${error}`);
    }
  }

  async size(): Promise<number> {
    if (!isStorageAvailable('sessionStorage')) {
      throw new Error('sessionStorage is not available');
    }

    try {
      const keys = await this.keys();
      return keys.length;
    } catch (error) {
      throw new Error(`Failed to get sessionStorage size: ${error}`);
    }
  }
}

/**
 * IndexedDB implementation of TelemetryStorage
 */
export class IndexedDBAdapter implements TelemetryStorage {
  private dbName: string;
  private storeName: string;
  private db: IDBDatabase | null = null;

  constructor(dbName: string = 'nexus_telemetry', storeName: string = 'events') {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    if (!isIndexedDBAvailable()) {
      throw new Error('IndexedDB is not available');
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' });
        }
      };
    });
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      return new Promise((resolve, reject) => {
        const request = store.put({ key, value, timestamp: Date.now() });

        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error(`Failed to set IndexedDB item: ${request.error}`));
      });
    } catch (error) {
      throw new Error(`IndexedDB set failed: ${error}`);
    }
  }

  async get(key: string): Promise<unknown> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);

      return new Promise((resolve, reject) => {
        const request = store.get(key);

        request.onsuccess = () => {
          const result = request.result;
          resolve(result ? result.value : null);
        };
        request.onerror = () => reject(new Error(`Failed to get IndexedDB item: ${request.error}`));
      });
    } catch (error) {
      throw new Error(`IndexedDB get failed: ${error}`);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      return new Promise((resolve, reject) => {
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error(`Failed to remove IndexedDB item: ${request.error}`));
      });
    } catch (error) {
      throw new Error(`IndexedDB remove failed: ${error}`);
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      return new Promise((resolve, reject) => {
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error(`Failed to clear IndexedDB: ${request.error}`));
      });
    } catch (error) {
      throw new Error(`IndexedDB clear failed: ${error}`);
    }
  }

  async keys(): Promise<string[]> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);

      return new Promise((resolve, reject) => {
        const request = store.getAllKeys();

        request.onsuccess = () => {
          const keys = request.result as string[];
          resolve(keys);
        };
        request.onerror = () => reject(new Error(`Failed to get IndexedDB keys: ${request.error}`));
      });
    } catch (error) {
      throw new Error(`IndexedDB keys failed: ${error}`);
    }
  }

  async size(): Promise<number> {
    try {
      const keys = await this.keys();
      return keys.length;
    } catch (error) {
      throw new Error(`IndexedDB size failed: ${error}`);
    }
  }
}

/**
 * Memory-based implementation of TelemetryStorage for testing
 */
export class MemoryStorageAdapter implements TelemetryStorage {
  private storage = new Map<string, unknown>();

  async set(key: string, value: unknown): Promise<void> {
    this.storage.set(key, value);
  }

  async get(key: string): Promise<unknown> {
    return this.storage.get(key) || null;
  }

  async remove(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async clear(): Promise<void> {
    this.storage.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.storage.keys());
  }

  async size(): Promise<number> {
    return this.storage.size;
  }
}

/**
 * Factory function to create the appropriate storage adapter
 */
export function createStorageAdapter(
  type: 'localStorage' | 'sessionStorage' | 'indexedDB' | 'memory',
  prefix?: string
): TelemetryStorage {
  switch (type) {
    case 'localStorage':
      return new LocalStorageAdapter(prefix);
    case 'sessionStorage':
      return new SessionStorageAdapter(prefix);
    case 'indexedDB':
      return new IndexedDBAdapter(prefix?.replace(/[^a-zA-Z0-9]/g, '_'), 'events');
    case 'memory':
      return new MemoryStorageAdapter();
    default:
      throw new Error(`Unsupported storage type: ${type}`);
  }
}

/**
 * Multi-level storage adapter that tries multiple storage types
 */
export class MultiLevelStorageAdapter implements TelemetryStorage {
  private adapters: TelemetryStorage[];

  constructor(types: Array<'localStorage' | 'sessionStorage' | 'indexedDB' | 'memory'> = ['localStorage', 'sessionStorage', 'memory']) {
    this.adapters = types.map(type => createStorageAdapter(type));
  }

  async set(key: string, value: unknown): Promise<void> {
    for (const adapter of this.adapters) {
      try {
        await adapter.set(key, value);
        return;
      } catch (error) {
        // Continue to next adapter
        console.warn(`Failed to set ${key} in ${adapter.constructor.name}:`, error);
      }
    }
    throw new Error('Failed to set value in any storage adapter');
  }

  async get(key: string): Promise<unknown> {
    for (const adapter of this.adapters) {
      try {
        const value = await adapter.get(key);
        if (value !== null) {
          return value;
        }
      } catch (error) {
        // Continue to next adapter
        console.warn(`Failed to get ${key} from ${adapter.constructor.name}:`, error);
      }
    }
    return null;
  }

  async remove(key: string): Promise<void> {
    const promises = this.adapters.map(adapter => 
      adapter.remove(key).catch(error => 
        console.warn(`Failed to remove ${key} from ${adapter.constructor.name}:`, error)
      )
    );
    await Promise.all(promises);
  }

  async clear(): Promise<void> {
    const promises = this.adapters.map(adapter => 
      adapter.clear().catch(error => 
        console.warn(`Failed to clear ${adapter.constructor.name}:`, error)
      )
    );
    await Promise.all(promises);
  }

  async keys(): Promise<string[]> {
    for (const adapter of this.adapters) {
      try {
        return await adapter.keys();
      } catch (error) {
        console.warn(`Failed to get keys from ${adapter.constructor.name}:`, error);
      }
    }
    return [];
  }

  async size(): Promise<number> {
    for (const adapter of this.adapters) {
      try {
        return await adapter.size();
      } catch (error) {
        console.warn(`Failed to get size from ${adapter.constructor.name}:`, error);
      }
    }
    return 0;
  }
} 