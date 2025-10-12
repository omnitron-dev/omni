/**
 * Example Product Repository with Audit Logging
 *
 * Showcases repository pattern with audit logging, custom plugins, and advanced queries
 */

import { z } from 'zod';
import { Repository, Audit, Timestamps } from '../database.decorators.js';
import { BaseRepository } from '../repository/base.repository.js';
import { Injectable } from '../../../decorators/index.js';
import type { Selectable, sql } from 'kysely';

// Product category enum
export enum ProductCategory {
  ELECTRONICS = 'electronics',
  CLOTHING = 'clothing',
  FOOD = 'food',
  BOOKS = 'books',
  HOME = 'home',
  SPORTS = 'sports',
}

// Product status enum
export enum ProductStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  OUT_OF_STOCK = 'out_of_stock',
  DISCONTINUED = 'discontinued',
}

// Schemas
export const ProductEntitySchema = z.object({
  id: z.number(),
  sku: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.nativeEnum(ProductCategory),
  status: z.nativeEnum(ProductStatus),
  price: z.number().positive(),
  cost: z.number().positive().optional(),
  stock: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0).default(10),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.any()).optional(),
  publishedAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateProductSchema = z.object({
  sku: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.nativeEnum(ProductCategory),
  status: z.nativeEnum(ProductStatus).default(ProductStatus.DRAFT),
  price: z.number().positive(),
  cost: z.number().positive().optional(),
  stock: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).default(10),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.any()).optional(),
});

export const UpdateProductSchema = CreateProductSchema.partial();

// Types
export type Product = z.infer<typeof ProductEntitySchema>;
export type CreateProductInput = z.infer<typeof CreateProductSchema>;
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

// Database schema
interface Database {
  products: {
    id: number;
    sku: string;
    name: string;
    description: string | null;
    category: string;
    status: string;
    price: number;
    cost: number | null;
    stock: number;
    low_stock_threshold: number;
    tags: string; // JSON string
    metadata: string | null; // JSON string
    published_at: Date | null;
    created_at: Date;
    updated_at: Date;
  };
  inventory_movements: {
    id: number;
    product_id: number;
    type: 'in' | 'out' | 'adjustment';
    quantity: number;
    reason: string;
    reference_id: string | null;
    created_at: Date;
  };
}

/**
 * Product Repository with Audit Logging
 */
@Injectable()
@Repository<Product>({
  table: 'products',
  schema: ProductEntitySchema,
  createSchema: CreateProductSchema,
  updateSchema: UpdateProductSchema,
})
@Audit({
  table: 'product_audit_logs',
  captureOldValues: true,
  captureNewValues: true,
})
@Timestamps({ createdAt: 'created_at', updatedAt: 'updated_at' })
export class ProductRepository extends BaseRepository<
  Database,
  'products',
  Product,
  CreateProductInput,
  UpdateProductInput
