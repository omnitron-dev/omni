import { openSqliteDatabase } from '../exports/sqlite.js';
import type { SqliteDialectConfig } from 'kysely';

export function sqliteFile(filename: string): SqliteDialectConfig {
  return { database: async () => openSqliteDatabase(filename) };
}

export type SqliteRequest =
  | { action: 'open' | 'close' }
  | { action: 'execute' | 'stream'; sql: string; parameters: readonly unknown[] }
  | { action: 'next'; cursor: number; size: number }
  | { action: 'return'; cursor: number };

export type SqliteReply = { id: number; value: Uint8Array } | { id: number; error: Error; code?: string };
