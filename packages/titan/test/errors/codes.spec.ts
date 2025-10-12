/**
 * Comprehensive tests for error codes module
 */

import { describe, it, expect } from '@jest/globals';
import {
  ErrorCode,
  ErrorCategory,
  getErrorCategory,
  isClientError,
  isServerError,
  isRetryableError,
  getErrorName,
  getDefaultMessage,
} from '../../src/errors/codes.js';

describe('Error Codes', () => {
  describe('ErrorCode enum', () => {
    it('should define success codes', () => {
      expect(ErrorCode.OK).toBe(200);
      expect(ErrorCode.CREATED).toBe(201);
      expect(ErrorCode.ACCEPTED).toBe(202);
      expect(ErrorCode.NO_CONTENT).toBe(204);
    });

    it('should define client error codes', () => {
      expect(ErrorCode.BAD_REQUEST).toBe(400);
      expect(ErrorCode.UNAUTHORIZED).toBe(401);
      expect(ErrorCode.FORBIDDEN).toBe(403);
      expect(ErrorCode.NOT_FOUND).toBe(404);
      expect(ErrorCode.METHOD_NOT_ALLOWED).toBe(405);
      expect(ErrorCode.REQUEST_TIMEOUT).toBe(408);
      expect(ErrorCode.CONFLICT).toBe(409);
      expect(ErrorCode.UNPROCESSABLE_ENTITY).toBe(422);
      expect(ErrorCode.TOO_MANY_REQUESTS).toBe(429);
    });

    it('should define server error codes', () => {
      expect(ErrorCode.INTERNAL_SERVER_ERROR).toBe(500);
      expect(ErrorCode.NOT_IMPLEMENTED).toBe(501);
      expect(ErrorCode.BAD_GATEWAY).toBe(502);
      expect(ErrorCode.SERVICE_UNAVAILABLE).toBe(503);
      expect(ErrorCode.GATEWAY_TIMEOUT).toBe(504);
    });

    it('should define custom error codes', () => {
      expect(ErrorCode.MULTIPLE_ERRORS).toBe(600);
      expect(ErrorCode.UNKNOWN_ERROR).toBe(601);
    });

    it('should define aliases correctly', () => {
      expect(ErrorCode.VALIDATION_ERROR).toBe(422);
      expect(ErrorCode.INVALID_ARGUMENT).toBe(400);
      expect(ErrorCode.PERMISSION_DENIED).toBe(403);
      expect(ErrorCode.INTERNAL_ERROR).toBe(500);
      expect(ErrorCode.RATE_LIMITED).toBe(429);
    });
  });

  describe('getErrorCategory()', () => {
    it('should categorize 2xx as SUCCESS', () => {
      expect(getErrorCategory(200)).toBe(ErrorCategory.SUCCESS);
      expect(getErrorCategory(201)).toBe(ErrorCategory.SUCCESS);
      expect(getErrorCategory(204)).toBe(ErrorCategory.SUCCESS);
      expect(getErrorCategory(299)).toBe(ErrorCategory.SUCCESS);
    });

    it('should categorize auth-related codes as AUTH', () => {
      expect(getErrorCategory(401)).toBe(ErrorCategory.AUTH);
      expect(getErrorCategory(403)).toBe(ErrorCategory.AUTH);
      expect(getErrorCategory(407)).toBe(ErrorCategory.AUTH);
    });

    it('should categorize 422 as VALIDATION', () => {
      expect(getErrorCategory(422)).toBe(ErrorCategory.VALIDATION);
      expect(getErrorCategory(ErrorCode.VALIDATION_ERROR)).toBe(ErrorCategory.VALIDATION);
    });

    it('should categorize 429 as RATE_LIMIT', () => {
      expect(getErrorCategory(429)).toBe(ErrorCategory.RATE_LIMIT);
      expect(getErrorCategory(ErrorCode.RATE_LIMITED)).toBe(ErrorCategory.RATE_LIMIT);
    });

    it('should categorize general 4xx as CLIENT', () => {
      expect(getErrorCategory(400)).toBe(ErrorCategory.CLIENT);
      expect(getErrorCategory(404)).toBe(ErrorCategory.CLIENT);
      expect(getErrorCategory(405)).toBe(ErrorCategory.CLIENT);
      expect(getErrorCategory(409)).toBe(ErrorCategory.CLIENT);
      expect(getErrorCategory(410)).toBe(ErrorCategory.CLIENT);
    });

    it('should categorize 5xx as SERVER', () => {
      expect(getErrorCategory(500)).toBe(ErrorCategory.SERVER);
      expect(getErrorCategory(501)).toBe(ErrorCategory.SERVER);
      expect(getErrorCategory(502)).toBe(ErrorCategory.SERVER);
      expect(getErrorCategory(503)).toBe(ErrorCategory.SERVER);
      expect(getErrorCategory(504)).toBe(ErrorCategory.SERVER);
    });

    it('should categorize 600+ as CUSTOM', () => {
      expect(getErrorCategory(600)).toBe(ErrorCategory.CUSTOM);
      expect(getErrorCategory(601)).toBe(ErrorCategory.CUSTOM);
      expect(getErrorCategory(999)).toBe(ErrorCategory.CUSTOM);
    });
  });

  describe('isClientError()', () => {
    it('should return true for 4xx codes', () => {
      expect(isClientError(400)).toBe(true);
      expect(isClientError(401)).toBe(true);
      expect(isClientError(404)).toBe(true);
      expect(isClientError(429)).toBe(true);
      expect(isClientError(499)).toBe(true);
    });

    it('should return false for non-4xx codes', () => {
      expect(isClientError(200)).toBe(false);
      expect(isClientError(300)).toBe(false);
      expect(isClientError(500)).toBe(false);
      expect(isClientError(600)).toBe(false);
    });
  });

  describe('isServerError()', () => {
    it('should return true for 5xx codes', () => {
      expect(isServerError(500)).toBe(true);
      expect(isServerError(501)).toBe(true);
      expect(isServerError(503)).toBe(true);
      expect(isServerError(504)).toBe(true);
      expect(isServerError(599)).toBe(true);
    });

    it('should return false for non-5xx codes', () => {
      expect(isServerError(200)).toBe(false);
      expect(isServerError(400)).toBe(false);
      expect(isServerError(600)).toBe(false);
    });
  });

  describe('isRetryableError()', () => {
    it('should return true for retryable error codes', () => {
      expect(isRetryableError(ErrorCode.REQUEST_TIMEOUT)).toBe(true);
      expect(isRetryableError(ErrorCode.TOO_MANY_REQUESTS)).toBe(true);
      expect(isRetryableError(ErrorCode.INTERNAL_SERVER_ERROR)).toBe(true);
      expect(isRetryableError(ErrorCode.BAD_GATEWAY)).toBe(true);
      expect(isRetryableError(ErrorCode.SERVICE_UNAVAILABLE)).toBe(true);
      expect(isRetryableError(ErrorCode.GATEWAY_TIMEOUT)).toBe(true);
      expect(isRetryableError(ErrorCode.INSUFFICIENT_STORAGE)).toBe(true);
      expect(isRetryableError(ErrorCode.NETWORK_AUTHENTICATION_REQUIRED)).toBe(true);
    });

    it('should return false for non-retryable error codes', () => {
      expect(isRetryableError(ErrorCode.BAD_REQUEST)).toBe(false);
      expect(isRetryableError(ErrorCode.UNAUTHORIZED)).toBe(false);
      expect(isRetryableError(ErrorCode.FORBIDDEN)).toBe(false);
      expect(isRetryableError(ErrorCode.NOT_FOUND)).toBe(false);
      expect(isRetryableError(ErrorCode.CONFLICT)).toBe(false);
      expect(isRetryableError(ErrorCode.VALIDATION_ERROR)).toBe(false);
      expect(isRetryableError(ErrorCode.NOT_IMPLEMENTED)).toBe(false);
    });
  });

  describe('getErrorName()', () => {
    it('should return correct names for common error codes', () => {
      expect(getErrorName(200)).toBe('OK');
      expect(getErrorName(201)).toBe('CREATED');
      expect(getErrorName(204)).toBe('NO_CONTENT');
      expect(getErrorName(400)).toBe('BAD_REQUEST');
      expect(getErrorName(401)).toBe('UNAUTHORIZED');
      expect(getErrorName(403)).toBe('FORBIDDEN');
      expect(getErrorName(404)).toBe('NOT_FOUND');
      expect(getErrorName(409)).toBe('CONFLICT');
      expect(getErrorName(422)).toBe('UNPROCESSABLE_ENTITY');
      expect(getErrorName(429)).toBe('TOO_MANY_REQUESTS');
      expect(getErrorName(500)).toBe('INTERNAL_SERVER_ERROR');
      expect(getErrorName(503)).toBe('SERVICE_UNAVAILABLE');
      expect(getErrorName(600)).toBe('MULTIPLE_ERRORS');
      expect(getErrorName(601)).toBe('UNKNOWN_ERROR');
    });

    it('should return generic name for unmapped codes', () => {
      expect(getErrorName(402)).toBe('ERROR_402');
      expect(getErrorName(999)).toBe('ERROR_999');
    });

    it('should handle special codes', () => {
      expect(getErrorName(418)).toBe('IM_A_TEAPOT');
    });
  });

  describe('getDefaultMessage()', () => {
    it('should return correct messages for common error codes', () => {
      expect(getDefaultMessage(400)).toBe('The request is invalid');
      expect(getDefaultMessage(401)).toBe('Authentication is required');
      expect(getDefaultMessage(403)).toBe('You do not have permission to access this resource');
      expect(getDefaultMessage(404)).toBe('The requested resource was not found');
      expect(getDefaultMessage(422)).toBe('The request could not be processed');
      expect(getDefaultMessage(429)).toBe('Too many requests, please try again later');
      expect(getDefaultMessage(500)).toBe('An internal server error occurred');
      expect(getDefaultMessage(503)).toBe('The service is temporarily unavailable');
      expect(getDefaultMessage(600)).toBe('Multiple errors occurred');
      expect(getDefaultMessage(601)).toBe('An unknown error occurred');
    });

    it('should return generic message for unmapped codes', () => {
      expect(getDefaultMessage(402)).toBe('Error 402');
      expect(getDefaultMessage(999)).toBe('Error 999');
    });

    it('should handle special codes', () => {
      expect(getDefaultMessage(418)).toBe("I'm a teapot");
    });
  });
});