> {
  /**
   * Map database row to entity
   */
  protected mapRow(row: Selectable<Database['products']>): Product {
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      description: row.description || undefined,
      category: row.category as ProductCategory,
      status: row.status as ProductStatus,
      price: row.price,
      cost: row.cost || undefined,
      stock: row.stock,
      lowStockThreshold: row.low_stock_threshold,
      tags: row.tags ? JSON.parse(row.tags) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      publishedAt: row.published_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Map entity to database row
   */
  protected mapToDb(entity: Partial<Product>): any {
    const dbRow: any = {};

    if (entity.sku !== undefined) dbRow.sku = entity.sku;
    if (entity.name !== undefined) dbRow.name = entity.name;
    if (entity.description !== undefined) dbRow.description = entity.description;
    if (entity.category !== undefined) dbRow.category = entity.category;
    if (entity.status !== undefined) dbRow.status = entity.status;
    if (entity.price !== undefined) dbRow.price = entity.price;
    if (entity.cost !== undefined) dbRow.cost = entity.cost;
    if (entity.stock !== undefined) dbRow.stock = entity.stock;
    if (entity.lowStockThreshold !== undefined) dbRow.low_stock_threshold = entity.lowStockThreshold;
    if (entity.tags !== undefined) dbRow.tags = JSON.stringify(entity.tags);
    if (entity.metadata !== undefined) dbRow.metadata = JSON.stringify(entity.metadata);
    if (entity.publishedAt !== undefined) dbRow.published_at = entity.publishedAt;

    return dbRow;
  }

  /**
   * Find product by SKU
   */
  async findBySku(sku: string): Promise<Product | null> {
    const result = await this.query().where('sku', '=', sku).selectAll().executeTakeFirst();

    return result ? this.mapRow(result) : null;
  }

  /**
   * Find products by category
   */
  async findByCategory(category: ProductCategory): Promise<Product[]> {
    const results = await this.query()
      .where('category', '=', category)
      .where('status', '=', ProductStatus.PUBLISHED)
      .orderBy('name', 'asc')
      .selectAll()
      .execute();

    return results.map((row) => this.mapRow(row));
  }

  /**
   * Find low stock products
   */
  async findLowStockProducts(): Promise<Product[]> {
    const results = await this.qb
      .selectFrom('products')
      .selectAll()
      .where('stock', '<=', (eb) => eb.ref('low_stock_threshold'))
      .where('status', 'not in', [ProductStatus.DISCONTINUED])
      .orderBy('stock', 'asc')
      .execute();

    return results.map((row) => this.mapRow(row));
  }

  /**
   * Search products with full-text search
   */
  async searchProducts(options: {
    query?: string;
    category?: ProductCategory;
    status?: ProductStatus;
    minPrice?: number;
    maxPrice?: number;
    tags?: string[];
    inStock?: boolean;
    page?: number;
    limit?: number;
  }) {
    let query = this.query();

    // Text search
    if (options.query) {
      const term = `%${options.query}%`;
      query = query.where((qb) =>
        qb.where('name', 'like', term).or('description', 'like', term).or('sku', 'like', term)
      );
    }

    // Category filter
    if (options.category) {
      query = query.where('category', '=', options.category);
    }

    // Status filter
    if (options.status) {
      query = query.where('status', '=', options.status);
    }

    // Price range
    if (options.minPrice !== undefined) {
      query = query.where('price', '>=', options.minPrice);
    }
    if (options.maxPrice !== undefined) {
      query = query.where('price', '<=', options.maxPrice);
    }

    // Tag filter (products that have all specified tags)
    if (options.tags && options.tags.length > 0) {
      for (const tag of options.tags) {
        query = query.where('tags', 'like', `%"${tag}"%`);
      }
    }

    // Stock filter
    if (options.inStock === true) {
      query = query.where('stock', '>', 0);
    } else if (options.inStock === false) {
      query = query.where('stock', '=', 0);
    }

    // Order by relevance (name matches first)
    if (options.query) {
      query = query.orderBy(
        this.qb
          .case()
          .when('name', 'like', `${options.query}%`)
          .then(1)
          .when('name', 'like', `%${options.query}%`)
          .then(2)
          .else(3)
          .end(),
        'asc'
      );
    }

    query = query.orderBy('name', 'asc');

    return this.paginate({
      page: options.page,
      limit: options.limit,
    });
  }

  /**
   * Update product stock
   */
  async updateStock(
    productId: number,
    quantity: number,
    type: 'in' | 'out' | 'adjustment',
    reason: string,
    referenceId?: string
  ): Promise<Product> {
    // Use transaction to ensure consistency
    return this.qb.transaction().execute(async (trx) => {
      // Get current stock
      const product = await trx
        .selectFrom('products')
        .where('id', '=', productId)
        .select('stock')
        .executeTakeFirstOrThrow();

      // Calculate new stock
      let newStock = product.stock;
      if (type === 'in') {
        newStock += quantity;
      } else if (type === 'out') {
        newStock -= quantity;
        if (newStock < 0) {
          throw new Error('Insufficient stock');
        }
      } else {
        newStock = quantity;
      }

      // Update stock
      const updated = await trx
        .updateTable('products')
        .set({ stock: newStock, updated_at: new Date() })
        .where('id', '=', productId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Record inventory movement
      await trx
        .insertInto('inventory_movements')
        .values({
          product_id: productId,
          type,
          quantity,
          reason,
          reference_id: referenceId || null,
          created_at: new Date(),
        })
        .execute();

      return this.mapRow(updated);
    });
  }

  /**
   * Publish products
   */
  async publishProducts(productIds: number[]): Promise<void> {
    await this.qb
      .updateTable('products')
      .set({
        status: ProductStatus.PUBLISHED,
        published_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', 'in', productIds)
      .where('status', '=', ProductStatus.DRAFT)
      .execute();
  }

  /**
   * Get product statistics by category
   */
  async getStatisticsByCategory() {
    const results = await this.qb
      .selectFrom('products')
      .select([
        'category',
        this.qb.fn.count('id').as('count'),
        this.qb.fn.avg('price').as('avgPrice'),
        this.qb.fn.sum('stock').as('totalStock'),
        this.qb.fn.sum('stock', '*', 'price').as('totalValue'),
      ])
      .groupBy('category')
      .execute();

    return results.map((row) => ({
      category: row.category as ProductCategory,
      count: Number(row.count),
      avgPrice: Number(row.avgPrice),
      totalStock: Number(row.totalStock),
      totalValue: Number(row.totalValue),
    }));
  }

  /**
   * Get best selling products
   */
  async getBestSellingProducts(limit: number = 10): Promise<Product[]> {
    // This would typically join with an orders table
    // For now, we'll simulate by ordering by a combination of low stock and high price
    const results = await this.qb
      .selectFrom('products')
      .selectAll()
      .where('status', '=', ProductStatus.PUBLISHED)
      .orderBy(this.qb.fn('price', '*', this.qb.fn('low_stock_threshold', '-', 'stock')), 'desc')
      .limit(limit)
      .execute();

    return results.map((row) => this.mapRow(row));
  }

  /**
   * Clone a product
   */
  async cloneProduct(productId: number, newSku: string): Promise<Product> {
    const original = await this.findById(productId);
    if (!original) {
      throw new Error('Product not found');
    }

    const { id, sku, createdAt, updatedAt, publishedAt, ...cloneData } = original;

    return this.create({
      ...cloneData,
      sku: newSku,
      status: ProductStatus.DRAFT,
    } as CreateProductInput);
  }
}
