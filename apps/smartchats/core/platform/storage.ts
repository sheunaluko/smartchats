/**
 * Platform-agnostic storage interface.
 *
 * Web implementation uses localStorage / AppDataStore.
 * Native implementation (future) would use AsyncStorage or similar.
 */

export interface SmartChatsStorage {
  get<T = any>(key: string): Promise<T | null>;
  set<T = any>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}
