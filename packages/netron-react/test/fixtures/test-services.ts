/**
 * Default mock services for integration testing
 *
 * Provides pre-configured service implementations that simulate
 * common backend functionality for testing purposes.
 */

import type { ServiceDefinition, ServicesRegistry } from './mock-server.js';

// ============================================================================
// User Service
// ============================================================================

/**
 * User data structure
 */
export interface User {
  id: string;
  name: string;
  email?: string;
  role?: 'admin' | 'user' | 'guest';
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create user input
 */
export interface CreateUserInput {
  name: string;
  email?: string;
  role?: 'admin' | 'user' | 'guest';
  metadata?: Record<string, unknown>;
}

/**
 * Update user input
 */
export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: 'admin' | 'user' | 'guest';
  metadata?: Record<string, unknown>;
}

/**
 * Default users for testing
 */
const defaultUsers: User[] = [
  { id: '1', name: 'Alice', email: 'alice@example.com', role: 'admin' },
  { id: '2', name: 'Bob', email: 'bob@example.com', role: 'user' },
  { id: '3', name: 'Charlie', email: 'charlie@example.com', role: 'user' },
];

/**
 * Create a user service with in-memory storage
 */
export function createUserService(initialUsers: User[] = defaultUsers): {
  service: ServiceDefinition;
  users: User[];
  reset: () => void;
} {
  let users: User[] = [...initialUsers];
  let nextId = initialUsers.length + 1;

  const service: ServiceDefinition = {
    /**
     * Get a user by ID
     */
    getUser: (id: string) => {
      const user = users.find((u) => u.id === id);
      if (!user) {
        throw new Error(`User not found: ${id}`);
      }
      return { ...user };
    },

    /**
     * Get a user by ID (returns null if not found instead of throwing)
     */
    getUserOrNull: (id: string) => {
      const user = users.find((u) => u.id === id);
      return user ? { ...user } : null;
    },

    /**
     * List all users with optional filtering
     */
    listUsers: (options?: { role?: string; limit?: number; offset?: number }) => {
      let result = [...users];

      if (options?.role) {
        result = result.filter((u) => u.role === options.role);
      }

      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? result.length;

      return {
        users: result.slice(offset, offset + limit),
        total: result.length,
        limit,
        offset,
      };
    },

    /**
     * Create a new user
     */
    createUser: (data: CreateUserInput) => {
      const now = new Date().toISOString();
      const user: User = {
        id: String(nextId++),
        name: data.name,
        email: data.email,
        role: data.role ?? 'user',
        createdAt: now,
        updatedAt: now,
        metadata: data.metadata,
      };
      users.push(user);
      return { ...user };
    },

    /**
     * Update an existing user
     */
    updateUser: (id: string, data: UpdateUserInput) => {
      const index = users.findIndex((u) => u.id === id);
      if (index === -1) {
        throw new Error(`User not found: ${id}`);
      }

      const user = users[index];
      const updated: User = {
        ...user,
        ...data,
        updatedAt: new Date().toISOString(),
      };
      users[index] = updated;
      return { ...updated };
    },

    /**
     * Delete a user
     */
    deleteUser: (id: string) => {
      const index = users.findIndex((u) => u.id === id);
      if (index === -1) {
        throw new Error(`User not found: ${id}`);
      }

      users.splice(index, 1);
      return { deleted: true, id };
    },

    /**
     * Search users by name
     */
    searchUsers: (query: string) => {
      const lowerQuery = query.toLowerCase();
      return users.filter(
        (u) => u.name.toLowerCase().includes(lowerQuery) || u.email?.toLowerCase().includes(lowerQuery)
      );
    },

    /**
     * Get user count
     */
    getUserCount: () => users.length,

    /**
     * Check if email exists
     */
    emailExists: (email: string) => users.some((u) => u.email === email),
  };

  return {
    service,
    users,
    reset: () => {
      users = [...initialUsers];
      nextId = initialUsers.length + 1;
    },
  };
}

// ============================================================================
// Echo Service (for testing basic functionality)
// ============================================================================

/**
 * Echo service for testing basic RPC functionality
 */
export const echoService: ServiceDefinition = {
  /**
   * Echo back the input value
   */
  echo: (value: unknown) => value,

  /**
   * Echo with delay
   */
  echoDelayed: async (value: unknown, delayMs: number = 100) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return value;
  },

  /**
   * Echo multiple values
   */
  echoMany: (...values: unknown[]) => values,

  /**
   * Throw an error with the given message
   */
  throwError: (message: string) => {
    throw new Error(message);
  },

  /**
   * Throw a typed error
   */
  throwTypedError: (code: string, message: string) => {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    throw error;
  },

  /**
   * Return null
   */
  returnNull: () => null,

  /**
   * Return undefined
   */
  returnUndefined: () => undefined,

  /**
   * Return a complex object
   */
  returnComplex: () => ({
    string: 'hello',
    number: 42,
    boolean: true,
    array: [1, 2, 3],
    nested: {
      foo: 'bar',
      baz: [{ a: 1 }, { b: 2 }],
    },
    date: new Date().toISOString(),
  }),

  /**
   * Simulate slow response
   */
  slow: async (ms: number = 1000) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { waited: ms };
  },
};

// ============================================================================
// Counter Service (for testing state)
// ============================================================================

