/**
 * Example Titan Application with Database Module
 *
 * Demonstrates how to use the database module with repositories in a real application
 */

import { Application } from '../../../application.js';
import { Module, Injectable } from '../../../decorators/index.js';
import { TitanDatabaseModule } from '../database.module.js';
import { InjectRepository, Transactional } from '../database.decorators.js';
import { RepositoryFactory } from '../repository/repository.factory.js';
import { UserRepository } from './user.repository.js';
import { ProductRepository, ProductCategory, ProductStatus } from './product.repository.js';
import { OrderRepository, OrderStatus } from './order.repository.js';
import type { CreateUserInput, User } from './user.repository.js';
import type { CreateProductInput, Product } from './product.repository.js';
import type { CreateOrderInput, OrderWithItems } from './order.repository.js';

/**
 * User Service
 */
@Injectable()
export class UserService {
  constructor(@InjectRepository(UserRepository) private userRepo: UserRepository) {}

  async registerUser(input: CreateUserInput): Promise<User> {
    // Check if email is available
    const emailAvailable = await this.userRepo.isEmailAvailable(input.email);
    if (!emailAvailable) {
      throw new Error('Email already in use');
    }

    // Check if username is available
    const usernameAvailable = await this.userRepo.isUsernameAvailable(input.username);
    if (!usernameAvailable) {
      throw new Error('Username already taken');
    }

    // Hash password (simplified for example)
    const hashedPassword = `hashed_${input.password}`;

    // Create user
    return this.userRepo.create({
      ...input,
      password: hashedPassword,
    });
  }

  async authenticateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userRepo.findByEmail(email);
    if (!user) return null;

    // Check password (simplified)
    const hashedPassword = `hashed_${password}`;
    if (user.password !== hashedPassword) return null;

    // Update last login
    await this.userRepo.updateLastLogin(user.id);

    return user;
  }

  async searchUsers(query: string, page: number = 1): Promise<any> {
    return this.userRepo.findPaginated({
      search: query,
      page,
      limit: 20,
      isActive: true,
    });
  }
}

/**
 * Product Service
 */
@Injectable()
export class ProductService {
  constructor(@InjectRepository(ProductRepository) private productRepo: ProductRepository) {}

  async createProduct(input: CreateProductInput): Promise<Product> {
    // Check if SKU is unique
    const existing = await this.productRepo.findBySku(input.sku);
    if (existing) {
      throw new Error('SKU already exists');
    }

    return this.productRepo.create(input);
  }

  async updateInventory(
    productId: number,
    quantity: number,
    type: 'in' | 'out' | 'adjustment',
    reason: string
  ): Promise<Product> {
    return this.productRepo.updateStock(productId, quantity, type, reason);
  }

  async searchProducts(query: string, filters?: any): Promise<any> {
    return this.productRepo.searchProducts({
      query,
      ...filters,
      page: filters?.page || 1,
      limit: filters?.limit || 20,
    });
  }

  async getLowStockAlert(): Promise<Product[]> {
    return this.productRepo.findLowStockProducts();
  }

  async publishProducts(productIds: number[]): Promise<void> {
    await this.productRepo.publishProducts(productIds);
  }
}

/**
 * Order Service with Transactional Methods
 */
