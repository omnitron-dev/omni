/**
 * Mock for @kysera/core package
 * Provides simple implementations for testing
 */

export class DatabaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public detail?: string
  ) {
    super(message);
    this.name = 'DatabaseError';
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      detail: this.detail,
    };
  }
}

export class UniqueConstraintError extends DatabaseError {
  constructor(
    public constraint: string,
    public table: string,
    public columns?: string[]
  ) {
    super(`UNIQUE constraint violation on ${table}`, 'UNIQUE_VIOLATION');
    this.name = 'UniqueConstraintError';
  }
}

export class ForeignKeyError extends DatabaseError {
  constructor(
    public constraint: string,
    public table: string,
    public referencedTable?: string
  ) {
    super('FOREIGN KEY constraint violation', 'FOREIGN_KEY_VIOLATION');
    this.name = 'ForeignKeyError';
  }
}

export class NotFoundError extends DatabaseError {
  constructor(entity: string, criteria?: unknown) {
    const message = `${entity} not found`;
    const detail = criteria ? JSON.stringify(criteria) : undefined;
    super(message, 'NOT_FOUND', detail);
    this.name = 'NotFoundError';
  }
}

export function parseDatabaseError(error: any, dialect: string = 'sqlite'): DatabaseError {
  if (!error || typeof error !== 'object') {
    return new DatabaseError('Unknown database error', 'UNKNOWN');
  }

  // Simple implementation - just wrap the error
  if (error.message?.includes('UNIQUE constraint')) {
    return new UniqueConstraintError('unique', 'unknown', []);
  }

  if (error.message?.includes('FOREIGN KEY constraint')) {
    return new ForeignKeyError('foreign_key', 'unknown');
  }

  return new DatabaseError(error.message || 'Database error', error.code || 'UNKNOWN');
}

// Simple pagination mock
export async function paginate(qb: any, options: any) {
  const { page = 1, limit = 10 } = options;
  const offset = (page - 1) * limit;

  const query = qb.limit(limit).offset(offset);
  const data = await query.execute();

  return {
    data,
    pagination: {
      total: data.length,
      page,
      limit,
      totalPages: Math.ceil(data.length / limit),
    },
  };
}

export async function paginateCursor(qb: any, options: any) {
  const { cursor, limit = 10 } = options;

  const data = await qb.limit(limit + 1).execute();
  const hasMore = data.length > limit;

  if (hasMore) {
    data.pop();
  }

  return {
    data,
    pagination: {
      nextCursor: hasMore ? String(data[data.length - 1]?.id) : null,
      prevCursor: cursor || null,
      hasMore,
    },
  };
}

export type PaginationOptions = {
  page?: number;
  limit?: number;
};

export type PaginatedResult<T> = {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

export type CursorOptions = {
  cursor?: string;
  limit?: number;
};
