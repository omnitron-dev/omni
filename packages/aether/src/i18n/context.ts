/**
 * I18n Context
 *
 * React Context for i18n
 */

import { createContext, provideContext } from '../core/component/context.js';
import type { Context } from '../core/component/context.js';
import type { I18nContext } from './types.js';

/**
 * I18n context
 */
export const I18nContextSymbol: Context<I18nContext | null> = createContext<I18nContext | null>(
  null,
  'I18nContext',
);

/**
 * Provide i18n context
 */
export function provideI18nContext(context: I18nContext): void {
  provideContext(I18nContextSymbol, context);
}
