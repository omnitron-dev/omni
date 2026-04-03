/**
 * Test Assertions and Fixtures
 *
 * Custom assertion utilities and fixture management for tests
 */

/**
 * Assert that a promise rejects with a specific error
 *
 * Verifies that a promise rejects and optionally checks the error message
 * or error type.
 *
 * @param promise - The promise that should reject
 * @param expectedError - Optional error matcher (string, regex, or Error class)
 * @throws Error if the promise resolves or error doesn't match
 *
 * @example
 * ```typescript
 * // Assert rejection with any error
 * await assertRejects(Promise.reject(new Error('fail')));
 *
 * // Assert rejection with specific message substring
 * await assertRejects(
 *   Promise.reject(new Error('File not found')),
 *   'not found'
 * );
 *
 * // Assert rejection with regex pattern
 * await assertRejects(
 *   Promise.reject(new Error('Invalid input: 123')),
 *   /Invalid input:/
 * );
 *
 * // Assert rejection with specific error type
 * await assertRejects(
 *   Promise.reject(new TypeError('wrong type')),
 *   TypeError
 * );
 * ```
 */
export async function assertRejects(
  promise: Promise<any>,
  expectedError?: string | RegExp | typeof Error
): Promise<void> {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (error: any) {
    if (expectedError) {
      if (typeof expectedError === 'string') {
        if (!error.message.includes(expectedError)) {
          throw new Error(`Expected error to include "${expectedError}", got: ${error.message}`, { cause: error });
        }
      } else if (expectedError instanceof RegExp) {
        if (!expectedError.test(error.message)) {
          throw new Error(`Expected error to match ${expectedError}, got: ${error.message}`, { cause: error });
        }
      } else if (typeof expectedError === 'function') {
        if (!(error instanceof expectedError)) {
          throw new Error(`Expected error to be instance of ${expectedError.name}`, { cause: error });
        }
      }
    }
  }
}

/**
 * Test fixture interface
 *
 * Defines the structure for a test fixture with setup and optional teardown.
 *
 * @template T - The type of the fixture instance
 *
 * @example
 * ```typescript
 * interface DatabaseFixture {
 *   connection: Connection;
 *   cleanup: () => Promise<void>;
 * }
 *
 * const dbFixture: TestFixture<DatabaseFixture> = {
 *   setup: async () => {
 *     const connection = await createConnection();
 *     return {
 *       connection,
 *       cleanup: async () => await connection.close()
 *     };
 *   },
 *   teardown: async (fixture) => {
 *     await fixture.cleanup();
 *   }
 * };
 * ```
 */
export interface TestFixture<T> {
  /**
   * Setup function that creates the fixture instance
   */
  setup: () => T | Promise<T>;

  /**
   * Optional teardown function that cleans up the fixture
   */
  teardown?: (fixture: T) => void | Promise<void>;
}

/**
 * Execute a test with a fixture
 *
 * Manages the lifecycle of a test fixture by calling setup before the test
 * and teardown after the test, ensuring cleanup even if the test fails.
 *
 * @template T - The type of the fixture instance
 * @template R - The return type of the test function
 * @param fixture - The test fixture configuration
 * @param fn - The test function to execute with the fixture
 * @returns The result of the test function
 *
 * @example
 * ```typescript
 * const tempDirFixture: TestFixture<string> = {
 *   setup: () => createTempDir('test-'),
 *   teardown: (dir) => cleanupTempDir(dir)
 * };
 *
 * it('should use temp directory', async () => {
 *   await withFixture(tempDirFixture, async (tmpDir) => {
 *     // Use tmpDir...
 *     const file = path.join(tmpDir, 'test.txt');
 *     await fs.promises.writeFile(file, 'content');
 *     // Cleanup happens automatically
 *   });
 * });
 * ```
 *
 * @example
 * ```typescript
 * const dbFixture: TestFixture<Database> = {
 *   setup: async () => {
 *     const db = await Database.connect();
 *     await db.migrate();
 *     return db;
 *   },
 *   teardown: async (db) => {
 *     await db.rollback();
 *     await db.disconnect();
 *   }
 * };
 *
 * it('should interact with database', async () => {
 *   await withFixture(dbFixture, async (db) => {
 *     const user = await db.users.create({ name: 'Test' });
 *     expect(user.id).toBeDefined();
 *     // Teardown runs even if expect fails
 *   });
 * });
 * ```
 */
export async function withFixture<T, R>(fixture: TestFixture<T>, fn: (fixture: T) => R | Promise<R>): Promise<R> {
  const instance = await fixture.setup();
  try {
    return await fn(instance);
  } finally {
    if (fixture.teardown) {
      await fixture.teardown(instance);
    }
  }
}
