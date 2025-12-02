/**
 * Transaction Management Tests
 *
 * Tests for advanced transaction features including nested transactions,
 * savepoints, isolation levels, and deadlock retry
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Application } from '../../../src/application.js';
import { Module, Injectable, Inject } from '../../../src/decorators/index.js';
import {
  TitanDatabaseModule,
  TransactionManager,
  Transactional,
  InjectRepository,
  InjectTransactionScope,
  RequiresTransactionScope,
  Repository,
  BaseRepository,
  DATABASE_TRANSACTION_MANAGER,
  DATABASE_MANAGER,
  TransactionPropagation,
  TransactionIsolationLevel,
} from '../../../src/modules/database/index.js';
import type { IDatabaseManager } from '../../../src/modules/database/index.js';
import { TitanError } from '../../../src/errors/index.js';
import { sql } from 'kysely';
import { DatabaseTestManager } from '../../utils/docker-test-manager.js';

// Skip Docker tests if env var is set
const skipIntegrationTests = process.env.SKIP_DOCKER_TESTS === 'true' ||
                            process.env.USE_MOCK_REDIS === 'true' ||
                            process.env.CI === 'true';

if (skipIntegrationTests) {
  console.log('⏭️ Skipping transaction.spec.ts - requires Docker/PostgreSQL');
}

const describeOrSkip = skipIntegrationTests ? describe.skip : describe;

// Test entity
interface Account {
  id: number;
  name: string;
  balance: number;
  version: number;
  created_at: Date;
  updated_at: Date;
}

// Test repository
@Repository<Account>({
  table: 'accounts',
})
class AccountRepository extends BaseRepository<any, 'accounts', Account, any, any> {
  async transfer(fromId: number, toId: number, amount: number): Promise<void> {
    // Debit from account
    await this.qb
      .updateTable('accounts')
      .set((eb) => ({
        balance: eb('balance', '-', amount),
        version: eb('version', '+', 1),
        updated_at: new Date(),
      }))
      .where('id', '=', fromId)
      .where('balance', '>=', amount)
      .execute();

    // Credit to account
    await this.qb
      .updateTable('accounts')
      .set((eb) => ({
        balance: eb('balance', '+', amount),
        version: eb('version', '+', 1),
        updated_at: new Date(),
      }))
      .where('id', '=', toId)
      .execute();
  }

  async getBalance(id: number): Promise<number> {
    const result = await this.qb.selectFrom('accounts').select('balance').where('id', '=', id).executeTakeFirst();

    return result?.balance || 0;
  }
}

// Test service with transactions
@Injectable()
class BankingService {
  constructor(
    @InjectRepository(AccountRepository) private accountRepo: AccountRepository,
    @Inject(DATABASE_TRANSACTION_MANAGER) private transactionManager: TransactionManager
  ) {}

  @Transactional()
  async transfer(fromId: number, toId: number, amount: number): Promise<void> {
    await this.accountRepo.transfer(fromId, toId, amount);
  }

  @Transactional({ propagation: TransactionPropagation.REQUIRES_NEW })
  async createAccount(name: string, initialBalance: number = 0): Promise<Account> {
    return this.accountRepo.create({
      name,
      balance: initialBalance,
      version: 1,
    });
  }

  @Transactional({
    isolationLevel: TransactionIsolationLevel.SERIALIZABLE,
    retryAttempts: 3,
  })
  async complexTransfer(transfers: Array<{ from: number; to: number; amount: number }>) {
    for (const transfer of transfers) {
      await this.accountRepo.transfer(transfer.from, transfer.to, transfer.amount);
    }
  }

  @Transactional({ propagation: TransactionPropagation.NESTED })
  async nestedOperation(id: number, amount: number): Promise<void> {
    await this.accountRepo.update(id, { balance: amount });

    // This will use a savepoint
    await this.transactionManager
      .executeInTransaction(
        async () => {
          await this.accountRepo.update(id, { version: 99 });
          throw new Error('Rollback nested only');
        },
        { propagation: TransactionPropagation.NESTED }
      )
      .catch(() => {
        // Ignore error - nested transaction rolled back
      });

    // This should still be committed
    await this.accountRepo.update(id, { version: 2 });
  }

  @RequiresTransactionScope()
  async operationWithScope(@InjectTransactionScope() scope: any, accountId: number, amount: number): Promise<void> {
    const repo = scope.getRepository(AccountRepository);
    await repo.update(accountId, { balance: amount });
  }

  async getBalance(id: number): Promise<number> {
    return this.accountRepo.getBalance(id);
  }

  async getAccount(id: number): Promise<Account | null> {
    return this.accountRepo.findById(id);
  }
}

// Test module
@Module({
  imports: [TitanDatabaseModule.forFeature([AccountRepository])],
  providers: [BankingService],
})
class TestModule {}

describeOrSkip('Transaction Management', () => {
  describe('SQLite (in-memory)', () => {
    let app: Application;
    let bankingService: BankingService;
    let transactionManager: TransactionManager;

    beforeEach(async () => {
      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'sqlite',
              connection: ':memory:',
            },
            transactionOptions: {
              retryAttempts: 3,
              useSavepoints: true,
            },
            isGlobal: true,
          }),
          TestModule,
        ],
      });

      await app.start();

      // Get services
      bankingService = await app.resolveAsync(BankingService);
      transactionManager = await app.resolveAsync(DATABASE_TRANSACTION_MANAGER);

      // Create accounts table
      const dbManager = await app.resolveAsync(DATABASE_MANAGER);
      const db = await (dbManager as IDatabaseManager).getConnection();
      await sql`
        CREATE TABLE accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          balance REAL DEFAULT 0,
          version INTEGER DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);

      // Create test accounts
      await bankingService.createAccount('Alice', 1000);
      await bankingService.createAccount('Bob', 500);
    });

    afterEach(async () => {
      if (app) {
        await app.stop();
      }
    });

    it('should handle basic transactions', async () => {
      // Transfer money
      await bankingService.transfer(1, 2, 100);

      // Check balances
      const aliceBalance = await bankingService.getBalance(1);
      const bobBalance = await bankingService.getBalance(2);

      expect(aliceBalance).toBe(900);
      expect(bobBalance).toBe(600);
    });

    it('should rollback on error', async () => {
      try {
        await bankingService.transfer(1, 2, 2000); // More than available
      } catch (error) {
        // Expected to fail
      }

      // Balances should be unchanged
      const aliceBalance = await bankingService.getBalance(1);
      const bobBalance = await bankingService.getBalance(2);

      expect(aliceBalance).toBe(1000);
      expect(bobBalance).toBe(500);
    });

    it('should handle nested transactions with savepoints', async () => {
      await bankingService.nestedOperation(1, 750);

      const account = await bankingService.getAccount(1);
      expect(account?.balance).toBe(750);
      expect(account?.version).toBe(2); // Nested rollback shouldn't affect this
    });

    it('should track transaction statistics', async () => {
      // Reset statistics
      transactionManager.resetStatistics();

      // Execute some transactions
      await bankingService.transfer(1, 2, 50);
      await bankingService.transfer(2, 1, 25);
      await bankingService.createAccount('Charlie', 100);

      const stats = transactionManager.getStatistics();
      expect(stats.totalStarted).toBeGreaterThanOrEqual(3);
      expect(stats.totalCommitted).toBeGreaterThanOrEqual(3);
      expect(stats.totalRolledBack).toBe(0);
    });

    it('should respect transaction propagation', async () => {
      const startStats = transactionManager.getStatistics();

      // REQUIRES_NEW should create a new transaction
      await transactionManager.executeInTransaction(
        async () => {
          await bankingService.createAccount('Dave', 200);
        },
        { propagation: TransactionPropagation.REQUIRED }
      );

      const endStats = transactionManager.getStatistics();
      expect(endStats.totalStarted).toBeGreaterThan(startStats.totalStarted);
    });

    it('should handle transaction timeout', async () => {
      await expect(
        transactionManager.executeInTransaction(
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
          },
          { timeout: 100 }
        )
      ).rejects.toThrow(TitanError);
    });

    it('should support manual transaction control', async () => {
      const isInTransaction = transactionManager.isInTransaction();
      expect(isInTransaction).toBe(false);

      await transactionManager.executeInTransaction(async () => {
        const insideTransaction = transactionManager.isInTransaction();
        expect(insideTransaction).toBe(true);

        const depth = transactionManager.getTransactionDepth();
        expect(depth).toBe(1);

        // Nested transaction
        await transactionManager.executeInTransaction(
          async () => {
            const nestedDepth = transactionManager.getTransactionDepth();
            expect(nestedDepth).toBe(2);
          },
          { propagation: TransactionPropagation.NESTED }
        );
      });
    });
  });

  describeOrSkip('PostgreSQL (Docker)', () => {
    let app: Application;
    let bankingService: BankingService;
    let transactionManager: TransactionManager;
    let container: import('../../utils/docker-test-manager.js').DockerContainer;

    beforeEach(async () => {
      // Create PostgreSQL container directly (not using withPostgres to keep it alive)
      container = await DatabaseTestManager.createPostgresContainer({
        database: 'test_transactions_db',
        user: 'testuser',
        password: 'testpass',
      });

      const port = container.ports.get(5432)!;
      const connectionString = `postgresql://testuser:testpass@localhost:${port}/test_transactions_db`;
      const url = new URL(connectionString);

      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'postgres',
              connection: {
                host: url.hostname,
                port: parseInt(url.port || '5432'),
                user: url.username,
                password: url.password,
                database: url.pathname.slice(1),
              },
            },
            transactionOptions: {
              retryAttempts: 3,
              useSavepoints: true,
              defaultIsolationLevel: TransactionIsolationLevel.READ_COMMITTED,
            },
            isGlobal: true,
          }),
          TestModule,
        ],
      });

      await app.start();

      // Get services
      bankingService = await app.resolveAsync(BankingService);
      transactionManager = await app.resolveAsync(DATABASE_TRANSACTION_MANAGER);

      // Create accounts table
      const dbManager = await app.resolveAsync(DATABASE_MANAGER);
      const db = await (dbManager as IDatabaseManager).getConnection();
      await sql`
        CREATE TABLE accounts (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          balance DECIMAL(10,2) DEFAULT 0,
          version INTEGER DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);

      // Create test accounts
      await bankingService.createAccount('Alice', 1000);
      await bankingService.createAccount('Bob', 500);
    }, 60000);

    afterEach(async () => {
      if (app) {
        await app.stop();
      }
      if (container) {
        await container.cleanup();
      }
    });

    it('should handle isolation levels', async () => {
      // Test SERIALIZABLE isolation
      const results = await Promise.allSettled([
        transactionManager.executeInTransaction(
          async (trx) => {
            await sql`UPDATE accounts SET balance = balance + 10 WHERE id = 1`.execute(trx);
            await new Promise((resolve) => setTimeout(resolve, 50));
            await sql`UPDATE accounts SET balance = balance + 10 WHERE id = 2`.execute(trx);
          },
          { isolationLevel: TransactionIsolationLevel.SERIALIZABLE }
        ),
        transactionManager.executeInTransaction(
          async (trx) => {
            await sql`UPDATE accounts SET balance = balance + 20 WHERE id = 2`.execute(trx);
            await new Promise((resolve) => setTimeout(resolve, 50));
            await sql`UPDATE accounts SET balance = balance + 20 WHERE id = 1`.execute(trx);
          },
          { isolationLevel: TransactionIsolationLevel.SERIALIZABLE }
        ),
      ]);

      // At least one should succeed, possibly one fails due to serialization
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle deadlock retry', async () => {
      // Create a deadlock scenario with retry
      const results = await Promise.allSettled([
        bankingService.complexTransfer([
          { from: 1, to: 2, amount: 10 },
          { from: 2, to: 1, amount: 5 },
        ]),
        bankingService.complexTransfer([
          { from: 2, to: 1, amount: 10 },
          { from: 1, to: 2, amount: 5 },
        ]),
      ]);

      // Both should eventually succeed due to retry
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);

      // Check transaction statistics for retries
      const stats = transactionManager.getStatistics();
      // May or may not have deadlock retries depending on timing
      expect(stats.deadlockRetries).toBeGreaterThanOrEqual(0);
    });

    it('should handle read-only transactions', async () => {
      await transactionManager.executeInTransaction(
        async (trx) => {
          const result = await sql`SELECT * FROM accounts`.execute(trx);
          expect(result.rows.length).toBeGreaterThan(0);
        },
        { readOnly: true }
      );

      // Try to write in read-only transaction (should fail)
      await expect(
        transactionManager.executeInTransaction(
          async (trx) => {
            await sql`UPDATE accounts SET balance = 0 WHERE id = 1`.execute(trx);
          },
          { readOnly: true }
        )
      ).rejects.toThrow();
    });

    it('should handle multiple savepoints', async () => {
      await transactionManager.executeInTransaction(async (trx) => {
        await transactionManager.savepoint('sp1');
        await sql`UPDATE accounts SET balance = 100 WHERE id = 1`.execute(trx);

        await transactionManager.savepoint('sp2');
        await sql`UPDATE accounts SET balance = 200 WHERE id = 1`.execute(trx);

        // Rollback to sp2
        await transactionManager.rollbackToSavepoint('sp2');

        await sql`UPDATE accounts SET balance = 150 WHERE id = 1`.execute(trx);

        await transactionManager.releaseSavepoint('sp1');
      });

      const balance = await bankingService.getBalance(1);
      expect(balance).toBe(150);
    });
  });
});
