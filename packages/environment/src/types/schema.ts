import { z } from 'zod';

/**
 * Schema type - can be JSON Schema or Zod schema
 */
export type Schema = JSONSchema | z.ZodType<any>;

/**
 * JSON Schema definition
 */
export interface JSONSchema {
  $schema?: string;
  $id?: string;
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean | JSONSchema;
  items?: JSONSchema | JSONSchema[];
  enum?: any[];
  const?: any;
  allOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  not?: JSONSchema;
  [key: string]: any;
}

/**
 * Type inference from schema
 */
export type Infer<S extends Schema> = S extends z.ZodType<infer T> ? T : any;

/**
 * Path extraction from schema
 */
export type Path<_S extends Schema> = string;

/**
 * Value at path in schema
 */
export type PathValue<_S extends Schema, _P extends string> = any;
