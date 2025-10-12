/**
 * Example Order Repository with Relationships
 *
 * Showcases repository pattern with relationships, joins, and complex queries
 */

import { z } from 'zod';
import { Repository, Timestamps } from '../database.decorators.js';
import { BaseRepository } from '../repository/base.repository.js';
import { Injectable } from '../../../decorators/index.js';
import type { Selectable } from 'kysely';

// Order status enum
export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

// Schemas
export const OrderEntitySchema = z.object({
  id: z.number(),
  orderNumber: z.string(),
  customerId: z.number(),
  status: z.nativeEnum(OrderStatus),
  subtotal: z.number(),
  tax: z.number(),
  shipping: z.number(),
  total: z.number(),
  currency: z.string().default('USD'),
  notes: z.string().optional(),
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }),
  billingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }),
  orderDate: z.date(),
  confirmedAt: z.date().nullable().optional(),
  shippedAt: z.date().nullable().optional(),
  deliveredAt: z.date().nullable().optional(),
  cancelledAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const OrderItemSchema = z.object({
  id: z.number(),
  orderId: z.number(),
  productId: z.number(),
  sku: z.string(),
  name: z.string(),
  price: z.number(),
  quantity: z.number(),
  total: z.number(),
});

export const CreateOrderSchema = z.object({
  customerId: z.number(),
  items: z
    .array(
      z.object({
        productId: z.number(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
  notes: z.string().optional(),
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }),
  billingAddress: z
    .object({
      street: z.string(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
      country: z.string(),
    })
    .optional(),
});

export const UpdateOrderSchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  notes: z.string().optional(),
  shippingAddress: z
    .object({
      street: z.string(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
      country: z.string(),
    })
    .optional(),
});

// Types
export type Order = z.infer<typeof OrderEntitySchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type UpdateOrderInput = z.infer<typeof UpdateOrderSchema>;

// Extended order with relationships
export interface OrderWithItems extends Order {
  items: OrderItem[];
}

export interface OrderWithCustomer extends Order {
  customer: {
    id: number;
    name: string;
    email: string;
  };
}

// Database schema
interface Database {
  orders: {
    id: number;
    order_number: string;
    customer_id: number;
    status: string;
    subtotal: number;
    tax: number;
    shipping: number;
    total: number;
    currency: string;
    notes: string | null;
    shipping_address: string; // JSON
    billing_address: string; // JSON
    order_date: Date;
    confirmed_at: Date | null;
    shipped_at: Date | null;
    delivered_at: Date | null;
    cancelled_at: Date | null;
    created_at: Date;
    updated_at: Date;
  };
  order_items: {
    id: number;
    order_id: number;
    product_id: number;
    sku: string;
    name: string;
    price: number;
    quantity: number;
    total: number;
  };
  customers: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  };
  products: {
    id: number;
    sku: string;
    name: string;
    price: number;
    stock: number;
  };
}

/**
 * Order Repository with Relationships and Complex Queries
 */
@Injectable()
@Repository<Order>({
  table: 'orders',
  schema: OrderEntitySchema,
  createSchema: CreateOrderSchema,
  updateSchema: UpdateOrderSchema,
})
@Timestamps({ createdAt: 'created_at', updatedAt: 'updated_at' })
export class OrderRepository extends BaseRepository<Database, 'orders', Order, CreateOrderInput, UpdateOrderInput> {
  /**
   * Map database row to entity
   */
  protected mapRow(row: Selectable<Database['orders']>): Order {
    return {
      id: row.id,
      orderNumber: row.order_number,
      customerId: row.customer_id,
      status: row.status as OrderStatus,
      subtotal: row.subtotal,
      tax: row.tax,
      shipping: row.shipping,
      total: row.total,
      currency: row.currency,
      notes: row.notes || undefined,
      shippingAddress: JSON.parse(row.shipping_address),
      billingAddress: JSON.parse(row.billing_address),
      orderDate: row.order_date,
      confirmedAt: row.confirmed_at,
      shippedAt: row.shipped_at,
      deliveredAt: row.delivered_at,
      cancelledAt: row.cancelled_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Generate unique order number
   */
  private generateOrderNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `ORD-${timestamp}-${random}`;
  }

  /**
   * Create order with items
   */
  async createOrder(input: CreateOrderInput): Promise<OrderWithItems> {
    return this.qb.transaction().execute(async (trx) => {
      // Get product details and calculate totals
      const products = await trx
        .selectFrom('products')
        .where(
          'id',
          'in',
          input.items.map((i) => i.productId)
        )
        .selectAll()
        .execute();

      const productMap = new Map(products.map((p) => [p.id, p]));

      // Calculate order totals
      let subtotal = 0;
      const orderItems: Omit<Database['order_items'], 'id' | 'order_id'>[] = [];

      for (const item of input.items) {
        const product = productMap.get(item.productId);
        if (!product) {
          throw new Error(`Product ${item.productId} not found`);
        }
        if (product.stock < item.quantity) {
          throw new Error(`Insufficient stock for product ${product.sku}`);
        }

        const itemTotal = product.price * item.quantity;
        subtotal += itemTotal;

        orderItems.push({
          product_id: item.productId,
          sku: product.sku,
          name: product.name,
          price: product.price,
          quantity: item.quantity,
          total: itemTotal,
        });
      }

      // Calculate tax and shipping (simplified)
      const tax = subtotal * 0.1; // 10% tax
      const shipping = subtotal > 100 ? 0 : 10; // Free shipping over $100
      const total = subtotal + tax + shipping;

      // Create order
      const order = await trx
        .insertInto('orders')
        .values({
          order_number: this.generateOrderNumber(),
          customer_id: input.customerId,
          status: OrderStatus.PENDING,
          subtotal,
          tax,
          shipping,
          total,
          currency: 'USD',
          notes: input.notes || null,
          shipping_address: JSON.stringify(input.shippingAddress),
          billing_address: JSON.stringify(input.billingAddress || input.shippingAddress),
          order_date: new Date(),
          confirmed_at: null,
          shipped_at: null,
          delivered_at: null,
          cancelled_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Create order items
      const items = await trx
        .insertInto('order_items')
        .values(orderItems.map((item) => ({ ...item, order_id: order.id })))
        .returningAll()
        .execute();

      // Update product stock
      for (const item of input.items) {
        await trx
          .updateTable('products')
          .set((eb) => ({ stock: eb('stock', '-', item.quantity) }))
          .where('id', '=', item.productId)
          .execute();
      }

      return {
        ...this.mapRow(order),
        items: items.map((item) => ({
          id: item.id,
          orderId: item.order_id,
          productId: item.product_id,
          sku: item.sku,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          total: item.total,
        })),
      };
    });
  }

  /**
   * Find order with items
   */
  async findWithItems(orderId: number): Promise<OrderWithItems | null> {
    const order = await this.findById(orderId);
    if (!order) return null;

    const items = await this.qb.selectFrom('order_items').where('order_id', '=', orderId).selectAll().execute();

    return {
      ...order,
      items: items.map((item) => ({
        id: item.id,
        orderId: item.order_id,
        productId: item.product_id,
        sku: item.sku,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        total: item.total,
      })),
    };
  }

  /**
   * Find orders with customer details
   */
  async findWithCustomer(orderId: number): Promise<OrderWithCustomer | null> {
    const result = await this.qb
      .selectFrom('orders')
      .innerJoin('customers', 'customers.id', 'orders.customer_id')
      .where('orders.id', '=', orderId)
      .select([
        'orders.id',
        'orders.order_number',
        'orders.customer_id',
        'orders.status',
        'orders.subtotal',
        'orders.tax',
        'orders.shipping',
        'orders.total',
        'orders.currency',
        'orders.notes',
        'orders.shipping_address',
        'orders.billing_address',
        'orders.order_date',
        'orders.confirmed_at',
        'orders.shipped_at',
        'orders.delivered_at',
        'orders.cancelled_at',
        'orders.created_at',
        'orders.updated_at',
        'customers.id as customer_id',
        'customers.email as customer_email',
        'customers.first_name as customer_first_name',
        'customers.last_name as customer_last_name',
      ])
      .executeTakeFirst();

    if (!result) return null;

    return {
      ...this.mapRow(result),
      customer: {
        id: result.customer_id,
        name: `${result.customer_first_name} ${result.customer_last_name}`,
        email: result.customer_email,
      },
    };
  }

  /**
   * Find orders by customer
   */
  async findByCustomer(customerId: number): Promise<Order[]> {
    const results = await this.query()
      .where('customer_id', '=', customerId)
      .orderBy('order_date', 'desc')
      .selectAll()
      .execute();

    return results.map((row) => this.mapRow(row));
  }

  /**
   * Find orders by status
   */
  async findByStatus(status: OrderStatus): Promise<Order[]> {
    const results = await this.query().where('status', '=', status).orderBy('created_at', 'desc').selectAll().execute();

    return results.map((row) => this.mapRow(row));
  }

  /**
   * Update order status with timestamp
   */
  async updateOrderStatus(orderId: number, status: OrderStatus): Promise<Order> {
    const updates: any = { status, updated_at: new Date() };

    // Set appropriate timestamp based on status
    switch (status) {
      case OrderStatus.CONFIRMED:
        updates.confirmed_at = new Date();
        break;
      case OrderStatus.SHIPPED:
        updates.shipped_at = new Date();
        break;
      case OrderStatus.DELIVERED:
        updates.delivered_at = new Date();
        break;
      case OrderStatus.CANCELLED:
        updates.cancelled_at = new Date();
        break;
    }

    const result = await this.qb
      .updateTable('orders')
      .set(updates)
      .where('id', '=', orderId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapRow(result);
  }

  /**
   * Get order statistics for a date range
   */
  async getOrderStatistics(startDate: Date, endDate: Date) {
    const results = await this.qb
      .selectFrom('orders')
      .where('order_date', '>=', startDate)
      .where('order_date', '<=', endDate)
      .select([
        this.qb.fn.count('id').as('totalOrders'),
        this.qb.fn.sum('total').as('totalRevenue'),
        this.qb.fn.avg('total').as('averageOrderValue'),
        this.qb.fn
          .countAll()
          .filter((eb) => eb('status', '=', OrderStatus.DELIVERED))
          .as('deliveredOrders'),
        this.qb.fn
          .countAll()
          .filter((eb) => eb('status', '=', OrderStatus.CANCELLED))
          .as('cancelledOrders'),
      ])
      .executeTakeFirst();

    return {
      totalOrders: Number(results?.totalOrders || 0),
      totalRevenue: Number(results?.totalRevenue || 0),
      averageOrderValue: Number(results?.averageOrderValue || 0),
      deliveredOrders: Number(results?.deliveredOrders || 0),
      cancelledOrders: Number(results?.cancelledOrders || 0),
    };
  }

  /**
   * Get top customers by order value
   */
  async getTopCustomers(limit: number = 10) {
    const results = await this.qb
      .selectFrom('orders')
      .innerJoin('customers', 'customers.id', 'orders.customer_id')
      .where('orders.status', 'not in', [OrderStatus.CANCELLED, OrderStatus.REFUNDED])
      .groupBy(['customers.id', 'customers.email', 'customers.first_name', 'customers.last_name'])
      .select([
        'customers.id',
        'customers.email',
        'customers.first_name',
        'customers.last_name',
        this.qb.fn.count('orders.id').as('orderCount'),
        this.qb.fn.sum('orders.total').as('totalSpent'),
      ])
      .orderBy('totalSpent', 'desc')
      .limit(limit)
      .execute();

    return results.map((row) => ({
      customerId: row.id,
      email: row.email,
      name: `${row.first_name} ${row.last_name}`,
      orderCount: Number(row.orderCount),
      totalSpent: Number(row.totalSpent),
    }));
  }

  /**
   * Get best selling products from orders
   */
  async getBestSellingProducts(limit: number = 10) {
    const results = await this.qb
      .selectFrom('order_items')
      .innerJoin('orders', 'orders.id', 'order_items.order_id')
      .where('orders.status', 'not in', [OrderStatus.CANCELLED, OrderStatus.REFUNDED])
      .groupBy(['order_items.product_id', 'order_items.sku', 'order_items.name'])
      .select([
        'order_items.product_id',
        'order_items.sku',
        'order_items.name',
        this.qb.fn.sum('order_items.quantity').as('totalQuantity'),
        this.qb.fn.sum('order_items.total').as('totalRevenue'),
        this.qb.fn.count('order_items.id').as('orderCount'),
      ])
      .orderBy('totalQuantity', 'desc')
      .limit(limit)
      .execute();

    return results.map((row) => ({
      productId: row.product_id,
      sku: row.sku,
      name: row.name,
      totalQuantity: Number(row.totalQuantity),
      totalRevenue: Number(row.totalRevenue),
      orderCount: Number(row.orderCount),
    }));
  }
}
