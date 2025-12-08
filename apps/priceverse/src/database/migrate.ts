/**
 * Priceverse 2.0 - Database Migration Script
 * Standalone script to run Kysely migrations
 */

import { Kysely, PostgresDialect, Migrator, FileMigrationProvider } from 'kysely';
import { Pool } from 'pg';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getMigrator() {
  // Get database connection from environment
  const dialect = new PostgresDialect({
    pool: new Pool({
      host: process.env.PRICEVERSE_DATABASE_HOST ?? 'localhost',
      port: Number(process.env.PRICEVERSE_DATABASE_PORT ?? 5432),
      database: process.env.PRICEVERSE_DATABASE_DATABASE ?? 'priceverse',
      user: process.env.PRICEVERSE_DATABASE_USER ?? 'postgres',
      password: process.env.PRICEVERSE_DATABASE_PASSWORD ?? 'postgres',
      max: 5,
    }),
  });

  const db = new Kysely<unknown>({ dialect });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });

  return { db, migrator };
}

async function migrateUp() {
  console.log('Running migrations...');
  const { db, migrator } = await getMigrator();

  try {
    const { error, results } = await migrator.migrateToLatest();

    results?.forEach((it) => {
      if (it.status === 'Success') {
        console.log(`✓ Migration "${it.migrationName}" executed successfully`);
      } else if (it.status === 'Error') {
        console.error(`✗ Migration "${it.migrationName}" failed`);
      }
    });

    if (error) {
      console.error('Migration failed:', error);
      process.exit(1);
    }

    if (results?.length === 0) {
      console.log('No pending migrations.');
    } else {
      console.log(`Successfully executed ${results?.length ?? 0} migration(s).`);
    }
  } finally {
    await db.destroy();
  }
}

async function migrateDown() {
  console.log('Rolling back last migration...');
  const { db, migrator } = await getMigrator();

  try {
    const { error, results } = await migrator.migrateDown();

    results?.forEach((it) => {
      if (it.status === 'Success') {
        console.log(`✓ Migration "${it.migrationName}" rolled back successfully`);
      } else if (it.status === 'Error') {
        console.error(`✗ Rollback of "${it.migrationName}" failed`);
      }
    });

    if (error) {
      console.error('Rollback failed:', error);
      process.exit(1);
    }

    if (results?.length === 0) {
      console.log('No migrations to rollback.');
    }
  } finally {
    await db.destroy();
  }
}

async function showStatus() {
  console.log('Migration status:');
  const { db, migrator } = await getMigrator();

  try {
    const migrations = await migrator.getMigrations();

    for (const migration of migrations) {
      const status = migration.executedAt
        ? `✓ executed at ${migration.executedAt.toISOString()}`
        : '○ pending';
      console.log(`  ${migration.name}: ${status}`);
    }
  } finally {
    await db.destroy();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const command = args.includes('--down') ? 'down' : args.includes('--status') ? 'status' : 'up';

switch (command) {
  case 'up':
    migrateUp();
    break;
  case 'down':
    migrateDown();
    break;
  case 'status':
    showStatus();
    break;
}
