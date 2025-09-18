/**
 * Types for the Template Module
 */

import type { z } from 'zod';
import type { Token, Container } from '@omnitron-dev/nexus';

/**
 * Configuration options for the Template module
 */
export interface TemplateModuleOptions {
  /**
   * Enable debug mode
   */
  debug?: boolean;

  /**
   * Custom prefix for all module operations
   */
  prefix?: string;

  /**
   * Timeout for operations in milliseconds
   */
  timeout?: number;

  /**
   * Enable caching
   */
  enableCache?: boolean;

  /**
   * Cache TTL in seconds
   */
  cacheTTL?: number;

  /**
   * Custom configuration object
   */
  custom?: Record<string, any>;
}

/**
 * Async options for dynamic module configuration
 */
export interface TemplateModuleAsyncOptions {
  /**
   * Factory function to create options
   */
  useFactory?: (...args: any[]) => Promise<TemplateModuleOptions> | TemplateModuleOptions;

  /**
   * Dependencies to inject into the factory
   */
  inject?: Token[];

  /**
   * Use an existing options provider
   */
  useExisting?: Token<TemplateOptionsFactory>;

  /**
   * Use a class as options provider
   */
  useClass?: new (...args: any[]) => TemplateOptionsFactory;

  /**
   * Module is global
   */
  isGlobal?: boolean;
}

/**
 * Factory interface for creating module options
 */
export interface TemplateOptionsFactory {
  createTemplateOptions(): Promise<TemplateModuleOptions> | TemplateModuleOptions;
}

/**
 * Example data structure
 */
export interface TemplateData {
  id: string;
  name: string;
  description?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Example event payload
 */
export interface TemplateEvent {
  type: 'created' | 'updated' | 'deleted';
  data: TemplateData;
  timestamp: Date;
  source?: string;
}

/**
 * Service operation result
 */
export interface OperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: Error;
  metadata?: Record<string, any>;
}

/**
 * Validation schema type helper
 */
export type SchemaType<T> = z.ZodType<T>;

/**
 * Decorator metadata
 */
export interface TemplateMetadata {
  key: string;
  value: any;
  options?: Record<string, any>;
}

/**
 * Service status
 */
export enum ServiceStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  ERROR = 'error',
  STOPPED = 'stopped'
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  checks: {
    [key: string]: {
      status: 'up' | 'down';
      message?: string;
      details?: any;
    };
  };
  timestamp: Date;
}