/**
 * Comprehensive Transaction Tests
 *
 * Tests all transaction functionality including isolation levels,
 * nested transactions, deadlock handling, and edge cases
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';

const skipIntegrationTests = process.env.SKIP_DOCKER_TESTS === 'true' ||
                            process.env.USE_MOCK_REDIS === 'true' ||
                            process.env.CI === 'true';

if (skipIntegrationTests) {
  console.log('⏭️ Skipping comprehensive-transaction.spec.ts - requires Docker/PostgreSQL');
}

const describeDocker = skipIntegrationTests ? describe.skip : describe;

import { Application } from '../../../src/application.js';
import { Module, Injectable, Inject } from '../../../src/decorators/index.js';
import { Kysely, sql, Transaction } from 'kysely';
import {
  InjectConnection,
  InjectRepository,
  Repository,
  BaseRepository,
  Transactional,
  TransactionManager,
  TransactionIsolationLevel,
  TransactionPropagation,
  DatabaseTestingModule,
  DatabaseTestingService,
  DATABASE_TRANSACTION_MANAGER,
} from '../../../src/modules/database/index.js';
import { DatabaseTestManager, DockerContainer } from '../../utils/docker-test-manager.js';

// Test entities
interface Account {
  id: number;
  account_number: string;
  balance: number;
  currency: string;
  is_locked: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface Transaction {
  id: number;
  from_account_id: number;
  to_account_id: number;
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  error_message?: string;
  created_at: Date;
}

interface AuditLog {
  id: number;
  entity_type: string;
  entity_id: number;
  action: string;
  changes: any;
  user_id?: number;
  created_at: Date;
}

// Repositories
@Repository<Account>({
  table: 'accounts',
  timestamps: true,
})
class AccountRepository extends BaseRepository<any, 'accounts', Account, Partial<Account>, Partial<Account>> {
  async findByAccountNumber(accountNumber: string): Promise<Account | null> {
    return this.findOne({ account_number: accountNumber });
  }

  async updateBalance(id: number, amount: number): Promise<Account> {
    const db = await this.getDb();
    const result = await db
      .updateTable('accounts')
      .set((eb: any) => ({
        balance: eb('balance', '+', amount),
        version: eb('version', '+', 1),
        updated_at: new Date(),
      }))
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return result as Account;
  }

  async lockAccount(id: number): Promise<void> {
    await this.update(id, { is_locked: true });
  }

  async unlockAccount(id: number): Promise<void> {
    await this.update(id, { is_locked: false });
  }

  async getForUpdate(id: number, trx: Transaction<any>): Promise<Account | null> {
    const result = await trx.selectFrom('accounts').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    return result as Account | null;
  }

  private async getDb() {
    return (this as any).qb || (this as any).db;
  }
}

@Repository<Transaction>({
  table: 'transactions',
})
class TransactionRepository extends BaseRepository<
  any,
  'transactions',
  Transaction,
  Partial<Transaction>,
  Partial<Transaction>
> {
  async findPending(): Promise<Transaction[]> {
    return this.findAll({ where: { status: 'pending' } });
  }

  async markCompleted(id: number): Promise<void> {
    await this.update(id, { status: 'completed' });
  }

  async markFailed(id: number, error: string): Promise<void> {
    await this.update(id, {
      status: 'failed',
      error_message: error,
    });
  }
}

@Repository<AuditLog>({
  table: 'audit_logs',
})
class AuditLogRepository extends BaseRepository<any, 'audit_logs', AuditLog, Partial<AuditLog>, Partial<AuditLog>> {
  async logAction(data: Partial<AuditLog>): Promise<AuditLog> {
    return this.create({
      ...data,
      created_at: new Date(),
    });
  }
}

// Banking service with complex transaction scenarios
@Injectable()
class BankingService {
  constructor(
    @InjectRepository(AccountRepository) private accountRepo: AccountRepository,
    @InjectRepository(TransactionRepository) private transactionRepo: TransactionRepository,
    @InjectRepository(AuditLogRepository) private auditRepo: AuditLogRepository,
    @Inject(DATABASE_TRANSACTION_MANAGER) private txManager: TransactionManager,
    @InjectConnection() private db: Kysely<any>
  ) {}

  /**
   * Transfer funds between accounts using manual transaction management
   */
  async transferFunds(fromAccountId: number, toAccountId: number, amount: number): Promise<Transaction> {
    return this.txManager.executeInTransaction(
      async (trx) => {
        // Get accounts with row lock
        const fromAccount = await this.accountRepo.getForUpdate(fromAccountId, trx);
        const toAccount = await this.accountRepo.getForUpdate(toAccountId, trx);

        if (!fromAccount || !toAccount) {
          throw new Error('Account not found');
        }

        if (fromAccount.is_locked || toAccount.is_locked) {
          throw new Error('Account is locked');
        }

        if (fromAccount.balance < amount) {
          throw new Error('Insufficient funds');
        }

        // Create transaction record
        const transaction = await this.transactionRepo.create({
          from_account_id: fromAccountId,
          to_account_id: toAccountId,
          amount,
          status: 'pending',
          created_at: new Date(),
        });

        // Update balances
        await this.accountRepo.updateBalance(fromAccountId, -amount);
        await this.accountRepo.updateBalance(toAccountId, amount);

        // Mark transaction as completed
        await this.transactionRepo.markCompleted(transaction.id);

        // Audit log
        await this.auditRepo.logAction({
          entity_type: 'transaction',
          entity_id: transaction.id,
          action: 'transfer',
          changes: { from: fromAccountId, to: toAccountId, amount },
        });

        return transaction;
      },
      {
        isolation: TransactionIsolationLevel.REPEATABLE_READ,
      }
    );
  }

  /**
   * Transfer using decorator-based transaction
   */
  @Transactional({
    isolation: TransactionIsolationLevel.SERIALIZABLE,
  })
  async secureTransfer(fromAccountNumber: string, toAccountNumber: string, amount: number): Promise<Transaction> {
    const fromAccount = await this.accountRepo.findByAccountNumber(fromAccountNumber);
    const toAccount = await this.accountRepo.findByAccountNumber(toAccountNumber);

    if (!fromAccount || !toAccount) {
      throw new Error('Account not found');
    }

    return this.transferFunds(fromAccount.id, toAccount.id, amount);
  }

  /**
   * Batch transfer with nested transaction
   */
  async batchTransfer(transfers: Array<{ from: number; to: number; amount: number }>) {
    return this.txManager.executeInTransaction(async (trx) => {
      const results = [];

      for (const transfer of transfers) {
        try {
          // Nested transaction with savepoint
          const result = await this.txManager.executeInTransaction(
            async () => this.transferFunds(transfer.from, transfer.to, transfer.amount),
            { propagation: TransactionPropagation.NESTED }
          );
          results.push({ success: true, transaction: result });
        } catch (error: any) {
          // Individual transfer failed, but continue with others
          results.push({ success: false, error: error.message });
        }
      }

      return results;
    });
  }

  /**
   * Complex operation with multiple transaction propagation types
   */
  @Transactional()
  async complexOperation(accountId: number): Promise<void> {
    // This runs in main transaction
    const account = await this.accountRepo.findById(accountId);
    if (!account) throw new Error('Account not found');

    // This requires a new independent transaction
    await this.txManager.executeInTransaction(
      async () => {
        await this.auditRepo.logAction({
          entity_type: 'account',
          entity_id: accountId,
          action: 'complex_operation_start',
          changes: {},
        });
      },
      { propagation: TransactionPropagation.REQUIRES_NEW }
    );

    // Simulate some complex processing
    await this.accountRepo.update(accountId, {
      version: account.version + 1,
    });

    // This runs in the same transaction
    await this.txManager.executeInTransaction(
      async () => {
        await this.auditRepo.logAction({
          entity_type: 'account',
          entity_id: accountId,
          action: 'complex_operation_end',
          changes: {},
        });
      },
      { propagation: TransactionPropagation.REQUIRED }
    );
  }

  /**
   * Deadlock simulation
   */
  async simulateDeadlock(account1Id: number, account2Id: number, reverse: boolean = false): Promise<void> {
    await this.txManager.executeInTransaction(
      async (trx) => {
        const firstId = reverse ? account2Id : account1Id;
        const secondId = reverse ? account1Id : account2Id;

        // Lock first account
        await trx.selectFrom('accounts').selectAll().where('id', '=', firstId).forUpdate().execute();

        // Small delay to increase chance of deadlock
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Try to lock second account
        await trx.selectFrom('accounts').selectAll().where('id', '=', secondId).forUpdate().execute();

        // Update both
        await trx
          .updateTable('accounts')
          .set({ version: sql`version + 1` })
          .where('id', '=', firstId)
          .execute();

        await trx
          .updateTable('accounts')
          .set({ version: sql`version + 1` })
          .where('id', '=', secondId)
          .execute();
      },
      {
        retryOnDeadlock: true,
        maxRetries: 3,
      }
    );
  }

  /**
   * Read-only transaction
   */
  @Transactional({ readOnly: true })
  async generateReport(): Promise<any> {
    const totalAccounts = await this.accountRepo.count();
    const totalBalance = await this.db
      .selectFrom('accounts')
      .select(sql<number>`SUM(balance)`.as('total'))
      .executeTakeFirst();

    const recentTransactions = await this.transactionRepo.findAll({
      limit: 10,
      orderBy: [{ column: 'created_at', direction: 'desc' }],
    });

    return {
      totalAccounts,
      totalBalance: totalBalance?.total || 0,
      recentTransactions,
    };
  }

  /**
   * Transaction with timeout
   */
  async slowOperation(accountId: number): Promise<void> {
    await this.txManager.executeInTransaction(
      async (trx) => {
        await this.accountRepo.findById(accountId);

        // Simulate slow operation
        await new Promise((resolve) => setTimeout(resolve, 2000));

        await this.accountRepo.update(accountId, { version: 1 });
      },
      {
        timeout: 1000, // Will timeout
      }
    );
  }
}

