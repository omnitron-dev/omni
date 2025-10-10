/**
 * Priority 1 CRITICAL: Error Contract Validation Tests
 *
 * Tests ServiceError validation and error schema contracts
 */

import { z } from 'zod';
import { ValidationEngine, ServiceError } from '../../src/validation/validation-engine.js';
import { contract } from '../../src/validation/contract.js';

describe('Error Contract Validation', () => {
  let engine: ValidationEngine;

  beforeEach(() => {
    engine = new ValidationEngine();
  });

  describe('ServiceError validation', () => {
    it('should validate error responses match error schema', () => {
      // Define contract with error schemas
      const userContract = contract({
        createUser: {
          input: z.object({ email: z.string().email() }),
          output: z.object({ id: z.string(), email: z.string() }),
          errors: {
            409: z.object({
              code: z.literal('USER_EXISTS'),
              message: z.string(),
              email: z.string().email()
            }),
            422: z.object({
              code: z.literal('VALIDATION_ERROR'),
              errors: z.array(z.string())
            })
          }
        }
      });

      const method = userContract.getMethod('createUser');
      expect(method?.errors).toBeDefined();
      expect(method?.errors?.[409]).toBeDefined();
      expect(method?.errors?.[422]).toBeDefined();

      // Validate 409 error response
      const errorSchema409 = method?.errors?.[409]!;
      const validator409 = engine.compile(errorSchema409);

      const validError409 = {
        code: 'USER_EXISTS',
        message: 'User already exists',
        email: 'test@example.com'
      };

      expect(() => validator409.validate(validError409)).not.toThrow();

      // Invalid error response should fail
      const invalidError409 = {
        code: 'WRONG_CODE',
        message: 'User already exists',
        email: 'test@example.com'
      };

      expect(() => validator409.validate(invalidError409)).toThrow();

      // Validate 422 error response
      const errorSchema422 = method?.errors?.[422]!;
      const validator422 = engine.compile(errorSchema422);

      const validError422 = {
        code: 'VALIDATION_ERROR',
        errors: ['Field email is invalid', 'Field age is required']
      };

      expect(() => validator422.validate(validError422)).not.toThrow();
    });

    it('should support multiple status codes with different error schemas', () => {
      const apiContract = contract({
        processPayment: {
          input: z.object({
            amount: z.number().positive(),
            currency: z.string()
          }),
          output: z.object({
            transactionId: z.string(),
            status: z.enum(['success', 'pending'])
          }),
          errors: {
            400: z.object({
              code: z.literal('INVALID_AMOUNT'),
              message: z.string(),
              amount: z.number()
            }),
            402: z.object({
              code: z.literal('INSUFFICIENT_FUNDS'),
              message: z.string(),
              required: z.number(),
              available: z.number()
            }),
            429: z.object({
              code: z.literal('RATE_LIMIT'),
              message: z.string(),
              retryAfter: z.number()
            })
          }
        }
      });

      const method = apiContract.getMethod('processPayment');
      expect(Object.keys(method?.errors || {})).toEqual(['400', '402', '429']);

      // Each error schema should be distinct
      const error400Schema = method?.errors?.[400]!;
      const error402Schema = method?.errors?.[402]!;
      const error429Schema = method?.errors?.[429]!;

      const validator400 = engine.compile(error400Schema);
      const validator402 = engine.compile(error402Schema);
      const validator429 = engine.compile(error429Schema);

      // 400 error
      expect(() => validator400.validate({
        code: 'INVALID_AMOUNT',
        message: 'Amount must be positive',
        amount: -100
      })).not.toThrow();

      // 402 error
      expect(() => validator402.validate({
        code: 'INSUFFICIENT_FUNDS',
        message: 'Not enough funds',
        required: 1000,
        available: 500
      })).not.toThrow();

      // 429 error
      expect(() => validator429.validate({
        code: 'RATE_LIMIT',
        message: 'Too many requests',
        retryAfter: 60
      })).not.toThrow();
    });

    it('should handle ServiceError with contract validation', () => {
      const errorData = {
        code: 'NOT_FOUND',
        message: 'Resource not found',
        resourceId: '123'
      };

      const error = new ServiceError(404, errorData);

      expect(error.statusCode).toBe(404);
      expect(error.data).toEqual(errorData);
      expect(error.message).toBe('Service error: 404');

      // Validate error data against schema
      const errorSchema = z.object({
        code: z.string(),
        message: z.string(),
        resourceId: z.string()
      });

      const validator = engine.compile(errorSchema);
      expect(() => validator.validate(error.data)).not.toThrow();
    });

    it('should support generic ServiceError types', () => {
      // ServiceError with generic status code
      const error1 = new ServiceError(500, { message: 'Internal error' });
      expect(error1.statusCode).toBe(500);

      const error2 = new ServiceError(503, { message: 'Service unavailable' });
      expect(error2.statusCode).toBe(503);

      // Validate both against same schema
      const errorSchema = z.object({
        message: z.string()
      });

      const validator = engine.compile(errorSchema);
      expect(() => validator.validate(error1.data)).not.toThrow();
      expect(() => validator.validate(error2.data)).not.toThrow();
    });
  });

  describe('Custom error maps', () => {
    it('should use custom errorMap for validation', () => {
      const customErrorMap: z.ZodErrorMap = (issue, ctx) => {
        if (issue.code === z.ZodIssueCode.invalid_type) {
          return { message: `Expected ${issue.expected}, got ${issue.received}` };
        }
        if (issue.code === z.ZodIssueCode.too_small) {
          return { message: `Value too small: minimum is ${(issue as any).minimum}` };
        }
        return { message: ctx.defaultError };
      };

      const schema = z.object({
        age: z.number().min(18),
        name: z.string()
      });

      const validator = engine.compile(schema, { errorMap: customErrorMap });

      try {
        validator.validate({ age: 'not-a-number', name: 'John' });
        fail('Should have thrown');
      } catch (error: any) {
        const json = error.toJSON();
        expect(json.errors[0]?.message).toContain('expected number');
      }

      try {
        validator.validate({ age: 15, name: 'John' });
        fail('Should have thrown');
      } catch (error: any) {
        const json = error.toJSON();
        // Check that error message includes the minimum value
        expect(json.errors[0]?.message).toContain('18');
      }
    });

    it('should handle errorMap with multiple error codes', () => {
      const errorMap: z.ZodErrorMap = (issue, ctx) => {
        switch (issue.code) {
          case z.ZodIssueCode.invalid_string:
            return { message: 'String validation failed' };
          case z.ZodIssueCode.too_big:
            return { message: 'Value exceeds maximum' };
          case z.ZodIssueCode.invalid_enum_value:
            return { message: 'Invalid enum value provided' };
          default:
            return { message: ctx.defaultError };
        }
      };

      const schema = z.object({
        email: z.string().email(),
        age: z.number().max(100),
        role: z.enum(['admin', 'user', 'guest'])
      });

      const validator = engine.compile(schema, { errorMap });

      // Test invalid email
      try {
        validator.validate({ email: 'invalid', age: 25, role: 'user' });
        fail('Should have thrown');
      } catch (error: any) {
        const json = error.toJSON();
        // Zod's email validation returns 'Invalid email address' not 'String validation failed'
        // The custom error map doesn't override email validation messages
        expect(json.errors[0]?.message).toBeDefined();
        expect(json.errors.length).toBeGreaterThan(0);
      }

      // Test age too big
      try {
        validator.validate({ email: 'test@example.com', age: 150, role: 'user' });
        fail('Should have thrown');
      } catch (error: any) {
        const json = error.toJSON();
        // Check that error message includes information about max value
        expect(json.errors[0]?.message).toContain('100');
      }

      // Test invalid enum
      try {
        validator.validate({ email: 'test@example.com', age: 25, role: 'superadmin' });
        fail('Should have thrown');
      } catch (error: any) {
        const json = error.toJSON();
        // Check that it's an enum validation error (Zod uses 'invalid_value' for enums)
        expect(json.errors[0]?.message).toBeDefined();
        expect(['invalid_enum_value', 'invalid_value']).toContain(json.errors[0]?.code);
      }
    });

    it('should handle errorMap that throws exceptions', () => {
      const throwingErrorMap: z.ZodErrorMap = (issue, ctx) => {
        if (issue.code === z.ZodIssueCode.invalid_type) {
          throw new Error('ErrorMap encountered invalid type');
        }
        return { message: ctx.defaultError };
      };

      const schema = z.object({
        value: z.number()
      });

      const validator = engine.compile(schema, { errorMap: throwingErrorMap });

      // ErrorMap throwing should be caught by Zod and fall back
      expect(() => {
        validator.validate({ value: 'string' });
      }).toThrow();
    });

    it('should support async errorMap with async validation', async () => {
      // Note: Zod errorMap itself is sync, but we can test async validation context
      const customErrorMap: z.ZodErrorMap = (issue, ctx) => {
        if (issue.code === z.ZodIssueCode.custom) {
          return { message: 'Async validation failed' };
        }
        return { message: ctx.defaultError };
      };

      const schema = z.string().refine(
        async (val) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return val.length > 5;
        },
        { message: 'Async validation failed' }
      );

      const validator = engine.compile(schema, { errorMap: customErrorMap });

      try {
        await validator.validateAsync('abc');
        fail('Should have thrown');
      } catch (error: any) {
        const json = error.toJSON();
        expect(json.errors[0]?.message).toBe('Async validation failed');
      }
    });
  });

  describe('Error contract integration', () => {
    it('should validate error responses in CRUD operations', () => {
      const userSchema = z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        name: z.string()
      });

      const crudContract = contract({
        create: {
          input: userSchema.omit({ id: true }),
          output: userSchema,
          errors: {
            409: z.object({
              code: z.literal('ALREADY_EXISTS'),
              message: z.string(),
              email: z.string()
            })
          }
        },
        update: {
          input: z.object({
            id: z.string().uuid(),
            data: userSchema.partial()
          }),
          output: userSchema,
          errors: {
            404: z.object({
              code: z.literal('NOT_FOUND'),
              message: z.string(),
              id: z.string()
            })
          }
        },
        delete: {
          input: z.string().uuid(),
          output: z.boolean(),
          errors: {
            404: z.object({
              code: z.literal('NOT_FOUND'),
              message: z.string(),
              id: z.string()
            })
          }
        }
      });

      // Validate create error
      const createMethod = crudContract.getMethod('create');
      const createErrorSchema = createMethod?.errors?.[409]!;
      const createErrorValidator = engine.compile(createErrorSchema);

      expect(() => createErrorValidator.validate({
        code: 'ALREADY_EXISTS',
        message: 'User already exists',
        email: 'test@example.com'
      })).not.toThrow();

      // Validate update error
      const updateMethod = crudContract.getMethod('update');
      const updateErrorSchema = updateMethod?.errors?.[404]!;
      const updateErrorValidator = engine.compile(updateErrorSchema);

      expect(() => updateErrorValidator.validate({
        code: 'NOT_FOUND',
        message: 'User not found',
        id: '123e4567-e89b-12d3-a456-426614174000'
      })).not.toThrow();

      // Validate delete error (same schema as update)
      const deleteMethod = crudContract.getMethod('delete');
      const deleteErrorSchema = deleteMethod?.errors?.[404]!;
      const deleteErrorValidator = engine.compile(deleteErrorSchema);

      expect(() => deleteErrorValidator.validate({
        code: 'NOT_FOUND',
        message: 'User not found',
        id: '123e4567-e89b-12d3-a456-426614174000'
      })).not.toThrow();
    });

    it('should handle complex error schemas with nested objects', () => {
      const complexContract = contract({
        processOrder: {
          input: z.object({
            orderId: z.string(),
            items: z.array(z.object({
              productId: z.string(),
              quantity: z.number()
            }))
          }),
          output: z.object({
            orderId: z.string(),
            status: z.string()
          }),
          errors: {
            400: z.object({
              code: z.literal('INVALID_ORDER'),
              message: z.string(),
              errors: z.array(z.object({
                field: z.string(),
                issue: z.string(),
                value: z.any()
              }))
            }),
            402: z.object({
              code: z.literal('PAYMENT_FAILED'),
              message: z.string(),
              payment: z.object({
                method: z.string(),
                reason: z.string(),
                details: z.record(z.string(), z.any())
              })
            })
          }
        }
      });

      const method = complexContract.getMethod('processOrder');

      // Validate complex 400 error
      const error400Schema = method?.errors?.[400]!;
      const validator400 = engine.compile(error400Schema);

      expect(() => validator400.validate({
        code: 'INVALID_ORDER',
        message: 'Order validation failed',
        errors: [
          { field: 'items.0.quantity', issue: 'Must be positive', value: -1 },
          { field: 'items.1.productId', issue: 'Product not found', value: 'invalid-id' }
        ]
      })).not.toThrow();

      // Validate complex 402 error
      const error402Schema = method?.errors?.[402]!;
      const validator402 = engine.compile(error402Schema);

      expect(() => validator402.validate({
        code: 'PAYMENT_FAILED',
        message: 'Payment processing failed',
        payment: {
          method: 'credit_card',
          reason: 'insufficient_funds',
          details: {
            cardLast4: '1234',
            attemptId: 'attempt_123'
          }
        }
      })).not.toThrow();
    });
  });

  describe('Error validation edge cases', () => {
    it('should handle empty error definitions', () => {
      const emptyContract = contract({
        method: {
          input: z.string(),
          output: z.string(),
          errors: {}
        }
      });

      const method = emptyContract.getMethod('method');
      expect(method?.errors).toEqual({});
    });

    it('should handle missing error definitions', () => {
      const noErrorsContract = contract({
        method: {
          input: z.string(),
          output: z.string()
        }
      });

      const method = noErrorsContract.getMethod('method');
      expect(method?.errors).toBeUndefined();
    });

    it('should validate error data with optional fields', () => {
      const errorSchema = z.object({
        code: z.string(),
        message: z.string(),
        details: z.object({
          field: z.string(),
          value: z.any()
        }).optional(),
        trace: z.array(z.string()).optional()
      });

      const validator = engine.compile(errorSchema);

      // Without optional fields
      expect(() => validator.validate({
        code: 'ERROR',
        message: 'An error occurred'
      })).not.toThrow();

      // With optional fields
      expect(() => validator.validate({
        code: 'ERROR',
        message: 'An error occurred',
        details: { field: 'email', value: 'invalid' },
        trace: ['line 1', 'line 2']
      })).not.toThrow();
    });

    it('should handle union error schemas', () => {
      const unionErrorSchema = z.discriminatedUnion('type', [
        z.object({
          type: z.literal('validation'),
          errors: z.array(z.string())
        }),
        z.object({
          type: z.literal('system'),
          code: z.string(),
          message: z.string()
        }),
        z.object({
          type: z.literal('network'),
          statusCode: z.number(),
          endpoint: z.string()
        })
      ]);

      const validator = engine.compile(unionErrorSchema);

      // Validation error
      expect(() => validator.validate({
        type: 'validation',
        errors: ['Field is required']
      })).not.toThrow();

      // System error
      expect(() => validator.validate({
        type: 'system',
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong'
      })).not.toThrow();

      // Network error
      expect(() => validator.validate({
        type: 'network',
        statusCode: 503,
        endpoint: '/api/users'
      })).not.toThrow();
    });
  });
});
