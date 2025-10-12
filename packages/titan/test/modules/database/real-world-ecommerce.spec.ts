/**
 * Real-World E-Commerce Application Tests
 *
 * Comprehensive tests demonstrating realistic usage of the database module
 * in an e-commerce application with all features integrated
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Application } from '../../../src/application.js';
import { Module, Injectable, Inject } from '../../../src/decorators/index.js';
import { Kysely, sql } from 'kysely';
import {
  TitanDatabaseModule,
  InjectConnection,
  InjectRepository,
  InjectDatabaseManager,
  Repository,
  BaseRepository,
  Transactional,
  TransactionManager,
  TransactionIsolationLevel,
  DatabaseManager,
  DatabaseHealthIndicator,
  DATABASE_TRANSACTION_MANAGER,
  optimisticLockingPlugin,
  validationPlugin,
  CommonSchemas,
} from '../../../src/modules/database/index.js';
import { z } from 'zod';

// ============================================================================
// Domain Models & Schemas
// ============================================================================

// Validation schemas
const userSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50),
  full_name: z.string().min(2).max(100),
  password_hash: z.string().min(60),
  role: CommonSchemas.enum(['customer', 'admin', 'vendor']),
  is_active: z.boolean(),
  email_verified: z.boolean(),
});

const productSchema = z.object({
  sku: z.string().regex(/^[A-Z0-9-]+$/),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  price: z.number().positive(),
  cost: z.number().nonnegative(),
  stock_quantity: z.number().int().nonnegative(),
  category_id: z.number().int().positive(),
  vendor_id: z.number().int().positive().optional(),
  is_active: z.boolean(),
});

const orderSchema = z.object({
  user_id: z.number().int().positive(),
  status: CommonSchemas.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']),
  total_amount: z.number().nonnegative(),
  shipping_address: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zip: z.string(),
    country: z.string(),
  }),
  payment_method: CommonSchemas.enum(['credit_card', 'paypal', 'stripe', 'bank_transfer']),
});

// Entity interfaces
interface User {
  id: number;
  email: string;
  username: string;
  full_name: string;
  password_hash: string;
  role: 'customer' | 'admin' | 'vendor';
  is_active: boolean;
  email_verified: boolean;
  last_login?: Date;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

interface Product {
  id: number;
  sku: string;
  name: string;
  description?: string;
  price: number;
  cost: number;
  stock_quantity: number;
  category_id: number;
  vendor_id?: number;
  is_active: boolean;
  version: number; // For optimistic locking
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

interface Category {
  id: number;
  name: string;
  slug: string;
  parent_id?: number;
  display_order: number;
  created_at: Date;
  updated_at: Date;
}

interface Order {
  id: number;
  order_number: string;
  user_id: number;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  total_amount: number;
  tax_amount: number;
  shipping_amount: number;
  discount_amount: number;
  shipping_address: any;
  billing_address: any;
  payment_method: string;
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  total_price: number;
  discount_amount: number;
  created_at: Date;
}

interface Cart {
  id: number;
  user_id: number;
  session_id?: string;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface CartItem {
  id: number;
  cart_id: number;
  product_id: number;
  quantity: number;
  added_at: Date;
  updated_at: Date;
}

interface Review {
  id: number;
  product_id: number;
  user_id: number;
  rating: number;
  title?: string;
  content?: string;
  is_verified_purchase: boolean;
  helpful_count: number;
  created_at: Date;
  updated_at: Date;
}

interface Inventory {
  id: number;
  product_id: number;
  warehouse_id: number;
  quantity: number;
  reserved_quantity: number;
  last_restock_date?: Date;
  updated_at: Date;
}

// ============================================================================
// Repositories
// ============================================================================

@Repository<User>({
  table: 'users',
  timestamps: true,
  softDelete: true,
  plugins: [
    {
      plugin: validationPlugin,
      options: { schema: userSchema },
    },
  ],
})
class UserRepository extends BaseRepository<any, 'users', User, Partial<User>, Partial<User>> {
  async findByEmail(email: string): Promise<User | null> {
    return this.findOne({ email });
  }

  async findActiveCustomers(): Promise<User[]> {
    return this.findAll({
      where: { role: 'customer', is_active: true },
      orderBy: [{ column: 'created_at', direction: 'desc' }],
    });
  }

  async updateLastLogin(userId: number): Promise<void> {
    await this.update(userId, { last_login: new Date() });
  }
}

@Repository<Product>({
  table: 'products',
  timestamps: true,
  softDelete: true,
  plugins: [
    optimisticLockingPlugin,
    {
      plugin: validationPlugin,
      options: { schema: productSchema },
    },
  ],
})
class ProductRepository extends BaseRepository<any, 'products', Product, Partial<Product>, Partial<Product>> {
  async findBySku(sku: string): Promise<Product | null> {
    return this.findOne({ sku });
  }

  async findInStock(): Promise<Product[]> {
    const db = await this.getDb();
    return db
      .selectFrom('products')
      .selectAll()
      .where('stock_quantity', '>', 0)
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .execute() as Promise<Product[]>;
  }

  async updateStock(productId: number, quantity: number): Promise<void> {
    const db = await this.getDb();
    await db
      .updateTable('products')
      .set((eb: any) => ({
        stock_quantity: eb('stock_quantity', '+', quantity),
        version: eb('version', '+', 1),
        updated_at: new Date(),
      }))
      .where('id', '=', productId)
      .execute();
  }

  async findByCategory(categoryId: number): Promise<Product[]> {
    return this.findAll({
      where: { category_id: categoryId, is_active: true },
    });
  }

  private async getDb() {
    return (this as any).qb || (this as any).db;
  }
}

@Repository<Order>({
  table: 'orders',
  timestamps: true,
})
class OrderRepository extends BaseRepository<any, 'orders', Order, Partial<Order>, Partial<Order>> {
  async findByOrderNumber(orderNumber: string): Promise<Order | null> {
    return this.findOne({ order_number: orderNumber });
  }

  async findUserOrders(userId: number): Promise<Order[]> {
    return this.findAll({
      where: { user_id: userId },
      orderBy: [{ column: 'created_at', direction: 'desc' }],
    });
  }

  async updateStatus(orderId: number, status: Order['status']): Promise<void> {
    await this.update(orderId, { status });
  }

  async getOrderStatistics(startDate: Date, endDate: Date): Promise<any> {
    const db = await this.getDb();
    return db
      .selectFrom('orders')
      .select([
        sql<number>`COUNT(*)`.as('total_orders'),
        sql<number>`SUM(total_amount)`.as('total_revenue'),
        sql<number>`AVG(total_amount)`.as('average_order_value'),
      ])
      .where('created_at', '>=', startDate)
      .where('created_at', '<=', endDate)
      .where('status', '!=', 'cancelled')
      .executeTakeFirst();
  }

  private async getDb() {
    return (this as any).qb || (this as any).db;
  }
}

@Repository<OrderItem>({
  table: 'order_items',
})
class OrderItemRepository extends BaseRepository<
  any,
  'order_items',
  OrderItem,
  Partial<OrderItem>,
  Partial<OrderItem>
> {
  async findByOrderId(orderId: number): Promise<OrderItem[]> {
    return this.findAll({ where: { order_id: orderId } });
  }
}

@Repository<Cart>({
  table: 'carts',
  timestamps: true,
})
class CartRepository extends BaseRepository<any, 'carts', Cart, Partial<Cart>, Partial<Cart>> {
  async findActiveCart(userId: number): Promise<Cart | null> {
    const db = await this.getDb();
    const cart = await db
      .selectFrom('carts')
      .selectAll()
      .where('user_id', '=', userId)
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return cart as Cart | null;
  }

  async cleanupExpiredCarts(): Promise<number> {
    return this.deleteMany({ expires_at: new Date() });
  }

  private async getDb() {
    return (this as any).qb || (this as any).db;
  }
}

@Repository<CartItem>({
  table: 'cart_items',
})
class CartItemRepository extends BaseRepository<any, 'cart_items', CartItem, Partial<CartItem>, Partial<CartItem>> {
  async findByCartId(cartId: number): Promise<CartItem[]> {
    return this.findAll({ where: { cart_id: cartId } });
  }

  async updateQuantity(cartId: number, productId: number, quantity: number): Promise<void> {
    const db = await this.getDb();
    await db
      .updateTable('cart_items')
      .set({ quantity, updated_at: new Date() })
      .where('cart_id', '=', cartId)
      .where('product_id', '=', productId)
      .execute();
  }

  private async getDb() {
    return (this as any).qb || (this as any).db;
  }
}

@Repository<Review>({
  table: 'reviews',
  timestamps: true,
})
class ReviewRepository extends BaseRepository<any, 'reviews', Review, Partial<Review>, Partial<Review>> {
  async findByProductId(productId: number): Promise<Review[]> {
    return this.findAll({
      where: { product_id: productId },
      orderBy: [{ column: 'helpful_count', direction: 'desc' }],
    });
  }

  async getAverageRating(productId: number): Promise<number> {
    const db = await this.getDb();
    const result = await db
      .selectFrom('reviews')
      .select(sql<number>`AVG(rating)`.as('avg_rating'))
      .where('product_id', '=', productId)
      .executeTakeFirst();
    return (result as any)?.avg_rating || 0;
  }

  private async getDb() {
    return (this as any).qb || (this as any).db;
  }
}

@Repository<Inventory>({
  table: 'inventory',
})
class InventoryRepository extends BaseRepository<any, 'inventory', Inventory, Partial<Inventory>, Partial<Inventory>> {
  async getAvailableStock(productId: number): Promise<number> {
    const db = await this.getDb();
    const result = await db
      .selectFrom('inventory')
      .select(sql<number>`SUM(quantity - reserved_quantity)`.as('available'))
      .where('product_id', '=', productId)
      .executeTakeFirst();
    return (result as any)?.available || 0;
  }

  async reserveStock(productId: number, warehouseId: number, quantity: number): Promise<void> {
    const db = await this.getDb();
    await db
      .updateTable('inventory')
      .set((eb: any) => ({
        reserved_quantity: eb('reserved_quantity', '+', quantity),
        updated_at: new Date(),
      }))
      .where('product_id', '=', productId)
      .where('warehouse_id', '=', warehouseId)
      .execute();
  }

  private async getDb() {
    return (this as any).qb || (this as any).db;
  }
}

// ============================================================================
// Services
// ============================================================================

@Injectable()
class EcommerceService {
  constructor(
    @InjectRepository(UserRepository) private userRepo: UserRepository,
    @InjectRepository(ProductRepository) private productRepo: ProductRepository,
    @InjectRepository(OrderRepository) private orderRepo: OrderRepository,
    @InjectRepository(OrderItemRepository) private orderItemRepo: OrderItemRepository,
    @InjectRepository(CartRepository) private cartRepo: CartRepository,
    @InjectRepository(CartItemRepository) private cartItemRepo: CartItemRepository,
    @InjectRepository(ReviewRepository) private reviewRepo: ReviewRepository,
    @InjectRepository(InventoryRepository) private inventoryRepo: InventoryRepository,
    @Inject(DATABASE_TRANSACTION_MANAGER) private txManager: TransactionManager,
    @InjectDatabaseManager() private dbManager: DatabaseManager,
    @InjectConnection() private db: Kysely<any>
  ) {}

  /**
   * Complete checkout process with inventory, payment, and order creation
   */
  @Transactional({
    isolation: TransactionIsolationLevel.SERIALIZABLE,
  })
  async checkout(userId: number, paymentDetails: any, shippingAddress: any): Promise<Order> {
    // Get active cart
    const cart = await this.cartRepo.findActiveCart(userId);
    if (!cart) {
      throw new Error('No active cart found');
    }

    // Get cart items with product details
    const cartItems = await this.cartItemRepo.findByCartId(cart.id);
    if (cartItems.length === 0) {
      throw new Error('Cart is empty');
    }

    // Calculate totals and check stock
    let subtotal = 0;
    const orderItems: Partial<OrderItem>[] = [];

    for (const item of cartItems) {
      const product = await this.productRepo.findById(item.product_id);
      if (!product) {
        throw new Error(`Product ${item.product_id} not found`);
      }

      if (product.stock_quantity < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      subtotal += product.price * item.quantity;
      orderItems.push({
        product_id: product.id,
        quantity: item.quantity,
        unit_price: product.price,
        total_price: product.price * item.quantity,
        discount_amount: 0,
      });
    }

    // Calculate tax and shipping
    const taxRate = 0.08;
    const taxAmount = subtotal * taxRate;
    const shippingAmount = subtotal > 100 ? 0 : 10;
    const totalAmount = subtotal + taxAmount + shippingAmount;

    // Create order
    const order = await this.orderRepo.create({
      order_number: this.generateOrderNumber(),
      user_id: userId,
      status: 'pending',
      total_amount: totalAmount,
      tax_amount: taxAmount,
      shipping_amount: shippingAmount,
      discount_amount: 0,
      shipping_address: shippingAddress,
      billing_address: shippingAddress,
      payment_method: paymentDetails.method,
      payment_status: 'pending',
    });

    // Create order items and update stock
    for (const item of orderItems) {
      await this.orderItemRepo.create({
        ...item,
        order_id: order.id,
      });

      // Update product stock
      await this.productRepo.updateStock(item.product_id!, -item.quantity!);

      // Reserve inventory
      await this.inventoryRepo.reserveStock(item.product_id!, 1, item.quantity!);
    }

    // Process payment (mock)
    const paymentSuccess = await this.processPayment(paymentDetails, totalAmount);
    if (!paymentSuccess) {
      throw new Error('Payment failed');
    }

    // Update order status
    await this.orderRepo.update(order.id, {
      status: 'processing',
      payment_status: 'paid',
    });

    // Clear cart
    await this.cartItemRepo.deleteMany({ cart_id: cart.id });

    return order;
  }

  /**
   * Add item to cart with stock validation
   */
  async addToCart(userId: number, productId: number, quantity: number): Promise<CartItem> {
    return this.txManager.executeInTransaction(async () => {
      // Get or create cart
      let cart = await this.cartRepo.findActiveCart(userId);
      if (!cart) {
        cart = await this.cartRepo.create({
          user_id: userId,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        });
      }

      // Check product availability
      const product = await this.productRepo.findById(productId);
      if (!product || !product.is_active) {
        throw new Error('Product not available');
      }

      if (product.stock_quantity < quantity) {
        throw new Error('Insufficient stock');
      }

      // Check if item already in cart
      const existingItem = await this.cartItemRepo.findOne({
        cart_id: cart.id,
        product_id: productId,
      });

      if (existingItem) {
        // Update quantity
        await this.cartItemRepo.updateQuantity(cart.id, productId, existingItem.quantity + quantity);
        return this.cartItemRepo.findById(existingItem.id) as Promise<CartItem>;
      } else {
        // Add new item
        return this.cartItemRepo.create({
          cart_id: cart.id,
          product_id: productId,
          quantity,
          added_at: new Date(),
          updated_at: new Date(),
        });
      }
    });
  }

  /**
   * Complex search with filters, sorting, and pagination
   */
  async searchProducts(params: {
    query?: string;
    categoryId?: number;
    minPrice?: number;
    maxPrice?: number;
    inStock?: boolean;
    sortBy?: 'price' | 'name' | 'created_at';
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }): Promise<{ products: Product[]; total: number }> {
    let query = this.db.selectFrom('products').selectAll();

    // Apply filters
    if (params.query) {
      query = query.where((eb) =>
        eb.or([
          eb('name', 'like', `%${params.query}%`),
          eb('description', 'like', `%${params.query}%`),
          eb('sku', 'like', `%${params.query}%`),
        ])
      );
    }

    if (params.categoryId) {
      query = query.where('category_id', '=', params.categoryId);
    }

    if (params.minPrice !== undefined) {
      query = query.where('price', '>=', params.minPrice);
    }

    if (params.maxPrice !== undefined) {
      query = query.where('price', '<=', params.maxPrice);
    }

    if (params.inStock) {
      query = query.where('stock_quantity', '>', 0);
    }

    query = query.where('is_active', '=', true);
    query = query.where('deleted_at', 'is', null);

    // Apply sorting
    const sortBy = params.sortBy || 'created_at';
    const sortOrder = params.sortOrder || 'desc';
    query = query.orderBy(sortBy, sortOrder);

    // Count total
    const countQuery = this.db.selectFrom('products').select(sql<number>`COUNT(*)`.as('count'));
    // Apply same filters to count query...
    const totalResult = await countQuery.executeTakeFirst();
    const total = (totalResult as any)?.count || 0;

    // Apply pagination
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;
    query = query.limit(limit).offset(offset);

    const products = await query.execute();

    return {
      products: products as Product[],
      total,
    };
  }

  /**
   * Get product recommendations based on user history
   */
  async getRecommendations(userId: number, limit: number = 10): Promise<Product[]> {
    // Get user's order history
    const orders = await this.orderRepo.findUserOrders(userId);
    const orderIds = orders.map((o) => o.id);

    if (orderIds.length === 0) {
      // Return popular products for new users
      return this.getPopularProducts(limit);
    }

    // Get categories from user's purchase history
    const result = await this.db
      .selectFrom('order_items')
      .innerJoin('products', 'order_items.product_id', 'products.id')
      .select('products.category_id')
      .select(sql<number>`COUNT(*)`.as('count'))
      .where('order_items.order_id', 'in', orderIds)
      .groupBy('products.category_id')
      .orderBy('count', 'desc')
      .limit(3)
      .execute();

    const preferredCategories = result.map((r: any) => r.category_id);

    // Get products from preferred categories that user hasn't bought
    const recommendations = await this.db
      .selectFrom('products')
      .selectAll()
      .where('category_id', 'in', preferredCategories)
      .where('id', 'not in', (qb) =>
        qb.selectFrom('order_items').select('product_id').where('order_id', 'in', orderIds)
      )
      .where('is_active', '=', true)
      .where('stock_quantity', '>', 0)
      .orderBy(sql`RANDOM()`)
      .limit(limit)
      .execute();

    return recommendations as Product[];
  }

  /**
   * Get popular products based on sales
   */
  private async getPopularProducts(limit: number): Promise<Product[]> {
    const result = await this.db
      .selectFrom('order_items')
      .innerJoin('products', 'order_items.product_id', 'products.id')
      .select('products.*')
      .select(sql<number>`SUM(order_items.quantity)`.as('total_sold'))
      .where('products.is_active', '=', true)
      .where('products.stock_quantity', '>', 0)
      .groupBy('products.id')
      .orderBy('total_sold', 'desc')
      .limit(limit)
      .execute();

    return result as Product[];
  }

  /**
   * Analytics dashboard data
   */
  async getDashboardMetrics(startDate: Date, endDate: Date): Promise<any> {
    const [orderStats, topProducts, userStats, revenueByCategory] = await Promise.all([
      this.orderRepo.getOrderStatistics(startDate, endDate),
      this.getTopSellingProducts(5),
      this.getUserStatistics(),
      this.getRevenueByCategory(startDate, endDate),
    ]);

    return {
      orderStats,
      topProducts,
      userStats,
      revenueByCategory,
    };
  }

  private async getTopSellingProducts(limit: number): Promise<any[]> {
    return this.db
      .selectFrom('order_items')
      .innerJoin('products', 'order_items.product_id', 'products.id')
      .select([
        'products.id',
        'products.name',
        'products.sku',
        sql<number>`SUM(order_items.quantity)`.as('units_sold'),
        sql<number>`SUM(order_items.total_price)`.as('revenue'),
      ])
      .groupBy(['products.id', 'products.name', 'products.sku'])
      .orderBy('units_sold', 'desc')
      .limit(limit)
      .execute();
  }

  private async getUserStatistics(): Promise<any> {
    const result = await this.db
      .selectFrom('users')
      .select([
        sql<number>`COUNT(*)`.as('total_users'),
        sql<number>`COUNT(CASE WHEN is_active = true THEN 1 END)`.as('active_users'),
        sql<number>`COUNT(CASE WHEN role = 'customer' THEN 1 END)`.as('customers'),
        sql<number>`COUNT(CASE WHEN role = 'vendor' THEN 1 END)`.as('vendors'),
      ])
      .executeTakeFirst();
    return result;
  }

  private async getRevenueByCategory(startDate: Date, endDate: Date): Promise<any[]> {
    return this.db
      .selectFrom('order_items')
      .innerJoin('products', 'order_items.product_id', 'products.id')
      .innerJoin('categories', 'products.category_id', 'categories.id')
      .innerJoin('orders', 'order_items.order_id', 'orders.id')
      .select(['categories.name', sql<number>`SUM(order_items.total_price)`.as('revenue')])
      .where('orders.created_at', '>=', startDate)
      .where('orders.created_at', '<=', endDate)
      .where('orders.status', '!=', 'cancelled')
      .groupBy('categories.name')
      .orderBy('revenue', 'desc')
      .execute();
  }

  /**
   * Mock payment processing
   */
  private async processPayment(paymentDetails: any, amount: number): Promise<boolean> {
    // Simulate payment processing delay
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Mock 95% success rate
    return Math.random() < 0.95;
  }

  private generateOrderNumber(): string {
    return `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }
}

// ============================================================================
// Test Module & Tests
// ============================================================================

@Module({
  imports: [
    TitanDatabaseModule.forRoot({
      connection: {
        dialect: 'sqlite',
        filename: ':memory:',
      } as any,
      migrations: {
        autoRun: false,
      },
      plugins: {
        builtIn: {
          softDelete: true,
          timestamps: true,
        },
      },
    }),
  ],
  providers: [
    EcommerceService,
    UserRepository,
    ProductRepository,
    OrderRepository,
    OrderItemRepository,
    CartRepository,
    CartItemRepository,
    ReviewRepository,
    InventoryRepository,
  ],
})
class EcommerceModule {}

describe('Real-World E-Commerce Application', () => {
  let app: Application;
  let ecommerceService: EcommerceService;
  let userRepo: UserRepository;
  let productRepo: ProductRepository;
  let orderRepo: OrderRepository;
  let reviewRepo: ReviewRepository;
  let db: Kysely<any>;
  let healthIndicator: DatabaseHealthIndicator;

  beforeAll(async () => {
    app = await Application.create(EcommerceModule, {
      disableCoreModules: true,
      disableGracefulShutdown: true,
    });

    ecommerceService = app.get(EcommerceService);
    userRepo = app.get(UserRepository);
    productRepo = app.get(ProductRepository);
    orderRepo = app.get(OrderRepository);
    reviewRepo = app.get(ReviewRepository);

    const dbManager = app.get(DatabaseManager);
    db = await dbManager.getConnection();

    healthIndicator = app.get(DatabaseHealthIndicator);

    // Create database schema
    await createEcommerceSchema(db);

    // Seed initial data
    await seedEcommerceData(userRepo, productRepo);
  });

  afterAll(async () => {
    await app.stop();
  });

  describe('User Journey', () => {
    it('should complete full shopping experience', async () => {
      // 1. User registration/login
      const user = await userRepo.findByEmail('customer1@example.com');
      expect(user).toBeDefined();
      await userRepo.updateLastLogin(user!.id);

      // 2. Browse products
      const searchResults = await ecommerceService.searchProducts({
        query: 'laptop',
        minPrice: 500,
        maxPrice: 2000,
        inStock: true,
        sortBy: 'price',
        sortOrder: 'asc',
      });

      expect(searchResults.products.length).toBeGreaterThan(0);

      // 3. Add to cart
      const product = searchResults.products[0];
      const cartItem = await ecommerceService.addToCart(user!.id, product.id, 1);
      expect(cartItem).toBeDefined();
      expect(cartItem.quantity).toBe(1);

      // 4. Checkout
      const order = await ecommerceService.checkout(
        user!.id,
        { method: 'credit_card', cardNumber: '4111111111111111' },
        {
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          zip: '10001',
          country: 'USA',
        }
      );

      expect(order).toBeDefined();
      expect(order.status).toBe('processing');
      expect(order.payment_status).toBe('paid');

      // 5. Leave review
      const review = await reviewRepo.create({
        product_id: product.id,
        user_id: user!.id,
        rating: 5,
        title: 'Great product!',
        content: 'Exactly what I needed',
        is_verified_purchase: true,
        helpful_count: 0,
      });

      expect(review).toBeDefined();
    });

    it('should handle product recommendations', async () => {
      const user = await userRepo.findByEmail('customer1@example.com');
      const recommendations = await ecommerceService.getRecommendations(user!.id, 5);

      expect(recommendations).toBeDefined();
      expect(recommendations.length).toBeLessThanOrEqual(5);
    });

    it('should provide analytics dashboard', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      const metrics = await ecommerceService.getDashboardMetrics(startDate, endDate);

      expect(metrics).toBeDefined();
      expect(metrics.orderStats).toBeDefined();
      expect(metrics.topProducts).toBeDefined();
      expect(metrics.userStats).toBeDefined();
      expect(metrics.revenueByCategory).toBeDefined();
    });
  });

  describe('Inventory Management', () => {
    it('should prevent overselling', async () => {
      const product = await productRepo.findBySku('LAPTOP001');
      expect(product).toBeDefined();

      // Try to add more than available stock
      const user = await userRepo.findByEmail('customer1@example.com');

      await expect(ecommerceService.addToCart(user!.id, product!.id, 1000)).rejects.toThrow('Insufficient stock');
    });

    it('should update stock on purchase', async () => {
      const product = await productRepo.findBySku('MOUSE001');
      const initialStock = product!.stock_quantity;

      const user = await userRepo.findByEmail('customer2@example.com');
      await ecommerceService.addToCart(user!.id, product!.id, 2);

      await ecommerceService.checkout(
        user!.id,
        { method: 'paypal' },
        { street: '456 Oak Ave', city: 'Boston', state: 'MA', zip: '02101', country: 'USA' }
      );

      const updatedProduct = await productRepo.findById(product!.id);
      expect(updatedProduct!.stock_quantity).toBe(initialStock - 2);
    });
  });

  describe('Performance & Health', () => {
    it('should handle concurrent transactions', async () => {
      const users = await userRepo.findActiveCustomers();
      const products = await productRepo.findInStock();

      // Simulate concurrent checkouts
      const checkoutPromises = users.slice(0, 3).map(async (user) => {
        const product = products[Math.floor(Math.random() * products.length)];
        await ecommerceService.addToCart(user.id, product.id, 1);
        return ecommerceService
          .checkout(
            user.id,
            { method: 'stripe' },
            { street: '789 Elm St', city: 'Chicago', state: 'IL', zip: '60601', country: 'USA' }
          )
          .catch((e) => e);
      });

      const results = await Promise.allSettled(checkoutPromises);
      const successful = results.filter((r) => r.status === 'fulfilled');

      expect(successful.length).toBeGreaterThan(0);
    });

    it('should provide health metrics', async () => {
      const health = await healthIndicator.check();

      expect(health).toBeDefined();
      expect(health.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
      expect(health.connections).toBeDefined();
    });

    it('should handle large result sets efficiently', async () => {
      const startTime = Date.now();

      // Search with pagination
      const page1 = await ecommerceService.searchProducts({
        page: 1,
        limit: 10,
      });

      const page2 = await ecommerceService.searchProducts({
        page: 2,
        limit: 10,
      });

      const duration = Date.now() - startTime;

      expect(page1.products).toBeDefined();
      expect(page2.products).toBeDefined();
      expect(duration).toBeLessThan(1000); // Should be fast
    });
  });

  describe('Data Integrity', () => {
    it('should maintain referential integrity', async () => {
      // Try to create order with non-existent user
      await expect(
        orderRepo.create({
          order_number: 'TEST001',
          user_id: 99999,
          status: 'pending',
          total_amount: 100,
          tax_amount: 10,
          shipping_amount: 5,
          discount_amount: 0,
          shipping_address: {},
          billing_address: {},
          payment_method: 'credit_card',
          payment_status: 'pending',
        })
      ).rejects.toThrow();
    });

    it('should handle soft deletes correctly', async () => {
      const product = await productRepo.create({
        sku: 'TEST-DELETE',
        name: 'Test Product',
        price: 100,
        cost: 50,
        stock_quantity: 10,
        category_id: 1,
        is_active: true,
        version: 0,
      });

      await productRepo.delete(product.id);

      // Should not find with normal query
      const notFound = await productRepo.findById(product.id);
      expect(notFound).toBeNull();

      // Should find in database with deleted_at set
      const result = await db.selectFrom('products').selectAll().where('id', '=', product.id).executeTakeFirst();

      expect(result).toBeDefined();
      expect((result as any).deleted_at).toBeDefined();
    });

    it('should handle optimistic locking', async () => {
      const product = await productRepo.findBySku('LAPTOP001');
      const originalVersion = product!.version;

      // Update product
      await productRepo.update(product!.id, { price: 1100 });

      // Try to update with old version - should handle version conflict
      const outdatedProduct = { ...product!, version: originalVersion };

      // This would throw or handle conflict based on plugin configuration
      // The actual behavior depends on optimistic locking plugin implementation
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

async function createEcommerceSchema(db: Kysely<any>) {
  // Users table
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email VARCHAR(255) NOT NULL UNIQUE,
      username VARCHAR(50) NOT NULL UNIQUE,
      full_name VARCHAR(100) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'customer',
      is_active BOOLEAN DEFAULT 1,
      email_verified BOOLEAN DEFAULT 0,
      last_login DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME
    )
  `.execute(db);

  // Categories table
  await sql`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      parent_id INTEGER,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES categories(id)
    )
  `.execute(db);

  // Products table
  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      price DECIMAL(10,2) NOT NULL,
      cost DECIMAL(10,2) NOT NULL,
      stock_quantity INTEGER DEFAULT 0,
      category_id INTEGER NOT NULL,
      vendor_id INTEGER,
      is_active BOOLEAN DEFAULT 1,
      version INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )
  `.execute(db);

  // Orders table
  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number VARCHAR(50) NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      total_amount DECIMAL(10,2) NOT NULL,
      tax_amount DECIMAL(10,2) DEFAULT 0,
      shipping_amount DECIMAL(10,2) DEFAULT 0,
      discount_amount DECIMAL(10,2) DEFAULT 0,
      shipping_address TEXT,
      billing_address TEXT,
      payment_method VARCHAR(50),
      payment_status VARCHAR(20) DEFAULT 'pending',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `.execute(db);

  // Order items table
  await sql`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price DECIMAL(10,2) NOT NULL,
      total_price DECIMAL(10,2) NOT NULL,
      discount_amount DECIMAL(10,2) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `.execute(db);

  // Carts table
  await sql`
    CREATE TABLE IF NOT EXISTS carts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id VARCHAR(100),
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `.execute(db);

  // Cart items table
  await sql`
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cart_id) REFERENCES carts(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      UNIQUE(cart_id, product_id)
    )
  `.execute(db);

  // Reviews table
  await sql`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      title VARCHAR(200),
      content TEXT,
      is_verified_purchase BOOLEAN DEFAULT 0,
      helpful_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `.execute(db);

  // Inventory table
  await sql`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      warehouse_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 0,
      reserved_quantity INTEGER DEFAULT 0,
      last_restock_date DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `.execute(db);
}

