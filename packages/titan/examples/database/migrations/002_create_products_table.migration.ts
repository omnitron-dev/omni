/**
 * Migration: Create Products Table
 * Version: 002
 *
 * Creates products table with categories and inventory tracking
 */

import { Kysely, sql } from 'kysely';
import { Migration, IMigration } from '@omnitron-dev/titan/module/database';

@Migration({
  version: '002',
  description: 'Create products and categories tables',
  dependencies: ['001'], // Depends on users table
})
export class CreateProductsTableMigration implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    // Create categories table
    await db.schema
      .createTable('categories')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('name', 'varchar(100)', (col) => col.notNull().unique())
      .addColumn('slug', 'varchar(100)', (col) => col.notNull().unique())
      .addColumn('description', 'text')
      .addColumn('parent_id', 'integer', (col) => col.references('categories.id').onDelete('cascade'))
      .addColumn('display_order', 'integer', (col) => col.defaultTo(0))
      .addColumn('is_active', 'boolean', (col) => col.defaultTo(true))
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Create products table
    await db.schema
      .createTable('products')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('sku', 'varchar(100)', (col) => col.notNull().unique())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('category_id', 'integer', (col) => col.references('categories.id').onDelete('set null'))
      .addColumn('price', 'decimal(10,2)', (col) => col.notNull())
      .addColumn('cost', 'decimal(10,2)')
      .addColumn('currency', 'varchar(3)', (col) => col.defaultTo('USD'))
      .addColumn('stock', 'integer', (col) => col.defaultTo(0).notNull())
      .addColumn('low_stock_threshold', 'integer', (col) => col.defaultTo(10))
      .addColumn('weight', 'decimal(10,3)') // in kg
      .addColumn('dimensions', 'jsonb') // {length, width, height}
      .addColumn('tags', 'jsonb', (col) => col.defaultTo('[]'))
      .addColumn('metadata', 'jsonb')
      .addColumn('status', 'varchar(20)', (col) => col.defaultTo('draft'))
      .addColumn('published_at', 'timestamp')
      .addColumn('created_by', 'integer', (col) => col.references('users.id').onDelete('set null'))
      .addColumn('updated_by', 'integer', (col) => col.references('users.id').onDelete('set null'))
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Create inventory movements table for tracking stock changes
    await db.schema
      .createTable('inventory_movements')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('product_id', 'integer', (col) => col.references('products.id').onDelete('cascade').notNull())
      .addColumn('type', 'varchar(20)', (col) => col.notNull()) // in, out, adjustment
      .addColumn('quantity', 'integer', (col) => col.notNull())
      .addColumn('reason', 'varchar(255)', (col) => col.notNull())
      .addColumn('reference_type', 'varchar(50)') // order, return, adjustment, etc.
      .addColumn('reference_id', 'varchar(100)') // order ID, return ID, etc.
      .addColumn('notes', 'text')
      .addColumn('created_by', 'integer', (col) => col.references('users.id').onDelete('set null'))
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Create indexes
    await db.schema.createIndex('idx_categories_slug').on('categories').column('slug').execute();

    await db.schema.createIndex('idx_categories_parent').on('categories').column('parent_id').execute();

    await db.schema.createIndex('idx_products_sku').on('products').column('sku').execute();

    await db.schema.createIndex('idx_products_category').on('products').column('category_id').execute();

    await db.schema.createIndex('idx_products_status').on('products').column('status').execute();

    await db.schema
      .createIndex('idx_products_low_stock')
      .on('products')
      .columns(['stock', 'low_stock_threshold'])
      .where('stock', '<=', sql`low_stock_threshold`)
      .execute();

    await db.schema.createIndex('idx_inventory_product').on('inventory_movements').column('product_id').execute();

    await db.schema.createIndex('idx_inventory_created').on('inventory_movements').column('created_at').execute();

    // Create updated_at triggers for PostgreSQL
    if (db.dialect.name === 'postgres') {
      await sql`
        CREATE TRIGGER update_categories_updated_at
        BEFORE UPDATE ON categories
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
      `.execute(db);

      await sql`
        CREATE TRIGGER update_products_updated_at
        BEFORE UPDATE ON products
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
      `.execute(db);
    }
  }

  async down(db: Kysely<any>): Promise<void> {
    // Drop triggers if PostgreSQL
    if (db.dialect.name === 'postgres') {
      await sql`DROP TRIGGER IF EXISTS update_categories_updated_at ON categories`.execute(db);
      await sql`DROP TRIGGER IF EXISTS update_products_updated_at ON products`.execute(db);
    }

    // Drop indexes
    await db.schema.dropIndex('idx_inventory_created').execute();
    await db.schema.dropIndex('idx_inventory_product').execute();
    await db.schema.dropIndex('idx_products_low_stock').execute();
    await db.schema.dropIndex('idx_products_status').execute();
    await db.schema.dropIndex('idx_products_category').execute();
    await db.schema.dropIndex('idx_products_sku').execute();
    await db.schema.dropIndex('idx_categories_parent').execute();
    await db.schema.dropIndex('idx_categories_slug').execute();

    // Drop tables in reverse order
    await db.schema.dropTable('inventory_movements').execute();
    await db.schema.dropTable('products').execute();
    await db.schema.dropTable('categories').execute();
  }
}
