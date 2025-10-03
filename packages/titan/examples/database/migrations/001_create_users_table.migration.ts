/**
 * Migration: Create Users Table
 * Version: 001
 *
 * Creates the initial users table with indexes
 */

import { Kysely, sql } from 'kysely';
import { Migration, IMigration } from '@omnitron-dev/titan/module/database';

@Migration({
  version: '001',
  description: 'Create users table'
})
export class CreateUsersTableMigration implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    // Create users table
    await db.schema
      .createTable('users')
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('email', 'varchar(255)', col => col.notNull().unique())
      .addColumn('username', 'varchar(100)', col => col.notNull().unique())
      .addColumn('password', 'varchar(255)', col => col.notNull())
      .addColumn('first_name', 'varchar(100)')
      .addColumn('last_name', 'varchar(100)')
      .addColumn('is_active', 'boolean', col => col.defaultTo(true).notNull())
      .addColumn('email_verified', 'boolean', col => col.defaultTo(false).notNull())
      .addColumn('phone', 'varchar(20)')
      .addColumn('avatar_url', 'text')
      .addColumn('last_login_at', 'timestamp')
      .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addColumn('updated_at', 'timestamp', col => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addColumn('deleted_at', 'timestamp')
      .execute();

    // Create indexes
    await db.schema
      .createIndex('idx_users_email')
      .on('users')
      .column('email')
      .execute();

    await db.schema
      .createIndex('idx_users_username')
      .on('users')
      .column('username')
      .execute();

    await db.schema
      .createIndex('idx_users_is_active')
      .on('users')
      .column('is_active')
      .where('deleted_at', 'is', null)
      .execute();

    await db.schema
      .createIndex('idx_users_created_at')
      .on('users')
      .column('created_at')
      .execute();

    // Create updated_at trigger for PostgreSQL
    if (db.dialect.name === 'postgres') {
      await sql`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
        END;
        $$ language 'plpgsql';
      `.execute(db);

      await sql`
        CREATE TRIGGER update_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
      `.execute(db);
    }
  }

  async down(db: Kysely<any>): Promise<void> {
    // Drop triggers if PostgreSQL
    if (db.dialect.name === 'postgres') {
      await sql`DROP TRIGGER IF EXISTS update_users_updated_at ON users`.execute(db);
      await sql`DROP FUNCTION IF EXISTS update_updated_at_column()`.execute(db);
    }

    // Drop indexes
    await db.schema.dropIndex('idx_users_email').execute();
    await db.schema.dropIndex('idx_users_username').execute();
    await db.schema.dropIndex('idx_users_is_active').execute();
    await db.schema.dropIndex('idx_users_created_at').execute();

    // Drop table
    await db.schema.dropTable('users').execute();
  }
}