// Test module
@Module({
  imports: [
    DatabaseTestingModule.forTest({
      transactional: false, // We'll manage transactions manually
      autoClean: true,
    }),
  ],
  providers: [BankingService, AccountRepository, TransactionRepository, AuditLogRepository],
})
class TestModule {}

describe('Comprehensive Transaction Tests', () => {
  const describeSqlite = skipIntegrationTests ? describe.skip : describe;
  describeSqlite('SQLite Transaction Tests', () => {
    let app: Application;
    let testService: DatabaseTestingService;
    let bankingService: BankingService;
    let accountRepo: AccountRepository;
    let transactionRepo: TransactionRepository;
    let auditRepo: AuditLogRepository;
    let txManager: TransactionManager;
    let db: Kysely<any>;

    beforeAll(async () => {
      app = await Application.create(TestModule, {
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      testService = await app.resolveAsync(DatabaseTestingService);
      bankingService = await app.resolveAsync(BankingService);
      accountRepo = await app.resolveAsync(AccountRepository);
      transactionRepo = await app.resolveAsync(TransactionRepository);
      auditRepo = await app.resolveAsync(AuditLogRepository);
      txManager = await app.resolveAsync(DATABASE_TRANSACTION_MANAGER);

      await testService.initialize();
      db = testService.getTestConnection();

      // Create schema
      await createSchema(db);
    });

    afterAll(async () => {
      await testService.afterAll();
      await app.stop();
    });

    beforeEach(async () => {
      // Clean and seed test data
      await cleanDatabase(db);
      await seedTestData(accountRepo);
    });

    describe('Basic Transaction Operations', () => {
      it('should commit successful transactions', async () => {
        const result = await bankingService.transferFunds(1, 2, 100);

        expect(result).toBeDefined();
        expect(result.status).toBe('completed');

        // Verify balances were updated
        const account1 = await accountRepo.findById(1);
        const account2 = await accountRepo.findById(2);

        expect(account1?.balance).toBe(900); // 1000 - 100
        expect(account2?.balance).toBe(1100); // 1000 + 100
      });

      it('should rollback failed transactions', async () => {
        await expect(
          bankingService.transferFunds(1, 2, 2000) // More than balance
        ).rejects.toThrow('Insufficient funds');

        // Verify balances were not changed
        const account1 = await accountRepo.findById(1);
        const account2 = await accountRepo.findById(2);

        expect(account1?.balance).toBe(1000);
        expect(account2?.balance).toBe(1000);

        // Verify no transaction record was created
        const transactions = await transactionRepo.findAll();
        expect(transactions).toHaveLength(0);
      });

      it('should handle multiple operations in a transaction', async () => {
        await txManager.executeInTransaction(async () => {
          await accountRepo.create({
            account_number: 'ACC003',
            balance: 500,
            currency: 'USD',
            is_locked: false,
            version: 0,
          });

          await accountRepo.create({
            account_number: 'ACC004',
            balance: 500,
            currency: 'USD',
            is_locked: false,
            version: 0,
          });
        });

        const count = await accountRepo.count();
        expect(count).toBe(4); // 2 seed + 2 new
      });
    });

    describe('Transaction Isolation', () => {
      it('should respect isolation levels', async () => {
        // Note: SQLite has limited isolation level support
        // It mainly supports SERIALIZABLE
        const result = await txManager.executeInTransaction(
          async () => {
            const account = await accountRepo.findById(1);
            return account;
          },
          { isolation: TransactionIsolationLevel.READ_COMMITTED }
        );

        expect(result).toBeDefined();
      });

      it('should handle concurrent transactions', async () => {
        const promises = [];

        // Start multiple concurrent transfers
        for (let i = 0; i < 5; i++) {
          promises.push(bankingService.transferFunds(1, 2, 10).catch((e) => e));
        }

        const results = await Promise.all(promises);
        const successful = results.filter((r) => !(r instanceof Error));

        // All should succeed with proper locking
        expect(successful.length).toBe(5);

        // Verify final balances
        const account1 = await accountRepo.findById(1);
        const account2 = await accountRepo.findById(2);

        expect(account1?.balance).toBe(950); // 1000 - (10 * 5)
        expect(account2?.balance).toBe(1050); // 1000 + (10 * 5)
      });
    });

    describe('Nested Transactions', () => {
      it('should handle nested transactions with savepoints', async () => {
        const results = await bankingService.batchTransfer([
          { from: 1, to: 2, amount: 100 },
          { from: 1, to: 2, amount: 2000 }, // Will fail
          { from: 2, to: 1, amount: 50 },
        ]);

        expect(results).toHaveLength(3);
        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(false);
        expect(results[2].success).toBe(true);

        // First and third transfers should have succeeded
        const account1 = await accountRepo.findById(1);
        const account2 = await accountRepo.findById(2);

        expect(account1?.balance).toBe(950); // 1000 - 100 + 50
        expect(account2?.balance).toBe(1050); // 1000 + 100 - 50
      });

      it('should handle transaction propagation', async () => {
        await bankingService.complexOperation(1);

        // Verify audit logs were created
        const logs = await auditRepo.findAll({
          where: { entity_type: 'account', entity_id: 1 },
        });

        expect(logs.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe('Decorator-based Transactions', () => {
      it('should work with @Transactional decorator', async () => {
        const result = await bankingService.secureTransfer('ACC001', 'ACC002', 200);

        expect(result).toBeDefined();
        expect(result.status).toBe('completed');

        const account1 = await accountRepo.findByAccountNumber('ACC001');
        const account2 = await accountRepo.findByAccountNumber('ACC002');

        expect(account1?.balance).toBe(800);
        expect(account2?.balance).toBe(1200);
      });

      it('should handle read-only transactions', async () => {
        const report = await bankingService.generateReport();

        expect(report.totalAccounts).toBe(2);
        expect(report.totalBalance).toBe(2000);
        expect(report.recentTransactions).toBeDefined();

        // Verify no modifications were made
        const account1 = await accountRepo.findById(1);
        expect(account1?.balance).toBe(1000);
      });
    });

    describe('Error Handling', () => {
      it('should handle transaction timeouts', async () => {
        await expect(bankingService.slowOperation(1)).rejects.toThrow();
      });

      it('should handle constraint violations', async () => {
        await expect(
          accountRepo.create({
            account_number: 'ACC001', // Duplicate
            balance: 0,
            currency: 'USD',
            is_locked: false,
            version: 0,
          })
        ).rejects.toThrow();
      });

      it('should handle null reference errors', async () => {
        await expect(bankingService.transferFunds(999, 1, 100)).rejects.toThrow('Account not found');
      });
    });

    describe('Transaction Context', () => {
      it('should provide access to current transaction', async () => {
        await txManager.executeInTransaction(async () => {
          const currentTx = txManager.getCurrentTransactionConnection();
          expect(currentTx).toBeDefined();

          const depth = txManager.getTransactionDepth();
          expect(depth).toBe(1);
        });
      });

      it('should track transaction depth', async () => {
        await txManager.executeInTransaction(async () => {
          expect(txManager.getTransactionDepth()).toBe(1);

          await txManager.executeInTransaction(
            async () => {
              expect(txManager.getTransactionDepth()).toBe(2);

              await txManager.executeInTransaction(
                async () => {
                  expect(txManager.getTransactionDepth()).toBe(3);
                },
                { propagation: TransactionPropagation.NESTED }
              );
            },
            { propagation: TransactionPropagation.NESTED }
          );

          expect(txManager.getTransactionDepth()).toBe(1);
        });
      });
    });
  });

  describeDocker('PostgreSQL Transaction Tests', () => {
    let container: DockerContainer;
    let app: Application;
    let bankingService: BankingService;
    let accountRepo: AccountRepository;
    let txManager: TransactionManager;

    beforeAll(async () => {
      container = await DatabaseTestManager.createPostgresContainer({
        database: 'tx_test',
        user: 'test',
        password: 'test',
      });

      const port = container.ports.get(5432)!;

      @Module({
        imports: [
          DatabaseTestingModule.forTest({
            connection: {
              dialect: 'postgres',
              connection: {
                host: 'localhost',
                port,
                database: 'tx_test',
                user: 'test',
                password: 'test',
              },
            },
            transactional: false,
            autoClean: true,
          }),
        ],
        providers: [BankingService, AccountRepository, TransactionRepository, AuditLogRepository],
      })
      class PgTestModule {}

      app = await Application.create(PgTestModule, {
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      const testService = await app.resolveAsync(DatabaseTestingService);
      bankingService = await app.resolveAsync(BankingService);
      accountRepo = await app.resolveAsync(AccountRepository);
      txManager = await app.resolveAsync(DATABASE_TRANSACTION_MANAGER);

      await testService.initialize();
      const db = testService.getTestConnection();
      await createPostgresSchema(db);
    }, 60000);

    afterAll(async () => {
      await app.stop();
      await container.cleanup();
    });

    beforeEach(async () => {
      const testService = await app.resolveAsync(DatabaseTestingService);
      const db = testService.getTestConnection();
      await cleanDatabase(db);
      await seedTestData(accountRepo);
    });

    it('should handle PostgreSQL isolation levels', async () => {
      // PostgreSQL supports all isolation levels
      for (const level of [
        TransactionIsolationLevel.READ_UNCOMMITTED,
        TransactionIsolationLevel.READ_COMMITTED,
        TransactionIsolationLevel.REPEATABLE_READ,
        TransactionIsolationLevel.SERIALIZABLE,
      ]) {
        await txManager.executeInTransaction(
          async () => {
            const account = await accountRepo.findById(1);
            expect(account).toBeDefined();
          },
          { isolation: level }
        );
      }
    });

    it('should handle row-level locking', async () => {
      await txManager.executeInTransaction(async (trx) => {
        // Lock row for update
        const account = await accountRepo.getForUpdate(1, trx);
        expect(account).toBeDefined();

        // Update locked row
        await trx.updateTable('accounts').set({ balance: 1500 }).where('id', '=', 1).execute();
      });

      const updated = await accountRepo.findById(1);
      expect(updated?.balance).toBe(1500);
    });

    it('should detect and handle deadlocks', async () => {
      // Run two concurrent transactions that lock resources in opposite order
      const promise1 = bankingService.simulateDeadlock(1, 2, false);
      const promise2 = bankingService.simulateDeadlock(1, 2, true);

      // One should succeed, one might retry
      const results = await Promise.allSettled([promise1, promise2]);

      // With retry, both should eventually succeed
      const successes = results.filter((r) => r.status === 'fulfilled');
      expect(successes.length).toBeGreaterThanOrEqual(1);
    });

    it('should support advisory locks', async () => {
      await txManager.executeInTransaction(async (trx) => {
        // PostgreSQL advisory lock
        await sql`SELECT pg_advisory_lock(12345)`.execute(trx);

        // Do work with exclusive access
        await accountRepo.update(1, { version: 999 });

        // Lock is automatically released at transaction end
      });

      const account = await accountRepo.findById(1);
      expect(account?.version).toBe(999);
    });
  });
});

// Helper functions
async function createSchema(db: Kysely<any>) {
  await sql`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_number TEXT NOT NULL UNIQUE,
      balance REAL NOT NULL,
      currency TEXT NOT NULL,
      is_locked BOOLEAN DEFAULT 0,
      version INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_account_id INTEGER NOT NULL,
      to_account_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT CHECK(status IN ('pending', 'completed', 'failed')),
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_account_id) REFERENCES accounts(id),
      FOREIGN KEY (to_account_id) REFERENCES accounts(id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      changes TEXT,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);
}

async function createPostgresSchema(db: Kysely<any>) {
  await sql`
    CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY,
      account_number VARCHAR(50) NOT NULL UNIQUE,
      balance DECIMAL(15,2) NOT NULL,
      currency VARCHAR(3) NOT NULL,
      is_locked BOOLEAN DEFAULT FALSE,
      version INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      from_account_id INTEGER NOT NULL REFERENCES accounts(id),
      to_account_id INTEGER NOT NULL REFERENCES accounts(id),
      amount DECIMAL(15,2) NOT NULL,
      status VARCHAR(20) CHECK(status IN ('pending', 'completed', 'failed')),
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      entity_type VARCHAR(50) NOT NULL,
      entity_id INTEGER NOT NULL,
      action VARCHAR(50) NOT NULL,
      changes JSONB,
      user_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);
}

async function cleanDatabase(db: Kysely<any>) {
  await sql`DELETE FROM audit_logs`.execute(db).catch(() => {});
  await sql`DELETE FROM transactions`.execute(db).catch(() => {});
  await sql`DELETE FROM accounts`.execute(db).catch(() => {});
}

async function seedTestData(accountRepo: AccountRepository) {
  await accountRepo.create({
    id: 1,
    account_number: 'ACC001',
    balance: 1000,
    currency: 'USD',
    is_locked: false,
    version: 0,
  });

  await accountRepo.create({
    id: 2,
    account_number: 'ACC002',
    balance: 1000,
    currency: 'USD',
    is_locked: false,
    version: 0,
  });
}
