/**
 * Session Module for Orchestron
 * Manages Claude Code sessions
 */

import { Module } from '@omnitron-dev/titan/nexus';
import { createToken, Token } from '@omnitron-dev/titan';

export const SESSION_SERVICE_TOKEN: Token<any> = createToken<any>('SessionService');

@Module({
  providers: [],
  exports: []
})
export class SessionModule {
  readonly name = 'SessionModule';
  readonly version = '1.0.0';
}