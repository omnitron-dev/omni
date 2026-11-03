import { Errors } from '@omnitron-dev/titan/errors';
import type { ProcessInfoDto } from '../config/types.js';

/** Runtime resize addresses one declared pool; it never rewrites source policy. */
export interface PoolScaleRequest { name: string; process: string; instances: number }
export function parsePoolScaleRequest(value: unknown): PoolScaleRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.badRequest('Invalid pool resize request');
  const input = value as Record<string, unknown>;
  const identifier = (text: unknown, max: number): text is string => typeof text === 'string' &&
    text.length > 0 && text.length <= max && text.trim() === text && ![...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  if (!identifier(input['name'], 1024)) throw Errors.badRequest('An application name is required');
  if (!identifier(input['process'], 255)) throw Errors.badRequest('Select a declared process pool with --process <name>');
  if (!Number.isSafeInteger(input['instances']) || (input['instances'] as number) < 1)
    throw Errors.badRequest('Instance count must be a positive safe integer');
  return Object.freeze({ name: input['name'], process: input['process'], instances: input['instances'] as number });
}
export function assertPoolScaleTarget(app: ProcessInfoDto | null, request: PoolScaleRequest): void {
  if (!app) throw Errors.notFound('App', request.name);
  if (app.mode !== 'bootstrap') throw Errors.badRequest('Classic applications cannot be resized');
  const process = app.processes?.find(item => item.name === request.process);
  if (!process || !Number.isSafeInteger(process.declaredInstances) || process.declaredInstances < 2) throw Errors.badRequest('Select an existing declared process pool; singleton processes cannot be replicated');
}
