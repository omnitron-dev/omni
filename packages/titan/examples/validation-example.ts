/**
 * Complete example demonstrating the Titan validation system
 */

import { z } from 'zod';
import { Application, Module, Injectable } from '../src/index.js';
import { Contract, Validate, WithValidationOptions, contract } from '../src/decorators/validation.js';
import { ValidationEngine, ValidationMiddleware } from '../src/validation/index.js';

// Define validation schemas
const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(2).max(100),
  age: z.number().int().min(0).max(150).optional(),
  roles: z.array(z.enum(['user', 'admin', 'moderator'])).default(['user']),
});

const CreateUserInput = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z
    .string()
    .min(8)
    .regex(/^(?=.*[A-Za-z])(?=.*\d)/, 'Password must contain letters and numbers'),
  age: z.number().int().min(18).max(150).optional(),
});

// Define service contract
const UserServiceContract = contract({
  createUser: {
    input: CreateUserInput,
    output: UserSchema,
    errors: {
      409: z.object({ code: z.literal('USER_EXISTS'), email: z.string() }),
      422: z.object({ code: z.literal('VALIDATION_ERROR'), errors: z.array(z.string()) }),
    },
  },
  getUser: {
    input: z.string().uuid(),
    output: UserSchema.nullable(),
  },
  listUsers: {
    input: z.object({
      filter: z
        .object({
          role: z.enum(['user', 'admin', 'moderator']).optional(),
          search: z.string().optional(),
        })
        .optional(),
      pagination: z
        .object({
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(20),
        })
        .optional(),
    }),
    output: UserSchema,
    stream: true,
  },
  updateUser: {
    input: z.object({
      id: z.string().uuid(),
      data: UserSchema.partial().omit({ id: true }),
    }),
    output: UserSchema,
  },
});

// Extract types from contract
type CreateUserInputType = z.infer<typeof CreateUserInput>;
type UserType = z.infer<typeof UserSchema>;

/**
 * User service with validation
 */
@Injectable()
@Contract(UserServiceContract)
@WithValidationOptions({
  mode: 'strip', // Strip unknown properties
  coerce: false, // Don't coerce types
  abortEarly: false, // Collect all validation errors
})
class UserService {
  private users = new Map<string, UserType>();
  private emailIndex = new Map<string, string>();

  async createUser(input: CreateUserInputType): Promise<UserType> {
    // Input is automatically validated before method execution

    // Check if user exists
    if (this.emailIndex.has(input.email.toLowerCase())) {
      throw new Error('User with this email already exists');
    }

    // Create user
    const user: UserType = {
      id: crypto.randomUUID(),
      email: input.email.toLowerCase(),
      name: input.name,
      age: input.age,
      roles: ['user'],
    };

    // Store user
    this.users.set(user.id, user);
    this.emailIndex.set(user.email, user.id);

    // Output is automatically validated before sending response
    return user;
  }

  async getUser(id: string): Promise<UserType | null> {
    // Input validated as UUID
    return this.users.get(id) || null;
  }

  async *listUsers(input: any) {
    // Input validated once at method entry
    const { filter, pagination } = input;
    const limit = pagination?.limit || 20;
    let count = 0;

    for (const user of this.users.values()) {
      // Apply filters
      if (filter?.role && !user.roles?.includes(filter.role)) {
        continue;
      }
      if (filter?.search && !user.name.toLowerCase().includes(filter.search.toLowerCase())) {
        continue;
      }

      // Each yielded item is validated against output schema
      yield user;

      count++;
      if (count >= limit) break;
    }
  }

  @Validate({
    input: z.object({
      id: z.string().uuid(),
      data: UserSchema.partial().omit({ id: true }),
    }),
    output: UserSchema,
  })
  async updateUser(input: { id: string; data: Partial<UserType> }): Promise<UserType> {
    const user = this.users.get(input.id);
    if (!user) {
      throw new Error('User not found');
    }

    // Update user
    Object.assign(user, input.data);
    return user;
  }

  // Method without validation
  async internalMethod(data: any) {
    // No validation applied
    return data;
  }
}

/**
 * User module
 */
@Module({
  providers: [UserService],
  exports: [UserService],
})
class UserModule {}

/**
 * Example application
 */
async function main() {
  console.log('🚀 Validation Example Starting...\n');

  // Create application
  const app = await Application.create(UserModule, {
    name: 'validation-example',
    debug: true,
  });

  // Start application
  await app.start();

  // Get service
  const userService = app.resolve(UserService);

  // Apply validation middleware
  const engine = new ValidationEngine();
  const middleware = new ValidationMiddleware(engine);
  const validatedService = middleware.applyToInstance(userService);

  console.log('✅ Application started with validation\n');

  // Test valid user creation
  try {
    console.log('Creating valid user...');
    const user = await validatedService.createUser({
      email: 'john.doe@example.com',
      name: 'John Doe',
      password: 'SecurePass123',
      age: 25,
    });
    console.log('✅ User created:', user);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }

  // Test invalid user creation (bad email)
  try {
    console.log('\nTrying to create user with invalid email...');
    await validatedService.createUser({
      email: 'invalid-email',
      name: 'Jane Doe',
      password: 'SecurePass123',
    });
  } catch (error: any) {
    console.error('❌ Validation error:', error.toJSON ? error.toJSON() : error.message);
  }

  // Test invalid user creation (weak password)
  try {
    console.log('\nTrying to create user with weak password...');
    await validatedService.createUser({
      email: 'jane.doe@example.com',
      name: 'Jane Doe',
      password: 'weak', // Too short and no numbers
    });
  } catch (error: any) {
    console.error('❌ Validation error:', error.toJSON ? error.toJSON() : error.message);
  }

  // Test getting user with invalid ID
  try {
    console.log('\nTrying to get user with invalid ID...');
    await validatedService.getUser('not-a-uuid');
  } catch (error: any) {
    console.error('❌ Validation error:', error.toJSON ? error.toJSON() : error.message);
  }

  // Test listing users
  try {
    console.log('\nListing users with filter...');
    const generator = validatedService.listUsers({
      filter: { role: 'user' },
      pagination: { limit: 10 },
    });

    for await (const user of generator) {
      console.log('  -', user.name, '(', user.email, ')');
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }

  // Test update with validation
  try {
    console.log('\nUpdating user...');
    const users = Array.from((userService as any).users.values());
    if (users.length > 0) {
      const updated = await validatedService.updateUser({
        id: users[0].id,
        data: { name: 'John Updated', age: 26 },
      });
      console.log('✅ User updated:', updated);
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }

  // Stop application
  await app.stop();
  console.log('\n✅ Application stopped');
}

// Run example
main().catch(console.error);
