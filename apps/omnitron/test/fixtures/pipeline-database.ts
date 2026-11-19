import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { withDateBinding } from '../../src/database/sqlite-date-binding.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';

/** Private SQLite schema for the production pipeline service. Passing a filename permits reopen tests. */
export function createPipelineTestDatabase(filename = ':memory:'): Kysely<OmnitronDatabase> {
  const database = new Database(filename);
  try {
    database.exec(`CREATE TABLE pipelines(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,description TEXT,steps TEXT NOT NULL,triggers TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE TABLE pipeline_runs(id TEXT PRIMARY KEY,pipelineId TEXT NOT NULL,status TEXT NOT NULL,steps TEXT NOT NULL,startedAt TEXT NOT NULL,completedAt TEXT,triggeredBy TEXT NOT NULL,params TEXT,admission TEXT);`);
    return new Kysely({ dialect: new SqliteDialect({ database: withDateBinding(database) }) });
  } catch (error) {
    database.close();
    throw error;
  }
}
