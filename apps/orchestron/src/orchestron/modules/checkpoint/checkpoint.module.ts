/**
 * Checkpoint Module for Orchestron
 * Manages session checkpoints and restoration
 */

import { Module } from '@omnitron-dev/titan/nexus';

@Module({
  providers: [],
  exports: []
})
export class CheckpointModule {
  readonly name = 'CheckpointModule';
  readonly version = '1.0.0';
}