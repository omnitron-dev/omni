/**
 * Tests for EventValidationService
 */

import 'reflect-metadata';
import { EventValidationService } from '../../../src/modules/events/event-validation.service';

describe('EventValidationService', () => {
  let validationService: EventValidationService;
  let mockEmitter: any;

  beforeEach(() => {
    mockEmitter = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn(),
      listeners: jest.fn().mockReturnValue([]),
      eventNames: jest.fn().mockReturnValue([])
    };

    validationService = new EventValidationService(mockEmitter);
  });

  it('should validate event names', () => {
    expect(validationService.isValidEventName('valid.event')).toBe(true);
    expect(validationService.isValidEventName('also.valid.event')).toBe(true);
    expect(validationService.isValidEventName('123invalid')).toBe(false);
    expect(validationService.isValidEventName('')).toBe(false);
    expect(validationService.isValidEventName('invalid..event')).toBe(false);
  });

  it('should validate event data', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' }
      },
      required: ['id']
    };

    validationService.registerSchema('user.event', schema);

    expect(validationService.validateData('user.event', { id: 1, name: 'John' })).toBe(true);
    expect(validationService.validateData('user.event', { name: 'John' })).toBe(false);
    expect(validationService.validateData('user.event', { id: '1', name: 'John' })).toBe(false);
  });

  it('should validate handler signature', () => {
    const validHandler = (data: any) => {};
    const asyncHandler = async (data: any) => {};
    const invalidHandler = 'not a function';

    expect(validationService.isValidHandler(validHandler)).toBe(true);
    expect(validationService.isValidHandler(asyncHandler)).toBe(true);
    expect(validationService.isValidHandler(invalidHandler as any)).toBe(false);
  });

  it('should sanitize event data', () => {
    const data = {
      name: 'John',
      password: 'secret123',
      ssn: '123-45-6789',
      safe: 'value'
    };

    const sanitized = validationService.sanitizeData(data);
    expect(sanitized.name).toBe('John');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.ssn).toBe('[REDACTED]');
    expect(sanitized.safe).toBe('value');
  });
});