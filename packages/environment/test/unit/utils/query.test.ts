import { describe, expect, it } from 'vitest';
import { queryJSONPath, queryWildcard, queryXPath } from '../../../src/utils/query';

describe('Query Utilities', () => {
  // Test data fixture
  const testData = {
    database: {
      host: 'localhost',
      port: 5432,
      credentials: {
        username: 'admin',
        password: 'secret'
      },
      timeout: 30000
    },
    api: {
      host: 'api.example.com',
      port: 8080,
      timeout: 5000,
      endpoints: [
        { path: '/users', method: 'GET' },
        { path: '/posts', method: 'POST' },
        { path: '/comments', method: 'GET' }
      ]
    },
    services: [
      { name: 'auth', enabled: true, priority: 10, config: { timeout: 1000 } },
      { name: 'cache', enabled: false, priority: 5, config: { timeout: 2000 } },
      { name: 'queue', enabled: true, priority: 8, config: { timeout: 3000 } }
    ],
    databases: [
      { name: 'primary', environment: 'production', replicas: 3 },
      { name: 'secondary', environment: 'staging', replicas: 1 },
      { name: 'cache', environment: 'production', replicas: 2 }
    ]
  };

  describe('queryWildcard', () => {
    describe('Simple paths', () => {
      it('should return value for simple path', () => {
        const result = queryWildcard(testData, 'database.host');
        expect(result).toEqual(['localhost']);
      });

      it('should return value for nested path', () => {
        const result = queryWildcard(testData, 'database.credentials.username');
        expect(result).toEqual(['admin']);
      });

      it('should return empty array for non-existent path', () => {
        const result = queryWildcard(testData, 'nonexistent.path');
        expect(result).toEqual([]);
      });
    });

    describe('Single-level wildcards', () => {
      it('should match all hosts at top level', () => {
        const result = queryWildcard(testData, '*.host');
        expect(result).toHaveLength(2);
        expect(result).toContain('localhost');
        expect(result).toContain('api.example.com');
      });

      it('should match all ports', () => {
        const result = queryWildcard(testData, '*.port');
        expect(result).toHaveLength(2);
        expect(result).toContain(5432);
        expect(result).toContain(8080);
      });

      it('should match all items in nested object', () => {
        const result = queryWildcard(testData, 'database.credentials.*');
        expect(result).toHaveLength(2);
        expect(result).toContain('admin');
        expect(result).toContain('secret');
      });
    });

    describe('Recursive wildcards', () => {
      it('should match all timeouts at any level', () => {
        const result = queryWildcard(testData, '**.timeout');
        expect(result).toHaveLength(5); // database, api, 3 services config.timeout
        expect(result).toContain(30000);
        expect(result).toContain(5000);
        expect(result).toContain(1000);
        expect(result).toContain(2000);
        expect(result).toContain(3000);
      });

      it('should match property recursively from root', () => {
        const result = queryWildcard(testData, '**.enabled');
        expect(result).toHaveLength(3);
        expect(result.filter((v) => v === true)).toHaveLength(2);
        expect(result.filter((v) => v === false)).toHaveLength(1);
      });
    });

    describe('Array access', () => {
      it('should access array element by index', () => {
        const result = queryWildcard(testData, 'api.endpoints[0]');
        expect(result).toEqual([{ path: '/users', method: 'GET' }]);
      });

      it('should access nested property in array element', () => {
        const result = queryWildcard(testData, 'api.endpoints[1].path');
        expect(result).toEqual(['/posts']);
      });

      it('should return empty array for out of bounds index', () => {
        const result = queryWildcard(testData, 'api.endpoints[99]');
        expect(result).toEqual([]);
      });
    });

    describe('Array filters', () => {
      it('should support array index notation', () => {
        const result = queryWildcard(testData, 'services[0].name');
        expect(result).toEqual(['auth']);
      });

      it('should support second array element', () => {
        const result = queryWildcard(testData, 'services[1].enabled');
        expect(result).toEqual([false]);
      });

      it('should support third array element properties', () => {
        const result = queryWildcard(testData, 'services[2].priority');
        expect(result).toEqual([8]);
      });
    });

    describe('Combined patterns', () => {
      it('should combine wildcard with nested path', () => {
        const result = queryWildcard(testData, '*.credentials.username');
        expect(result).toEqual(['admin']);
      });

      it('should use recursive wildcard with property', () => {
        const result = queryWildcard(testData, '**.config.timeout');
        expect(result).toHaveLength(3);
        expect(result).toContain(1000);
        expect(result).toContain(2000);
        expect(result).toContain(3000);
      });
    });

    describe('Edge cases', () => {
      it('should handle empty object', () => {
        const result = queryWildcard({}, '*.value');
        expect(result).toEqual([]);
      });

      it('should handle null values', () => {
        const result = queryWildcard({ a: null }, 'a.b');
        expect(result).toEqual([]);
      });

      it('should handle undefined values', () => {
        const result = queryWildcard({ a: undefined }, 'a.b');
        expect(result).toEqual([]);
      });
    });
  });

  describe('queryJSONPath', () => {
    describe('Basic JSONPath queries', () => {
      it('should query with root selector', () => {
        const result = queryJSONPath(testData, '$.database.host');
        expect(result).toEqual(['localhost']);
      });

      it('should query array elements', () => {
        const result = queryJSONPath(testData, '$.api.endpoints[0]');
        expect(result).toEqual([{ path: '/users', method: 'GET' }]);
      });

      it('should query all array elements with wildcard', () => {
        const result = queryJSONPath(testData, '$.api.endpoints[*].path');
        expect(result).toHaveLength(3);
        expect(result).toContain('/users');
        expect(result).toContain('/posts');
        expect(result).toContain('/comments');
      });
    });

    describe('Recursive descent', () => {
      it('should use recursive descent for property', () => {
        const result = queryJSONPath(testData, '$..timeout');
        expect(result.length).toBeGreaterThan(0);
        expect(result).toContain(30000);
        expect(result).toContain(5000);
      });

      it('should use recursive descent for nested property', () => {
        const result = queryJSONPath(testData, '$..config.timeout');
        expect(result).toHaveLength(3);
        expect(result).toContain(1000);
        expect(result).toContain(2000);
        expect(result).toContain(3000);
      });
    });

    describe('Array filtering', () => {
      it('should filter array with expression', () => {
        const result = queryJSONPath(testData, '$.services[?(@.enabled==true)]');
        expect(result).toHaveLength(2);
        expect(result.every((s: any) => s.enabled === true)).toBe(true);
      });

      it('should filter array with numeric comparison', () => {
        const result = queryJSONPath(testData, '$.services[?(@.priority>5)]');
        expect(result).toHaveLength(2);
        expect(result.every((s: any) => s.priority > 5)).toBe(true);
      });

      it('should filter array with string match', () => {
        const result = queryJSONPath(testData, '$.databases[?(@.environment=="production")]');
        expect(result).toHaveLength(2);
        expect(result.every((db: any) => db.environment === 'production')).toBe(true);
      });
    });

    describe('Complex queries', () => {
      it('should query all service names', () => {
        const result = queryJSONPath(testData, '$.services[*].name');
        expect(result).toEqual(['auth', 'cache', 'queue']);
      });

      it('should query multiple properties', () => {
        const result = queryJSONPath(testData, '$..host');
        expect(result).toHaveLength(2);
        expect(result).toContain('localhost');
        expect(result).toContain('api.example.com');
      });
    });

    describe('Error handling', () => {
      it('should return empty array for invalid JSONPath', () => {
        const result = queryJSONPath(testData, '$..[invalid');
        expect(result).toEqual([]);
      });

      it('should return empty array for non-existent path', () => {
        const result = queryJSONPath(testData, '$.nonexistent.path');
        expect(result).toEqual([]);
      });
    });
  });

  describe('queryXPath', () => {
    describe('Absolute paths', () => {
      it('should query simple absolute path', () => {
        const result = queryXPath(testData, '/database/host');
        expect(result).toEqual(['localhost']);
      });

      it('should query nested absolute path', () => {
        const result = queryXPath(testData, '/database/credentials/username');
        expect(result).toEqual(['admin']);
      });

      it('should return empty array for non-existent path', () => {
        const result = queryXPath(testData, '/nonexistent/path');
        expect(result).toEqual([]);
      });
    });

    describe('Recursive descent', () => {
      it('should use recursive descent with //', () => {
        const result = queryXPath(testData, '//host');
        expect(result).toHaveLength(2);
        expect(result).toContain('localhost');
        expect(result).toContain('api.example.com');
      });

      it('should use recursive descent for nested property', () => {
        const result = queryXPath(testData, '//timeout');
        expect(result.length).toBeGreaterThan(0);
      });

      it('should use recursive descent with path', () => {
        const result = queryXPath(testData, '//config/timeout');
        expect(result).toHaveLength(3);
        expect(result).toContain(1000);
        expect(result).toContain(2000);
        expect(result).toContain(3000);
      });
    });

    describe('Wildcards', () => {
      it('should match all children with *', () => {
        const result = queryXPath(testData, '/api/endpoints/*/path');
        expect(result).toHaveLength(3);
        expect(result).toContain('/users');
        expect(result).toContain('/posts');
        expect(result).toContain('/comments');
      });

      it('should match with wildcard in middle of path', () => {
        const result = queryXPath(testData, '//services/*/name');
        expect(result).toEqual(['auth', 'cache', 'queue']);
      });
    });

    describe('Predicates', () => {
      it('should filter with string predicate', () => {
        const result = queryXPath(testData, '//databases/*[environment=production]');
        expect(result).toHaveLength(2);
        expect(result.every((db: any) => db.environment === 'production')).toBe(true);
      });

      it('should filter with predicate on name', () => {
        const result = queryXPath(testData, '//services/*[name=auth]');
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('auth');
      });
    });

    describe('Array access', () => {
      it('should access array by index', () => {
        const result = queryXPath(testData, '/api/endpoints[0]');
        expect(result).toEqual([{ path: '/users', method: 'GET' }]);
      });

      it('should access nested property in array element', () => {
        const result = queryXPath(testData, '/services[0]/name');
        expect(result).toEqual(['auth']);
      });
    });

    describe('Edge cases', () => {
      it('should handle empty object', () => {
        const result = queryXPath({}, '//property');
        expect(result).toEqual([]);
      });

      it('should handle path without leading slash', () => {
        const result = queryXPath(testData, 'database/host');
        expect(result).toEqual(['localhost']);
      });
    });
  });

  describe('Integration tests', () => {
    it('should return consistent results across query methods for simple paths', () => {
      const wildcardResult = queryWildcard(testData, 'database.host');
      const jsonpathResult = queryJSONPath(testData, '$.database.host');
      const xpathResult = queryXPath(testData, '/database/host');

      expect(wildcardResult).toEqual(jsonpathResult);
      expect(jsonpathResult).toEqual(xpathResult);
    });

    it('should handle complex nested structures', () => {
      const complexData = {
        level1: {
          level2: {
            level3: {
              value: 'deep'
            }
          }
        }
      };

      expect(queryWildcard(complexData, 'level1.level2.level3.value')).toEqual(['deep']);
      expect(queryJSONPath(complexData, '$.level1.level2.level3.value')).toEqual(['deep']);
      expect(queryXPath(complexData, '/level1/level2/level3/value')).toEqual(['deep']);
    });

    it('should handle arrays of arrays', () => {
      const arrayData = {
        matrix: [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
      };

      const result1 = queryWildcard(arrayData, 'matrix[0]');
      // JSONPath returns flattened array for nested arrays
      const result2 = queryJSONPath(arrayData, '$.matrix[0]');
      const result3 = queryXPath(arrayData, '/matrix[0]');

      expect(result1).toEqual([[1, 2, 3]]);
      // JSONPath flattens nested arrays
      expect(result2).toEqual([1, 2, 3]);
      expect(result3).toEqual([[1, 2, 3]]);
    });
  });
});
