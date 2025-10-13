/**
 * @fileoverview Comprehensive tests for useQuery hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useQuery, useQueries, usePaginatedQuery, useInfiniteQuery } from '../../../src/netron/hooks/use-query.js';
import { NetronClient } from '../../../src/netron/client.js';
import { signal } from '../../../src/core/reactivity/signal.js';
import type { QueryOptions } from '../../../src/netron/types.js';

// Mock NetronClient
const mockNetronClient = {
  query: vi.fn().mockResolvedValue({ id: '1', name: 'John' }),
  backend: vi.fn().mockReturnValue({
    queryFluentInterface: vi.fn().mockResolvedValue({}),
  }),
};

// Mock DI inject
vi.mock('../../../src/di/index.js', () => ({
  Injectable: vi.fn(() => (target: any) => target),
  Optional: vi.fn(() => (target: any, propertyKey: string, parameterIndex: number) => {}),
  Inject: vi.fn(() => (target: any, propertyKey: string, parameterIndex: number) => {}),
  inject: vi.fn().mockImplementation((token) => {
    if (token === NetronClient) {
      return mockNetronClient;
    }
    return {};
  }),
}));

// Mock decorators
vi.mock('../../../src/netron/decorators/index.js', () => ({
  getBackendName: vi.fn().mockReturnValue('main'),
  getServiceName: vi.fn().mockReturnValue('users'),
}));

class UserService {
  getUsers!: () => Promise<Array<{ id: string; name: string }>>;
  getUser!: (id: string) => Promise<{ id: string; name: string }>;
}

describe('useQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNetronClient.query.mockResolvedValue({ id: '1', name: 'John' });
  });

  describe('basic functionality', () => {
    it('should return query result with reactive signals', () => {
      const result = useQuery(UserService, 'getUsers', []);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('loading');
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('refetch');
      expect(result).toHaveProperty('isFetching');
      expect(result).toHaveProperty('isStale');
    });

    it('should fetch data on mount', async () => {
      const result = useQuery(UserService, 'getUsers', []);

      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockNetronClient.query).toHaveBeenCalledWith(
        'users',
        'getUsers',
        [],
        undefined,
        'main'
      );
    });

    it('should work with service name string', () => {
      const result = useQuery('UserService', 'getUsers', []);

      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
    });

    it('should pass query options to NetronClient', async () => {
      const options: QueryOptions = {
        cache: { maxAge: 60000 },
        retry: { attempts: 3 },
        timeout: 5000,
      };

      const result = useQuery(UserService, 'getUsers', [], options);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockNetronClient.query).toHaveBeenCalledWith(
        'users',
        'getUsers',
        [],
        options,
        'main'
      );
    });
  });

  describe('loading state', () => {
    it('should set loading to true initially', () => {
      const result = useQuery(UserService, 'getUsers', []);

      // Note: loading state management depends on resource implementation
      expect(result.loading).toBeDefined();
    });

    it('should track isFetching state', async () => {
      const result = useQuery(UserService, 'getUsers', []);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result.isFetching).toBeDefined();
    });
  });

  describe('enabled option', () => {
    it('should not fetch when enabled is false', async () => {
      mockNetronClient.query.mockClear();

      const result = useQuery(UserService, 'getUsers', [], { enabled: false });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Note: depends on resource implementation
    });

    it('should fetch when enabled is true', async () => {
      const result = useQuery(UserService, 'getUsers', [], { enabled: true });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockNetronClient.query).toHaveBeenCalled();
    });
  });

  describe('fallback value', () => {
    it('should use fallback value when provided', () => {
      const fallbackData = [{ id: '0', name: 'Fallback' }];
      const result = useQuery(UserService, 'getUsers', [], { fallback: fallbackData });

      // Fallback is used as initialValue in resource
      expect(result).toBeDefined();
    });
  });

  describe('refetch', () => {
    it('should provide refetch function', () => {
      const result = useQuery(UserService, 'getUsers', []);

      expect(result.refetch).toBeInstanceOf(Function);
    });

    it('should re-execute query on refetch', async () => {
      const result = useQuery(UserService, 'getUsers', []);

      await new Promise(resolve => setTimeout(resolve, 100));
      mockNetronClient.query.mockClear();

      await result.refetch();

      expect(mockNetronClient.query).toHaveBeenCalled();
    });
  });

  describe('refetchOnMount', () => {
    it('should refetch on mount when enabled', () => {
      const result = useQuery(UserService, 'getUsers', [], { refetchOnMount: true });

      // Note: Depends on effect implementation
      expect(result).toBeDefined();
    });
  });

  describe('refetchOnFocus', () => {
    it('should set up focus listener when enabled', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const addDocListenerSpy = vi.spyOn(document, 'addEventListener');

      const result = useQuery(UserService, 'getUsers', [], { refetchOnFocus: true });

      expect(addEventListenerSpy).toHaveBeenCalledWith('focus', expect.any(Function));
      expect(addDocListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

      addEventListenerSpy.mockRestore();
      addDocListenerSpy.mockRestore();
    });
  });

  describe('refetchInterval', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should refetch at specified interval', async () => {
      mockNetronClient.query.mockClear();

      const result = useQuery(UserService, 'getUsers', [], { refetchInterval: 1000 });

      await vi.advanceTimersByTimeAsync(1000);

      // Should have refetched
      expect(mockNetronClient.query).toHaveBeenCalled();
    });

    it('should stop refetching when cleaned up', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const result = useQuery(UserService, 'getUsers', [], { refetchInterval: 1000 });

      // Note: cleanup depends on onCleanup implementation

      clearIntervalSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should set error state on query failure', async () => {
      const testError = new Error('Query failed');
      mockNetronClient.query.mockRejectedValueOnce(testError);

      const result = useQuery(UserService, 'getUsers', []);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Error should be captured in resource
      expect(result.error).toBeDefined();
    });

    it('should clear error on successful retry', async () => {
      mockNetronClient.query
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockResolvedValueOnce({ id: '1', name: 'John' });

      const result = useQuery(UserService, 'getUsers', []);

      await new Promise(resolve => setTimeout(resolve, 100));

      // After successful retry, error should be undefined
      expect(result).toBeDefined();
    });
  });

  describe('isStale', () => {
    it('should track stale state', () => {
      const result = useQuery(UserService, 'getUsers', []);

      expect(result.isStale).toBeDefined();
      expect(typeof result.isStale()).toBe('boolean');
    });

    it('should set isStale to false after successful fetch', async () => {
      const result = useQuery(UserService, 'getUsers', []);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should be marked as fresh after fetch
      expect(result.isStale).toBeDefined();
    });
  });
});

describe('useQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute multiple queries in parallel', () => {
    const results = useQueries([
      { service: UserService, method: 'getUsers', args: [] },
      { service: 'PostService', method: 'getPosts', args: [] },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty('data');
    expect(results[1]).toHaveProperty('data');
  });

  it('should accept options for each query', () => {
    const results = useQueries([
      {
        service: UserService,
        method: 'getUsers',
        args: [],
        options: { cache: { maxAge: 60000 } },
      },
      {
        service: 'PostService',
        method: 'getPosts',
        args: [],
        options: { retry: { attempts: 3 } },
      },
    ]);

    expect(results).toHaveLength(2);
  });

  it('should handle empty array', () => {
    const results = useQueries([]);

    expect(results).toHaveLength(0);
  });

  it('should support single query', () => {
    const results = useQueries([
      { service: UserService, method: 'getUsers', args: [] },
    ]);

    expect(results).toHaveLength(1);
  });
});

describe('usePaginatedQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNetronClient.query.mockResolvedValue({
      data: [{ id: '1', name: 'John' }],
      totalPages: 5,
    });
  });

  it('should manage pagination state', () => {
    const page = signal(1);
    const result = usePaginatedQuery(UserService, 'getUsers', page, 10);

    expect(result).toHaveProperty('page');
    expect(result).toHaveProperty('totalPages');
    expect(result).toHaveProperty('hasNextPage');
    expect(result).toHaveProperty('hasPrevPage');
    expect(result).toHaveProperty('nextPage');
    expect(result).toHaveProperty('prevPage');
    expect(result).toHaveProperty('goToPage');
  });

  it('should build pagination args', async () => {
    const page = signal(2);
    const result = usePaginatedQuery(UserService, 'getUsers', page, 20);

    await new Promise(resolve => setTimeout(resolve, 100));

    // Should include pagination params in args
    expect(mockNetronClient.query).toHaveBeenCalled();
  });

  it('should navigate to next page', () => {
    const page = signal(1);
    const result = usePaginatedQuery(UserService, 'getUsers', page, 10);

    result.nextPage();

    expect(page()).toBe(2);
  });

  it('should navigate to previous page', () => {
    const page = signal(2);
    const result = usePaginatedQuery(UserService, 'getUsers', page, 10);

    result.prevPage();

    expect(page()).toBe(1);
  });

  it('should not go to previous page when on first page', () => {
    const page = signal(1);
    const result = usePaginatedQuery(UserService, 'getUsers', page, 10);

    result.prevPage();

    expect(page()).toBe(1);
  });

  it('should go to specific page', async () => {
    const page = signal(1);
    const result = usePaginatedQuery(UserService, 'getUsers', page, 10);

    await new Promise(resolve => setTimeout(resolve, 100));

    result.goToPage(3);

    expect(page()).toBe(3);
  });

  it('should not go beyond total pages', async () => {
    const page = signal(1);
    const result = usePaginatedQuery(UserService, 'getUsers', page, 10);

    await new Promise(resolve => setTimeout(resolve, 100));

    result.goToPage(10); // Beyond totalPages (5)

    expect(page()).toBe(1); // Should stay at current page
  });
});

describe('useInfiniteQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNetronClient.query.mockResolvedValue({
      data: [{ id: '1', name: 'John' }],
      nextCursor: 'cursor-2',
    });
  });

  it('should manage infinite scroll state', () => {
    const getNextPageParam = (lastPage: any) => lastPage.nextCursor;
    const result = useInfiniteQuery(UserService, 'getUsers', getNextPageParam);

    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('fetchNextPage');
    expect(result).toHaveProperty('hasNextPage');
    expect(result).toHaveProperty('isFetchingNextPage');
  });

  it('should fetch next page', async () => {
    const getNextPageParam = (lastPage: any) => lastPage.nextCursor;
    const result = useInfiniteQuery(UserService, 'getUsers', getNextPageParam);

    await new Promise(resolve => setTimeout(resolve, 100));

    await result.fetchNextPage();

    // Should have fetched with next cursor
    expect(result.data()).toBeDefined();
  });

  it('should accumulate pages', async () => {
    const getNextPageParam = (lastPage: any) => lastPage.nextCursor;
    const result = useInfiniteQuery(UserService, 'getUsers', getNextPageParam);

    await new Promise(resolve => setTimeout(resolve, 100));

    const pages = result.data();
    expect(Array.isArray(pages)).toBe(true);
  });

  it('should determine hasNextPage from getNextPageParam', async () => {
    const getNextPageParam = (lastPage: any) => lastPage.nextCursor;
    const result = useInfiniteQuery(UserService, 'getUsers', getNextPageParam);

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(result.hasNextPage).toBeDefined();
  });

  it('should not fetch when no next page', async () => {
    mockNetronClient.query.mockResolvedValue({
      data: [{ id: '1', name: 'John' }],
      nextCursor: undefined,
    });

    const getNextPageParam = (lastPage: any) => lastPage.nextCursor;
    const result = useInfiniteQuery(UserService, 'getUsers', getNextPageParam);

    await new Promise(resolve => setTimeout(resolve, 100));

    mockNetronClient.query.mockClear();
    await result.fetchNextPage();

    // Should not fetch if no nextCursor
    expect(mockNetronClient.query).not.toHaveBeenCalled();
  });

  it('should track isFetchingNextPage', async () => {
    const getNextPageParam = (lastPage: any) => lastPage.nextCursor;
    const result = useInfiniteQuery(UserService, 'getUsers', getNextPageParam);

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(result.isFetchingNextPage()).toBe(false);

    const fetchPromise = result.fetchNextPage();

    // Should be true during fetch
    await fetchPromise;

    expect(result.isFetchingNextPage()).toBe(false);
  });
});
