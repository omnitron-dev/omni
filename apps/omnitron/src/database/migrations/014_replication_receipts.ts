import type { Kysely } from 'kysely';

/** Preserve the outcome across a lost acknowledgement and a repeated batch. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('sync_ingested')
    .addColumn('outcome', 'varchar(16)', column => column.notNull().defaultTo('unverified')).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('sync_ingested').dropColumn('outcome').execute();
}
