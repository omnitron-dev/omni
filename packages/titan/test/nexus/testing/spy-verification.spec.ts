/**
 * Spy Verification Tests
 * Tests for the TestContainer spy expectation tracking and verification
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { createTestContainer, TestContainer } from '../../../src/nexus/testing/test-container.js';
import { createToken } from '../../../src/nexus/token.js';

describe('TestContainer Spy Verification', () => {
  let testContainer: TestContainer;

  interface TestService {
    getData(): string;
    processData(input: string): number;
    saveData(id: number, data: string): void;
  }

  const SERVICE_TOKEN = createToken<TestService>('TestService');

  beforeEach(() => {
    testContainer = createTestContainer();
  });

  describe('Expectation Tracking', () => {
    it('should track exact call count expectations', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn().mockReturnValue(42),
          saveData: jest.fn(),
        },
        true // Enable spy
      );

      // Set expectation
      testContainer.expect(SERVICE_TOKEN, 'getData').toBeCalledTimes(2);

      const service = testContainer.resolve(SERVICE_TOKEN);

      // Call exactly 2 times
      service.getData();
      service.getData();

      // Should not throw
      expect(() => testContainer.verifyNoUnexpectedCalls()).not.toThrow();
    });

    it('should fail when call count does not match expectation', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        true
      );

      // Expect exactly 2 calls
      testContainer.expect(SERVICE_TOKEN, 'getData').toBeCalledTimes(2);

      const service = testContainer.resolve(SERVICE_TOKEN);

      // Call only once
      service.getData();

      // Should throw
      expect(() => testContainer.verifyNoUnexpectedCalls()).toThrow(/Expected exactly 2 calls/);
    });

    it('should track at-least call count expectations', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.expect(SERVICE_TOKEN, 'getData').toBeCalledAtLeast(2);

      const service = testContainer.resolve(SERVICE_TOKEN);

      // Call 3 times (more than 2)
      service.getData();
      service.getData();
      service.getData();

      expect(() => testContainer.verifyNoUnexpectedCalls()).not.toThrow();
    });

    it('should fail when at-least expectation is not met', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.expect(SERVICE_TOKEN, 'getData').toBeCalledAtLeast(3);

      const service = testContainer.resolve(SERVICE_TOKEN);

      // Call only 2 times
      service.getData();
      service.getData();

      expect(() => testContainer.verifyNoUnexpectedCalls()).toThrow(/Expected at least 3 calls/);
    });

    it('should track at-most call count expectations', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.expect(SERVICE_TOKEN, 'getData').toBeCalledAtMost(3);

      const service = testContainer.resolve(SERVICE_TOKEN);

      // Call 2 times (less than 3)
      service.getData();
      service.getData();

      expect(() => testContainer.verifyNoUnexpectedCalls()).not.toThrow();
    });

    it('should fail when at-most expectation is exceeded', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.expect(SERVICE_TOKEN, 'getData').toBeCalledAtMost(2);

      const service = testContainer.resolve(SERVICE_TOKEN);

      // Call 3 times (more than 2)
      service.getData();
      service.getData();
      service.getData();

      expect(() => testContainer.verifyNoUnexpectedCalls()).toThrow(/Expected at most 2 calls/);
    });
  });

  describe('Argument Verification', () => {
    it('should verify call arguments', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn(),
          processData: jest.fn().mockReturnValue(42),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.expect(SERVICE_TOKEN, 'processData').toBeCalledWith('test-input');

      const service = testContainer.resolve(SERVICE_TOKEN);

      // Call with expected arguments
      service.processData('test-input');

      expect(() => testContainer.verifyNoUnexpectedCalls()).not.toThrow();
    });

    it('should fail when arguments do not match', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn(),
          processData: jest.fn().mockReturnValue(42),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.expect(SERVICE_TOKEN, 'processData').toBeCalledWith('expected-input');

      const service = testContainer.resolve(SERVICE_TOKEN);

      // Call with different arguments
      service.processData('wrong-input');

      expect(() => testContainer.verifyNoUnexpectedCalls()).toThrow(
        /Expected call 0 with arguments \["expected-input"\]/
      );
    });

    it('should verify multiple arguments', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn(),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.expect(SERVICE_TOKEN, 'saveData').toBeCalledWith(123, 'test-data');

      const service = testContainer.resolve(SERVICE_TOKEN);

      service.saveData(123, 'test-data');

      expect(() => testContainer.verifyNoUnexpectedCalls()).not.toThrow();
    });

    it('should verify object arguments', () => {
      interface ComplexService {
        updateUser(user: { id: number; name: string }): void;
      }

      const COMPLEX_TOKEN = createToken<ComplexService>('ComplexService');

      testContainer.mock(
        COMPLEX_TOKEN,
        {
          updateUser: jest.fn(),
        },
        true
      );

      testContainer.expect(COMPLEX_TOKEN, 'updateUser').toBeCalledWith({ id: 1, name: 'John' });

      const service = testContainer.resolve(COMPLEX_TOKEN);

      service.updateUser({ id: 1, name: 'John' });

      expect(() => testContainer.verifyNoUnexpectedCalls()).not.toThrow();
    });
  });

  describe('Never Called Expectation', () => {
    it('should pass when method is never called', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn(),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.expect(SERVICE_TOKEN, 'getData').neverBeCalled();

      // Don't call the method

      expect(() => testContainer.verifyNoUnexpectedCalls()).not.toThrow();
    });

    it('should fail when method is called when it should not be', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.expect(SERVICE_TOKEN, 'getData').neverBeCalled();

      const service = testContainer.resolve(SERVICE_TOKEN);

      // Call the method
      service.getData();

      expect(() => testContainer.verifyNoUnexpectedCalls()).toThrow(/Expected spy to never be called/);
    });
  });

  describe('Unexpected Calls Detection', () => {
    it('should detect unexpected calls when no expectations are set', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        true
      );

      // No expectations set

      const service = testContainer.resolve(SERVICE_TOKEN);

      // Call method
      service.getData();

      expect(() => testContainer.verifyNoUnexpectedCalls()).toThrow(/Unexpected 1 call\(s\)/);
    });

    it('should not throw for methods without spies', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        false // No spy
      );

      const service = testContainer.resolve(SERVICE_TOKEN);

      service.getData();

      // Should not throw because spies are not enabled
      expect(() => testContainer.verifyNoUnexpectedCalls()).not.toThrow();
    });
  });

  describe('Multiple Expectations', () => {
    it('should handle multiple expectations on same method', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        true
      );

      // Set multiple expectations
      testContainer.expect(SERVICE_TOKEN, 'getData').toBeCalledTimes(2);
      testContainer.expect(SERVICE_TOKEN, 'getData').toBeCalledAtLeast(1);

      const service = testContainer.resolve(SERVICE_TOKEN);

      service.getData();
      service.getData();

      expect(() => testContainer.verifyNoUnexpectedCalls()).not.toThrow();
    });

    it('should handle expectations on multiple methods', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn().mockReturnValue(42),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.expect(SERVICE_TOKEN, 'getData').toBeCalledTimes(1);
      testContainer.expect(SERVICE_TOKEN, 'processData').toBeCalledTimes(1);
      testContainer.expect(SERVICE_TOKEN, 'saveData').neverBeCalled();

      const service = testContainer.resolve(SERVICE_TOKEN);

      service.getData();
      service.processData('input');

      expect(() => testContainer.verifyNoUnexpectedCalls()).not.toThrow();
    });
  });

  describe('Expectation Management', () => {
    it('should clear expectations for specific token', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.expect(SERVICE_TOKEN, 'getData').toBeCalledTimes(1);

      const service = testContainer.resolve(SERVICE_TOKEN);

      service.getData();
      service.getData(); // Call twice

      // Clear expectations
      testContainer.clearExpectations(SERVICE_TOKEN);

      // Now it's an unexpected call (no expectations)
      expect(() => testContainer.verifyNoUnexpectedCalls()).toThrow(/Unexpected/);
    });

    it('should clear all expectations', () => {
      const TOKEN_1 = createToken<TestService>('Service1');
      const TOKEN_2 = createToken<TestService>('Service2');

      testContainer.mock(
        TOKEN_1,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.mock(
        TOKEN_2,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn(),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.expect(TOKEN_1, 'getData').toBeCalledTimes(1);
      testContainer.expect(TOKEN_2, 'getData').toBeCalledTimes(1);

      testContainer.clearExpectations();

      const service1 = testContainer.resolve(TOKEN_1);
      const service2 = testContainer.resolve(TOKEN_2);

      service1.getData();
      service2.getData();

      // Should throw because all expectations were cleared
      expect(() => testContainer.verifyNoUnexpectedCalls()).toThrow(/Unexpected/);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle mixed expectations and actual calls', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn().mockReturnValue(42),
          saveData: jest.fn(),
        },
        true
      );

      // Set expectations
      testContainer.expect(SERVICE_TOKEN, 'getData').toBeCalledTimes(2);
      testContainer.expect(SERVICE_TOKEN, 'processData').toBeCalledWith('test');
      testContainer.expect(SERVICE_TOKEN, 'processData').toBeCalledAtLeast(1);
      testContainer.expect(SERVICE_TOKEN, 'saveData').neverBeCalled();

      const service = testContainer.resolve(SERVICE_TOKEN);

      // Make calls
      service.getData();
      service.getData();
      service.processData('test');

      expect(() => testContainer.verifyNoUnexpectedCalls()).not.toThrow();
    });

    it('should provide detailed error messages for multiple violations', () => {
      testContainer.mock(
        SERVICE_TOKEN,
        {
          getData: jest.fn().mockReturnValue('data'),
          processData: jest.fn().mockReturnValue(42),
          saveData: jest.fn(),
        },
        true
      );

      testContainer.expect(SERVICE_TOKEN, 'getData').toBeCalledTimes(1);
      testContainer.expect(SERVICE_TOKEN, 'processData').neverBeCalled();

      const service = testContainer.resolve(SERVICE_TOKEN);

      // Violate both expectations
      service.getData();
      service.getData(); // Called twice instead of once
      service.processData('test'); // Called when it should not be

      let error: Error | undefined;
      try {
        testContainer.verifyNoUnexpectedCalls();
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain('getData');
      expect(error?.message).toContain('processData');
    });
  });
});
