/**
 * Rotif Module Tokens
 *
 * Centralized token definitions for the Rotif messaging module.
 * These tokens are used for dependency injection integration.
 */

import { createToken, Token } from '../../nexus/index.js';
import type { NotificationManager } from '../../rotif/rotif.js';
import type { RotifModuleOptions } from './rotif.types.js';

/**
 * Token for the Rotif NotificationManager instance
 */
export const ROTIF_MANAGER_TOKEN: Token<NotificationManager> =
  createToken<NotificationManager>('RotifManager');

/**
 * Token for the Rotif module options
 */
export const ROTIF_MODULE_OPTIONS: Token<RotifModuleOptions> =
  createToken<RotifModuleOptions>('RotifModuleOptions');

/**
 * Symbol for internal module options storage
 */
export const ROTIF_OPTIONS_SYMBOL = Symbol('ROTIF_MODULE_OPTIONS');

/**
 * Alias token for backward compatibility
 * @deprecated Use ROTIF_MANAGER_TOKEN instead
 */
export const ROTIF_TOKEN = ROTIF_MANAGER_TOKEN;