@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(OrderRepository) private orderRepo: OrderRepository,
    @InjectRepository(ProductRepository) private productRepo: ProductRepository,
    private repositoryFactory: RepositoryFactory
  ) {}

  /**
   * Place an order (uses transaction)
   */
  @Transactional()
  async placeOrder(input: CreateOrderInput): Promise<OrderWithItems> {
    // Create order with items (already uses transaction internally)
    const order = await this.orderRepo.createOrder(input);

    // Send order confirmation email (would be async in real app)
    console.log(`Order ${order.orderNumber} placed successfully`);

    return order;
  }

  /**
   * Process order fulfillment
   */
  async fulfillOrder(orderId: number): Promise<void> {
    const order = await this.orderRepo.findWithItems(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    if (order.status !== OrderStatus.CONFIRMED) {
      throw new Error('Order must be confirmed before fulfillment');
    }

    // Update order status to processing
    await this.orderRepo.updateOrderStatus(orderId, OrderStatus.PROCESSING);

    // Check inventory for all items
    for (const item of order.items) {
      const product = await this.productRepo.findById(item.productId);
      if (!product || product.stock < item.quantity) {
        throw new Error(`Insufficient stock for product ${item.sku}`);
      }
    }

    // Mark as shipped
    await this.orderRepo.updateOrderStatus(orderId, OrderStatus.SHIPPED);
  }

  /**
   * Cancel order with inventory restoration
   */
  @Transactional()
  async cancelOrder(orderId: number, reason: string): Promise<void> {
    // Use transaction scope for consistency
    await this.repositoryFactory.createTransactionScope(async (scope) => {
      const orderRepo = scope.getRepository<OrderRepository>(OrderRepository);
      const productRepo = scope.getRepository<ProductRepository>(ProductRepository);

      const order = await orderRepo.findWithItems(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      if (order.status === OrderStatus.DELIVERED) {
        throw new Error('Cannot cancel delivered order');
      }

      // Restore inventory
      for (const item of order.items) {
        await productRepo.updateStock(
          item.productId,
          item.quantity,
          'in',
          `Order ${order.orderNumber} cancelled: ${reason}`
        );
      }

      // Update order status
      await orderRepo.updateOrderStatus(orderId, OrderStatus.CANCELLED);
    });
  }

  async getOrderHistory(customerId: number): Promise<any> {
    return this.orderRepo.findByCustomer(customerId);
  }

  async getDashboardStats(startDate: Date, endDate: Date): Promise<any> {
    const [orderStats, topCustomers, bestProducts] = await Promise.all([
      this.orderRepo.getOrderStatistics(startDate, endDate),
      this.orderRepo.getTopCustomers(5),
      this.orderRepo.getBestSellingProducts(10),
    ]);

    return {
      orders: orderStats,
      topCustomers,
      bestSellingProducts: bestProducts,
    };
  }
}

/**
 * E-commerce Module
 */
@Module({
  imports: [TitanDatabaseModule.forFeature([UserRepository, ProductRepository, OrderRepository])],
  providers: [UserService, ProductService, OrderService],
  exports: [UserService, ProductService, OrderService],
})
export class EcommerceModule {}

/**
 * Example Application
 */
async function main() {
  // Create application
  const app = await Application.create({
    imports: [
      // Configure database module
      TitanDatabaseModule.forRoot({
        connection: {
          dialect: 'postgres',
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432'),
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD || 'postgres',
          database: process.env.DB_NAME || 'ecommerce',
        },
        poolConfig: {
          min: 2,
          max: 10,
        },
        kysera: {
          repository: {
            defaultOptions: {
              softDelete: true,
              timestamps: true,
              audit: false,
            },
          },
        },
        autoMigrate: true,
        healthCheck: true,
        isGlobal: true,
      }),

      // Import business module
      EcommerceModule,
    ],
  });

  // Start application
  await app.start();

  // Get services
  const userService = await app.get(UserService);
  const productService = await app.get(ProductService);
  const orderService = await app.get(OrderService);

  // Example usage
  try {
    // Register a user
    const user = await userService.registerUser({
      email: 'john@example.com',
      username: 'johndoe',
      password: 'securePassword123',
      firstName: 'John',
      lastName: 'Doe',
    });
    console.log('User registered:', user);

    // Create products
    const product1 = await productService.createProduct({
      sku: 'LAPTOP-001',
      name: 'Gaming Laptop',
      description: 'High-performance gaming laptop',
      category: ProductCategory.ELECTRONICS,
      price: 1299.99,
      cost: 800,
      stock: 50,
    });

    const product2 = await productService.createProduct({
      sku: 'MOUSE-001',
      name: 'Gaming Mouse',
      description: 'RGB gaming mouse',
      category: ProductCategory.ELECTRONICS,
      price: 79.99,
      cost: 30,
      stock: 100,
    });

    // Publish products
    await productService.publishProducts([product1.id, product2.id]);

    // Place an order
    const order = await orderService.placeOrder({
      customerId: user.id,
      items: [
        { productId: product1.id, quantity: 1 },
        { productId: product2.id, quantity: 2 },
      ],
      shippingAddress: {
        street: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94102',
        country: 'USA',
      },
      notes: 'Please deliver to front desk',
    });
    console.log('Order placed:', order.orderNumber);

    // Get dashboard stats
    const stats = await orderService.getDashboardStats(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      new Date()
    );
    console.log('Dashboard stats:', stats);
  } catch (error) {
    console.error('Error:', error);
  }

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down application...');
    await app.stop();
    process.exit(0);
  });
}

// Run the application
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main };
