/**
 * Priceverse - Initial Database Migration
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Create pair_symbol enum type
  await sql`
    DO $$ BEGIN
      CREATE TYPE pair_symbol AS ENUM (
        'btc-usd', 'xmr-usd', 'btc-rub', 'xmr-rub', 'eth-usd', 'eth-rub'
      );
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `.execute(db);

  // Create aggregation_method enum type
  await sql`
    DO $$ BEGIN
      CREATE TYPE aggregation_method AS ENUM ('vwap', 'median', 'mean');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `.execute(db);

  // Create price_history table
  await db.schema
    .createTable('price_history')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('pair', sql`pair_symbol`, (col) => col.notNull())
    .addColumn('price', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('timestamp', 'timestamptz', (col) => col.notNull())
    .addColumn('method', sql`aggregation_method`, (col) => col.notNull())
    .addColumn('sources', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'`))
    .addColumn('volume', 'decimal(24, 8)')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Create indexes for price_history
  await db.schema
    .createIndex('idx_price_history_pair_timestamp')
    .ifNotExists()
    .on('price_history')
    .columns(['pair', 'timestamp'])
    .execute();

  await db.schema
    .createIndex('idx_price_history_timestamp')
    .ifNotExists()
    .on('price_history')
    .column('timestamp')
    .execute();

  // Create 5min candles table
  await db.schema
    .createTable('price_history_5min')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('pair', sql`pair_symbol`, (col) => col.notNull())
    .addColumn('timestamp', 'timestamptz', (col) => col.notNull())
    .addColumn('open', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('high', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('low', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('close', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('volume', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('vwap', 'decimal(24, 8)')
    .addColumn('trade_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('idx_price_history_5min_pair_timestamp')
    .ifNotExists()
    .on('price_history_5min')
    .columns(['pair', 'timestamp'])
    .unique()
    .execute();

  // Create 1hour candles table
  await db.schema
    .createTable('price_history_1hour')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('pair', sql`pair_symbol`, (col) => col.notNull())
    .addColumn('timestamp', 'timestamptz', (col) => col.notNull())
    .addColumn('open', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('high', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('low', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('close', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('volume', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('vwap', 'decimal(24, 8)')
    .addColumn('trade_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('idx_price_history_1hour_pair_timestamp')
    .ifNotExists()
    .on('price_history_1hour')
    .columns(['pair', 'timestamp'])
    .unique()
    .execute();

  // Create 1day candles table
  await db.schema
    .createTable('price_history_1day')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('pair', sql`pair_symbol`, (col) => col.notNull())
    .addColumn('timestamp', 'timestamptz', (col) => col.notNull())
    .addColumn('open', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('high', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('low', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('close', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('volume', 'decimal(24, 8)', (col) => col.notNull())
    .addColumn('vwap', 'decimal(24, 8)')
    .addColumn('trade_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('idx_price_history_1day_pair_timestamp')
    .ifNotExists()
    .on('price_history_1day')
    .columns(['pair', 'timestamp'])
    .unique()
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('price_history_1day').ifExists().execute();
  await db.schema.dropTable('price_history_1hour').ifExists().execute();
  await db.schema.dropTable('price_history_5min').ifExists().execute();
  await db.schema.dropTable('price_history').ifExists().execute();
  await sql`DROP TYPE IF EXISTS aggregation_method`.execute(db);
  await sql`DROP TYPE IF EXISTS pair_symbol`.execute(db);
}
