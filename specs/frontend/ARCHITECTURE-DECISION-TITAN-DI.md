# Architecture Decision: Separate Frontend/Backend DI

## Problem

Initial specifications suggested isomorphic DI (shared between frontend and backend), which creates several issues:

1. **Overloaded Solution**: One DI system trying to solve different problems
2. **Security Concerns**: Importing backend `@Service()` decorated classes in frontend
3. **Tight Coupling**: Frontend directly depends on backend implementation details
4. **Role-Based Access**: Netron security may return partial interfaces based on roles

## Decision

**Frontend and backend have SEPARATE DI implementations**, connected via type-safe interface contracts.

### Backend DI (Titan)

```typescript
// backend/services/user.service.ts
import { Injectable } from '@omnitron-dev/titan';
import { Service, Public, Roles } from '@omnitron-dev/titan/netron';

@Injectable()
@Service('users@1.0.0')
export class UserService {
  constructor(
    private db: DatabaseService,
    private logger: LoggerService
  ) {}

  @Public()
  @Roles('user', 'admin')
  async findAll(): Promise<User[]> {
    return this.db.users.findMany();
  }

  @Public()
  @Roles('admin')
  async findAllWithRoles(): Promise<UserWithRoles[]> {
    return this.db.users.findMany({ include: { roles: true } });
  }

  // Private method - not exposed
  async deleteHard(id: string): Promise<void> {
    await this.db.users.delete({ where: { id } });
  }
}
```

### Frontend Contract Interface

```typescript
// shared/contracts/user.contract.ts
export interface IUserService {
  findAll(): Promise<User[]>;
  findAllWithRoles?(): Promise<UserWithRoles[]>; // Optional - depends on roles
}

// shared/models/user.model.ts
export interface User {
  id: string;
  name: string;
  email: string;
}

export interface UserWithRoles extends User {
  roles: Role[];
}
```

### Frontend DI (Nexus)

```typescript
// frontend/services/user-rpc.service.ts
import { injectable, inject } from 'nexus';
import { NetronClient } from 'nexus/netron';
import { IUserService } from '@/shared/contracts/user.contract';

export const UserRPCService = injectable(() => {
  const netron = inject(NetronClient);

  // Create RPC proxy from interface
  const userService = netron.createProxy<IUserService>('users@1.0.0');

  return userService;
});
```

### Usage in Components

```typescript
// frontend/components/UserList.tsx
import { defineComponent, inject, resource } from 'nexus';
import { UserRPCService } from '@/services/user-rpc.service';

export const UserList = defineComponent(() => {
  const userService = inject(UserRPCService);

  // Type-safe RPC call
  const users = resource(() => userService.findAll());

  return () => (
    <div>
      {#if users.loading}
        <Spinner />
      {:else if users.error}
        <Error message={users.error.message} />
      {:else if users()}
        <ul>
          {#each users() as user}
            <li>{user.name}</li>
          {/each}
        </ul>
      {/if}
    </div>
  );
});
```

## Benefits

1. **Clear Separation**: Each side has its own DI system suited to its needs
2. **Security**: Frontend never imports backend service implementations
3. **Flexibility**: Netron can return different interfaces based on user roles
4. **Type Safety**: Full TypeScript support via shared interfaces
5. **Testability**: Easy to mock interfaces for testing
6. **Independence**: Frontend and backend can evolve independently

## Contract-First Development

### 1. Define Interface

```typescript
// shared/contracts/product.contract.ts
export interface IProductService {
  findAll(filters?: ProductFilters): Promise<Product[]>;
  findById(id: string): Promise<Product>;
  create(data: CreateProductDTO): Promise<Product>;
  update(id: string, data: UpdateProductDTO): Promise<Product>;
  delete(id: string): Promise<void>;
}
```

### 2. Implement Backend

```typescript
// backend/services/product.service.ts
@Injectable()
@Service('products@1.0.0')
export class ProductService implements IProductService {
  @Public()
  async findAll(filters?: ProductFilters): Promise<Product[]> {
    return this.db.products.findMany({ where: filters });
  }

  @Public()
  async findById(id: string): Promise<Product> {
    const product = await this.db.products.findUnique({ where: { id } });
    if (!product) throw new NotFoundException();
    return product;
  }

  @Public()
  @Roles('admin')
  async create(data: CreateProductDTO): Promise<Product> {
    return this.db.products.create({ data });
  }

  @Public()
  @Roles('admin')
  async update(id: string, data: UpdateProductDTO): Promise<Product> {
    return this.db.products.update({ where: { id }, data });
  }

  @Public()
  @Roles('admin')
  async delete(id: string): Promise<void> {
    await this.db.products.delete({ where: { id } });
  }
}
```

### 3. Create Frontend Service

```typescript
// frontend/services/product-rpc.service.ts
export const ProductRPCService = injectable(() => {
  const netron = inject(NetronClient);
  return netron.createProxy<IProductService>('products@1.0.0');
});
```

### 4. Use in Frontend

```typescript
const ProductPage = defineComponent(() => {
  const productService = inject(ProductRPCService);
  const products = resource(() => productService.findAll());

  return () => (
    <ProductList products={products()} />
  );
});
```

## Role-Based Interface Projection

Netron can return different interface shapes based on user roles:

```typescript
// For regular user
interface IUserServiceUser {
  findAll(): Promise<User[]>;
}

// For admin (extended interface)
interface IUserServiceAdmin extends IUserServiceUser {
  findAllWithRoles(): Promise<UserWithRoles[]>;
  deleteUser(id: string): Promise<void>;
}

// Netron automatically projects based on @Roles decorators
const userService = netron.createProxy<IUserService>('users@1.0.0');

// If user is admin, all methods available
// If user is regular, only findAll() available (TypeScript error for others)
```

## Migration Path

For existing code that imports backend services:

```typescript
// ❌ OLD (direct import)
import { UserService } from '@/backend/services/user.service';
const userService = inject(UserService); // Imports backend code!

// ✅ NEW (contract-based)
import { UserRPCService } from '@/services/user-rpc.service';
const userService = inject(UserRPCService); // Only interface, RPC proxy
```

## Conclusion

This architecture provides:
- **Clean separation** between frontend and backend
- **Type safety** via shared interfaces
- **Security** via role-based projections
- **Flexibility** for each side to evolve independently
- **Standard pattern** for all service communication
