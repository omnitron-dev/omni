/**
 * Project Module for Orchestron
 * Manages development projects
 */

import { Module } from '@omnitron-dev/titan/nexus';
import { createToken, Token } from '@omnitron-dev/titan';

export const PROJECT_SERVICE_TOKEN: Token<any> = createToken<any>('ProjectService');

@Module({
  providers: [],
  exports: []
})
export class ProjectModule {
  readonly name = 'ProjectModule';
  readonly version = '1.0.0';
}