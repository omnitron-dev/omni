/**
 * Database Module Tests
 *
 * Tests for the Titan Database Module with Docker containers
 */

import { Application } from '../../../src/application.js';
import {
  TitanDatabaseModule,
  DATABASE_SERVICE,
  DATABASE_HEALTH_INDICATOR,
  DatabaseService,
  DatabaseHealthIndicator,
} from '../../../src/modules/database/index.js';
import { sql } from 'kysely';
import { DatabaseTestManager } from '../../utils/docker-test-manager.js';

describe('TitanDatabaseModule', () => {
  describe('SQLite (in-memory)', () => {
    let app: Application;
    let databaseService: DatabaseService;
    let healthIndicator: DatabaseHealthIndicator;

    beforeAll(async () => {
      // Reset static manager before suite
      await TitanDatabaseModule.resetForTesting();
      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'sqlite',
              connection: ':memory:',
            },
          }),
        ],
      });

      await app.start();

      databaseService = (await app.resolveAsync(DATABASE_SERVICE)) as DatabaseService;
      healthIndicator = (await app.resolveAsync(DATABASE_HEALTH_INDICATOR)) as DatabaseHealthIndicator;
    });

    afterAll(async () => {
      await app?.stop();
    });

    it('should initialize with SQLite in-memory', async () => {
      expect(databaseService).toBeDefined();
      expect(healthIndicator).toBeDefined();
    });

    it('should be connected', async () => {
      const isConnected = databaseService.isConnected();
      expect(isConnected).toBe(true);
    });

    it('should execute raw queries', async () => {
      // Create a test table
      await databaseService.raw('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');

      // Insert data
      await databaseService.raw('INSERT INTO users (name) VALUES (?)', ['John Doe']);

      // Query data
      const result = await databaseService.raw<{ rows: Record<string, unknown>[] }>('SELECT * FROM users');

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('John Doe');
    });

    it('should handle transactions', async () => {
      // Create test table
      await databaseService.raw('CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER)');

      // Insert initial data
      await databaseService.raw('INSERT INTO accounts (id, balance) VALUES (1, 100), (2, 50)');

      // Successful transaction
      await databaseService.transaction(async (trx) => {
        await sql.raw('UPDATE accounts SET balance = balance - 30 WHERE id = 1').execute(trx);
        await sql.raw('UPDATE accounts SET balance = balance + 30 WHERE id = 2').execute(trx);
      });

      const result = await databaseService.raw<{ rows: Record<string, unknown>[] }>('SELECT * FROM accounts ORDER BY id');

      expect(result.rows[0].balance).toBe(70);
      expect(result.rows[1].balance).toBe(80);

      // Failed transaction (should rollback)
      try {
        await databaseService.transaction(async (trx) => {
          await sql.raw('UPDATE accounts SET balance = balance - 20 WHERE id = 1').execute(trx);
          throw new Error('Transaction failed');
        });
      } catch (error) {
        // Expected error
      }

      const resultAfterRollback = await databaseService.raw<{ rows: Record<string, unknown>[] }>('SELECT * FROM accounts WHERE id = 1');

      expect(resultAfterRollback.rows[0].balance).toBe(70); // Should remain unchanged
    });

    it('should report health status', async () => {
      const health = await healthIndicator.check();

      expect(health.status).toBe('healthy');
      expect(health.connections).toHaveProperty('default');
      expect(health.connections.default.status).toBe('connected');
    });

    it('should handle multiple named connections', async () => {
      // Reset static manager for this specific test since it creates a new app
      await TitanDatabaseModule.resetForTesting();

      const multiApp = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connections: {
              main: {
                dialect: 'sqlite',
                connection: ':memory:',
              },
              analytics: {
                dialect: 'sqlite',
                connection: ':memory:',
              },
            },
          }),
        ],
      });

      await multiApp.start();

      const multiDbService = (await multiApp.resolveAsync(DATABASE_SERVICE)) as DatabaseService;

      // Test both connections
      const mainDb = await multiDbService.getConnection('main');
      const analyticsDb = await multiDbService.getConnection('analytics');

      expect(mainDb).toBeDefined();
      expect(analyticsDb).toBeDefined();

      // Check connection names
      const names = multiDbService.getConnectionNames();
      expect(names).toContain('main');
      expect(names).toContain('analytics');

      await multiApp.stop();
    });
  });

  describe('PostgreSQL (with Docker)', () => {
    let app: Application;
    let databaseService: DatabaseService;
    let connectionString: string;
    let container: import('../../utils/docker-test-manager.js').DockerContainer;

    // Skip if not in CI or Docker not available
    const skipDockerTests = process.env.SKIP_DOCKER_TESTS === 'true';
    const describeOrSkip = skipDockerTests ? describe.skip : describe;

    describeOrSkip('Docker PostgreSQL', () => {
      beforeAll(async () => {
        // Reset static manager before suite
        await TitanDatabaseModule.resetForTesting();
        // Create PostgreSQL container directly (not using withPostgres to avoid early cleanup)
        container = await DatabaseTestManager.createPostgresContainer({
          database: 'testdb',
          user: 'testuser',
          password: 'testpass',
        });

        const port = container.ports.get(5432)!;
        connectionString = `postgresql://testuser:testpass@localhost:${port}/testdb`;

        app = await Application.create({
          imports: [
            TitanDatabaseModule.forRoot({
              connection: {
                dialect: 'postgres',
                connection: connectionString,
              },
            }),
          ],
        });

        await app.start();

        databaseService = (await app.resolveAsync(DATABASE_SERVICE)) as DatabaseService;
      }, 60000);

      afterAll(async () => {
        await app?.stop();
        await container?.cleanup();
      });

      it('should connect to PostgreSQL', async () => {
        const isConnected = databaseService.isConnected();
        expect(isConnected).toBe(true);
      });

      it('should execute PostgreSQL queries', async () => {
        // Create table
        await databaseService.raw(`
          CREATE TABLE products (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            price DECIMAL(10, 2)
          )
        `);

        // Insert data
        await databaseService.raw('INSERT INTO products (name, price) VALUES ($1, $2)', ['Widget', 19.99]);

        // Query data
        const result = await databaseService.raw<{ rows: Record<string, unknown>[] }>('SELECT * FROM products');

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].name).toBe('Widget');
        expect(parseFloat(result.rows[0].price)).toBe(19.99);
      });

      it('should handle PostgreSQL specific features', async () => {
        // Test RETURNING clause
        await databaseService.raw(`
          CREATE TABLE items (
            id SERIAL PRIMARY KEY,
            name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        const result = await databaseService.raw<{ rows: Record<string, unknown>[] }>('INSERT INTO items (name) VALUES ($1) RETURNING *', [
          'Test Item',
        ]);

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].id).toBeDefined();
        expect(result.rows[0].name).toBe('Test Item');
        expect(result.rows[0].created_at).toBeDefined();
      });
    });
  });

  describe('MySQL (with Docker)', () => {
    let app: Application;
    let databaseService: DatabaseService;
    let connectionString: string;
    let container: import('../../utils/docker-test-manager.js').DockerContainer;

    // Skip if not in CI or Docker not available
    const skipDockerTests = process.env.SKIP_DOCKER_TESTS === 'true';
    const describeOrSkip = skipDockerTests ? describe.skip : describe;

    describeOrSkip('Docker MySQL', () => {
      beforeAll(async () => {
        // Reset static manager before suite
        await TitanDatabaseModule.resetForTesting();
        // Create MySQL container directly (not using withMySQL to avoid early cleanup)
        container = await DatabaseTestManager.createMySQLContainer({
          database: 'testdb',
          user: 'testuser',
          password: 'testpass',
          rootPassword: 'rootpass',
        });

        const port = container.ports.get(3306)!;
        connectionString = `mysql://testuser:testpass@localhost:${port}/testdb`;

        // Wait a bit for MySQL to fully initialize
        await new Promise((resolve) => setTimeout(resolve, 2000));

        app = await Application.create({
          imports: [
            TitanDatabaseModule.forRoot({
              connection: {
                dialect: 'mysql',
                connection: connectionString,
              },
            }),
          ],
        });

        await app.start();

        databaseService = (await app.resolveAsync(DATABASE_SERVICE)) as DatabaseService;
      }, 60000);

      afterAll(async () => {
        await app?.stop();
        await container?.cleanup();
      });

      it('should connect to MySQL', async () => {
        const isConnected = databaseService.isConnected();
        expect(isConnected).toBe(true);
      });

      it('should execute MySQL queries', async () => {
        // Create table
        await databaseService.raw(`
          CREATE TABLE orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            customer_name VARCHAR(255) NOT NULL,
            total DECIMAL(10, 2)
          )
        `);

        // Insert data
        await databaseService.raw('INSERT INTO orders (customer_name, total) VALUES (?, ?)', ['Alice', 99.99]);

        // Query data
        const result = await databaseService.raw<{ rows: Record<string, unknown>[] }>('SELECT * FROM orders');

        expect(result).toBeDefined();
        // MySQL returns array directly, not { rows: [...] }
        const rows = Array.isArray(result) ? result : (result as any).rows || result;
        expect(rows).toHaveLength(1);
        expect(rows[0].customer_name).toBe('Alice');
      });
    });
  });
});
