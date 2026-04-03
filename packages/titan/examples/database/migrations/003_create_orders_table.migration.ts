/**
 * Migration: Create Orders System
 * Version: 003
 *
 * Creates orders, order items, and payment tracking tables
 */

import { Kysely, sql } from 'kysely';
import { Migration, IMigration } from '@omnitron-dev/titan/module/database';

@Migration({
  version: '003',
  description: 'Create orders system with payments',
  dependencies: ['001', '002'], // Depends on users and products
  transactional: true,
  timeout: 120000, // 2 minutes for complex migration
})
export class CreateOrdersSystemMigration implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    // Create orders table
    await db.schema
      .createTable('orders')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('order_number', 'varchar(50)', (col) => col.notNull().unique())
      .addColumn('customer_id', 'integer', (col) => col.references('users.id').onDelete('restrict').notNull())
      .addColumn('status', 'varchar(20)', (col) => col.defaultTo('pending').notNull())
      .addColumn('subtotal', 'decimal(12,2)', (col) => col.notNull())
      .addColumn('tax_amount', 'decimal(12,2)', (col) => col.defaultTo(0))
      .addColumn('shipping_amount', 'decimal(12,2)', (col) => col.defaultTo(0))
      .addColumn('discount_amount', 'decimal(12,2)', (col) => col.defaultTo(0))
      .addColumn('total_amount', 'decimal(12,2)', (col) => col.notNull())
      .addColumn('currency', 'varchar(3)', (col) => col.defaultTo('USD'))
      .addColumn('payment_status', 'varchar(20)', (col) => col.defaultTo('unpaid'))
      .addColumn('fulfillment_status', 'varchar(20)', (col) => col.defaultTo('unfulfilled'))
      .addColumn('notes', 'text')
      .addColumn('internal_notes', 'text')
      .addColumn('shipping_address', 'jsonb', (col) => col.notNull())
      .addColumn('billing_address', 'jsonb', (col) => col.notNull())
      .addColumn('metadata', 'jsonb')
      .addColumn('order_date', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('confirmed_at', 'timestamp')
      .addColumn('shipped_at', 'timestamp')
      .addColumn('delivered_at', 'timestamp')
      .addColumn('cancelled_at', 'timestamp')
      .addColumn('refunded_at', 'timestamp')
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Create order items table
    await db.schema
      .createTable('order_items')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('order_id', 'integer', (col) => col.references('orders.id').onDelete('cascade').notNull())
      .addColumn('product_id', 'integer', (col) => col.references('products.id').onDelete('restrict').notNull())
      .addColumn('product_sku', 'varchar(100)', (col) => col.notNull())
      .addColumn('product_name', 'varchar(255)', (col) => col.notNull())
      .addColumn('product_price', 'decimal(10,2)', (col) => col.notNull())
      .addColumn('quantity', 'integer', (col) => col.notNull())
      .addColumn('subtotal', 'decimal(10,2)', (col) => col.notNull())
      .addColumn('discount_amount', 'decimal(10,2)', (col) => col.defaultTo(0))
      .addColumn('tax_amount', 'decimal(10,2)', (col) => col.defaultTo(0))
      .addColumn('total', 'decimal(10,2)', (col) => col.notNull())
      .addColumn('metadata', 'jsonb')
      .addColumn('fulfilled_quantity', 'integer', (col) => col.defaultTo(0))
      .addColumn('returned_quantity', 'integer', (col) => col.defaultTo(0))
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Create payments table
    await db.schema
      .createTable('payments')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('order_id', 'integer', (col) => col.references('orders.id').onDelete('cascade').notNull())
      .addColumn('payment_method', 'varchar(50)', (col) => col.notNull())
      .addColumn('payment_provider', 'varchar(50)') // stripe, paypal, etc.
      .addColumn('transaction_id', 'varchar(255)', (col) => col.unique())
      .addColumn('amount', 'decimal(12,2)', (col) => col.notNull())
      .addColumn('currency', 'varchar(3)', (col) => col.defaultTo('USD'))
      .addColumn('status', 'varchar(20)', (col) => col.notNull()) // pending, completed, failed, refunded
      .addColumn('gateway_response', 'jsonb')
      .addColumn('metadata', 'jsonb')
      .addColumn('paid_at', 'timestamp')
      .addColumn('failed_at', 'timestamp')
      .addColumn('refunded_at', 'timestamp')
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Create order status history table for tracking changes
    await db.schema
      .createTable('order_status_history')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('order_id', 'integer', (col) => col.references('orders.id').onDelete('cascade').notNull())
      .addColumn('from_status', 'varchar(20)')
      .addColumn('to_status', 'varchar(20)', (col) => col.notNull())
      .addColumn('reason', 'varchar(255)')
      .addColumn('notes', 'text')
      .addColumn('changed_by', 'integer', (col) => col.references('users.id').onDelete('set null'))
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Create indexes for performance
    await db.schema.createIndex('idx_orders_customer').on('orders').column('customer_id').execute();

    await db.schema.createIndex('idx_orders_status').on('orders').column('status').execute();

    await db.schema.createIndex('idx_orders_payment_status').on('orders').column('payment_status').execute();

    await db.schema.createIndex('idx_orders_order_date').on('orders').column('order_date').execute();

    await db.schema.createIndex('idx_order_items_order').on('order_items').column('order_id').execute();

    await db.schema.createIndex('idx_order_items_product').on('order_items').column('product_id').execute();

    await db.schema.createIndex('idx_payments_order').on('payments').column('order_id').execute();

    await db.schema.createIndex('idx_payments_status').on('payments').column('status').execute();

    await db.schema
      .createIndex('idx_order_status_history_order')
      .on('order_status_history')
      .column('order_id')
      .execute();

    // Create computed column for total calculation (PostgreSQL specific)
    if (db.dialect.name === 'postgres') {
      // Create trigger for automatic total calculation
      await sql`
        CREATE OR REPLACE FUNCTION calculate_order_total()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.total_amount = NEW.subtotal + NEW.tax_amount + NEW.shipping_amount - NEW.discount_amount;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `.execute(db);

      await sql`
        CREATE TRIGGER calculate_order_total_trigger
        BEFORE INSERT OR UPDATE OF subtotal, tax_amount, shipping_amount, discount_amount
        ON orders
        FOR EACH ROW
        EXECUTE FUNCTION calculate_order_total();
      `.execute(db);

      // Create trigger for order status history
      await sql`
        CREATE OR REPLACE FUNCTION track_order_status_change()
        RETURNS TRIGGER AS $$
        BEGIN
          IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
            INSERT INTO order_status_history (order_id, from_status, to_status)
            VALUES (NEW.id, OLD.status, NEW.status);
          ELSIF (TG_OP = 'INSERT') THEN
            INSERT INTO order_status_history (order_id, from_status, to_status)
            VALUES (NEW.id, NULL, NEW.status);
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `.execute(db);

      await sql`
        CREATE TRIGGER track_order_status_trigger
        AFTER INSERT OR UPDATE OF status
        ON orders
        FOR EACH ROW
        EXECUTE FUNCTION track_order_status_change();
      `.execute(db);

      // Add updated_at triggers
      await sql`
        CREATE TRIGGER update_orders_updated_at
        BEFORE UPDATE ON orders
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
      `.execute(db);

      await sql`
        CREATE TRIGGER update_payments_updated_at
        BEFORE UPDATE ON payments
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
      `.execute(db);
    }

    // Create a view for order summaries
    await sql`
      CREATE VIEW order_summaries AS
      SELECT
        o.id,
        o.order_number,
        o.customer_id,
        u.email as customer_email,
        u.first_name || ' ' || u.last_name as customer_name,
        o.status,
        o.payment_status,
        o.fulfillment_status,
        o.total_amount,
        o.currency,
        COUNT(DISTINCT oi.id) as item_count,
        SUM(oi.quantity) as total_quantity,
        o.order_date,
        o.created_at
      FROM orders o
      JOIN users u ON o.customer_id = u.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id, u.id, u.email, u.first_name, u.last_name
    `.execute(db);
  }

  async down(db: Kysely<any>): Promise<void> {
    // Drop view
    await sql`DROP VIEW IF EXISTS order_summaries`.execute(db);

    // Drop triggers if PostgreSQL
    if (db.dialect.name === 'postgres') {
      await sql`DROP TRIGGER IF EXISTS update_payments_updated_at ON payments`.execute(db);
      await sql`DROP TRIGGER IF EXISTS update_orders_updated_at ON orders`.execute(db);
      await sql`DROP TRIGGER IF EXISTS track_order_status_trigger ON orders`.execute(db);
      await sql`DROP TRIGGER IF EXISTS calculate_order_total_trigger ON orders`.execute(db);
      await sql`DROP FUNCTION IF EXISTS track_order_status_change()`.execute(db);
      await sql`DROP FUNCTION IF EXISTS calculate_order_total()`.execute(db);
    }

    // Drop indexes
    await db.schema.dropIndex('idx_order_status_history_order').execute();
    await db.schema.dropIndex('idx_payments_status').execute();
    await db.schema.dropIndex('idx_payments_order').execute();
    await db.schema.dropIndex('idx_order_items_product').execute();
    await db.schema.dropIndex('idx_order_items_order').execute();
    await db.schema.dropIndex('idx_orders_order_date').execute();
    await db.schema.dropIndex('idx_orders_payment_status').execute();
    await db.schema.dropIndex('idx_orders_status').execute();
    await db.schema.dropIndex('idx_orders_customer').execute();

    // Drop tables in reverse order
    await db.schema.dropTable('order_status_history').execute();
    await db.schema.dropTable('payments').execute();
    await db.schema.dropTable('order_items').execute();
    await db.schema.dropTable('orders').execute();
  }
}