/**
 * Create a counter service with state
 */
export function createCounterService(): {
  service: ServiceDefinition;
  getValue: () => number;
  reset: () => void;
} {
  let count = 0;

  const service: ServiceDefinition = {
    /**
     * Get current count
     */
    get: () => count,

    /**
     * Increment count
     */
    increment: (amount: number = 1) => {
      count += amount;
      return count;
    },

    /**
     * Decrement count
     */
    decrement: (amount: number = 1) => {
      count -= amount;
      return count;
    },

    /**
     * Set count to specific value
     */
    set: (value: number) => {
      count = value;
      return count;
    },

    /**
     * Reset count to zero
     */
    reset: () => {
      count = 0;
      return count;
    },
  };

  return {
    service,
    getValue: () => count,
    reset: () => {
      count = 0;
    },
  };
}

// ============================================================================
// Math Service (for testing mutations)
// ============================================================================

/**
 * Math service for testing calculations
 */
export const mathService: ServiceDefinition = {
  add: (a: number, b: number) => a + b,
  subtract: (a: number, b: number) => a - b,
  multiply: (a: number, b: number) => a * b,
  divide: (a: number, b: number) => {
    if (b === 0) throw new Error('Division by zero');
    return a / b;
  },
  power: (base: number, exponent: number) => Math.pow(base, exponent),
  sqrt: (value: number) => {
    if (value < 0) throw new Error('Cannot calculate square root of negative number');
    return Math.sqrt(value);
  },
  random: (min: number = 0, max: number = 1) => Math.random() * (max - min) + min,
  sum: (...numbers: number[]) => numbers.reduce((a, b) => a + b, 0),
  average: (...numbers: number[]) => {
    if (numbers.length === 0) throw new Error('Cannot calculate average of empty array');
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  },
};

// ============================================================================
// Todo Service (for testing CRUD operations)
// ============================================================================

/**
 * Todo item structure
 */
export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
}

/**
 * Create a todo service with in-memory storage
 */
export function createTodoService(): {
  service: ServiceDefinition;
  todos: Todo[];
  reset: () => void;
} {
  let todos: Todo[] = [];
  let nextId = 1;

  const service: ServiceDefinition = {
    list: () => [...todos],

    get: (id: string) => {
      const todo = todos.find((t) => t.id === id);
      if (!todo) throw new Error(`Todo not found: ${id}`);
      return { ...todo };
    },

    create: (title: string) => {
      const todo: Todo = {
        id: String(nextId++),
        title,
        completed: false,
        createdAt: new Date().toISOString(),
      };
      todos.push(todo);
      return { ...todo };
    },

    update: (id: string, updates: Partial<Pick<Todo, 'title' | 'completed'>>) => {
      const index = todos.findIndex((t) => t.id === id);
      if (index === -1) throw new Error(`Todo not found: ${id}`);

      const todo = todos[index];
      const updated: Todo = {
        ...todo,
        ...updates,
        completedAt: updates.completed ? new Date().toISOString() : todo.completedAt,
      };
      todos[index] = updated;
      return { ...updated };
    },

    delete: (id: string) => {
      const index = todos.findIndex((t) => t.id === id);
      if (index === -1) throw new Error(`Todo not found: ${id}`);
      todos.splice(index, 1);
      return { deleted: true, id };
    },

    toggle: (id: string) => {
      const index = todos.findIndex((t) => t.id === id);
      if (index === -1) throw new Error(`Todo not found: ${id}`);

      const todo = todos[index];
      const updated: Todo = {
        ...todo,
        completed: !todo.completed,
        completedAt: !todo.completed ? new Date().toISOString() : undefined,
      };
      todos[index] = updated;
      return { ...updated };
    },

    getCompleted: () => todos.filter((t) => t.completed),

    getPending: () => todos.filter((t) => !t.completed),

    clearCompleted: () => {
      const count = todos.filter((t) => t.completed).length;
      todos = todos.filter((t) => !t.completed);
      return { cleared: count };
    },
  };

  return {
    service,
    todos,
    reset: () => {
      todos = [];
      nextId = 1;
    },
  };
}

// ============================================================================
// Default Test Services Registry
// ============================================================================

/**
 * Create the default test services registry
 *
 * Includes all standard test services with versioned names.
 */
export function createTestServices(): {
  services: ServicesRegistry;
  userService: ReturnType<typeof createUserService>;
  counterService: ReturnType<typeof createCounterService>;
  todoService: ReturnType<typeof createTodoService>;
  resetAll: () => void;
} {
  const userService = createUserService();
  const counterService = createCounterService();
  const todoService = createTodoService();

  const services: ServicesRegistry = {
    // Versioned services (standard naming)
    'user@1.0.0': userService.service,
    'echo@1.0.0': echoService,
    'counter@1.0.0': counterService.service,
    'math@1.0.0': mathService,
    'todo@1.0.0': todoService.service,

    // Unversioned aliases for convenience
    user: userService.service,
    echo: echoService,
    counter: counterService.service,
    math: mathService,
    todo: todoService.service,
  };

  return {
    services,
    userService,
    counterService,
    todoService,
    resetAll: () => {
      userService.reset();
      counterService.reset();
      todoService.reset();
    },
  };
}

/**
 * Pre-configured test services registry (singleton)
 */
export const testServices = createTestServices();
