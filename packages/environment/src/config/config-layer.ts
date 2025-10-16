import { Schema } from '../types/schema.js';
import { ValidationResult } from '../types/validation.js';
import { deletePath, getPath, hasPath, setPath } from '../utils/path.js';
import { InterpolationContext, interpolateObject } from './interpolation.js';
import { SchemaValidator } from './schema-validator.js';

/**
 * Configuration layer with schema validation
 */
export class ConfigLayer<TSchema extends Schema = any> {
  private data: Record<string, any> = {};
  private validator: SchemaValidator;

  constructor(
    private schema?: TSchema,
    initialData?: Record<string, any>
  ) {
    this.validator = new SchemaValidator();
    if (initialData) {
      this.data = { ...initialData };
    }
  }

  /**
   * Get value at path
   */
  get(path: string): any {
    return getPath(this.data, path);
  }

  /**
   * Set value at path
   */
  set(path: string, value: any): void {
    this.data = setPath(this.data, path, value);
  }

  /**
   * Check if path exists
   */
  has(path: string): boolean {
    return hasPath(this.data, path);
  }

  /**
   * Delete path
   */
  delete(path: string): void {
    this.data = deletePath(this.data, path);
  }

  /**
   * Get all data
   */
  getAll(): Record<string, any> {
    return { ...this.data };
  }

  /**
   * Set all data
   */
  setAll(data: Record<string, any>): void {
    this.data = { ...data };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.data = {};
  }

  /**
   * Validate all data
   */
  async validate(): Promise<ValidationResult> {
    if (!this.schema) {
      return { valid: true };
    }

    return this.validator.validate(this.schema, this.data);
  }

  /**
   * Validate specific path
   */
  async validatePath(_path: string): Promise<ValidationResult> {
    if (!this.schema) {
      return { valid: true };
    }

    // For now, validate the entire data structure
    // TODO: Implement path-specific validation
    return this.validator.validate(this.schema, this.data);
  }

  /**
   * Resolve variables
   */
  async resolve(context: InterpolationContext): Promise<void> {
    this.data = interpolateObject(this.data, context);
  }

  /**
   * Get the schema
   */
  getSchema(): TSchema | undefined {
    return this.schema;
  }
}