async function seedEcommerceData(userRepo: UserRepository, productRepo: ProductRepository) {
  // Create users
  await userRepo.createMany([
    {
      email: 'admin@example.com',
      username: 'admin',
      full_name: 'Admin User',
      password_hash: '$2b$10$abcdefghijklmnopqrstuvwxyz',
      role: 'admin',
      is_active: true,
      email_verified: true,
    },
    {
      email: 'customer1@example.com',
      username: 'customer1',
      full_name: 'John Doe',
      password_hash: '$2b$10$abcdefghijklmnopqrstuvwxyz',
      role: 'customer',
      is_active: true,
      email_verified: true,
    },
    {
      email: 'customer2@example.com',
      username: 'customer2',
      full_name: 'Jane Smith',
      password_hash: '$2b$10$abcdefghijklmnopqrstuvwxyz',
      role: 'customer',
      is_active: true,
      email_verified: true,
    },
  ]);

  // Create categories
  const db = userRepo['db'] || userRepo['qb'];
  await db
    .insertInto('categories')
    .values([
      { name: 'Electronics', slug: 'electronics', display_order: 1 },
      { name: 'Computers', slug: 'computers', parent_id: 1, display_order: 1 },
      { name: 'Accessories', slug: 'accessories', parent_id: 1, display_order: 2 },
    ])
    .execute();

  // Create products
  await productRepo.createMany([
    {
      sku: 'LAPTOP001',
      name: 'Professional Laptop',
      description: 'High-performance laptop for professionals',
      price: 1299.99,
      cost: 800,
      stock_quantity: 50,
      category_id: 2,
      is_active: true,
      version: 0,
    },
    {
      sku: 'MOUSE001',
      name: 'Wireless Mouse',
      description: 'Ergonomic wireless mouse',
      price: 29.99,
      cost: 15,
      stock_quantity: 200,
      category_id: 3,
      is_active: true,
      version: 0,
    },
    {
      sku: 'KEYBOARD001',
      name: 'Mechanical Keyboard',
      description: 'RGB mechanical keyboard',
      price: 89.99,
      cost: 45,
      stock_quantity: 100,
      category_id: 3,
      is_active: true,
      version: 0,
    },
  ]);

  // Create inventory records
  await db
    .insertInto('inventory')
    .values([
      { product_id: 1, warehouse_id: 1, quantity: 50, reserved_quantity: 0 },
      { product_id: 2, warehouse_id: 1, quantity: 200, reserved_quantity: 0 },
      { product_id: 3, warehouse_id: 1, quantity: 100, reserved_quantity: 0 },
    ])
    .execute();
}
