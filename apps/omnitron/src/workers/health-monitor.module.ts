/**
 * Health Monitor Worker Module
 *
 * Titan @Module for the health monitor worker process.
 * Minimal dependencies — only LoggerModule. The health monitor
 * receives its config (DB URL, node list) via init() parameters
 * from SystemWorkerManager, not from Titan's ConfigModule.
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { LoggerModule } from '@omnitron-dev/titan/module/logger';
import { HealthMonitorService } from './health-monitor.service.js';

@Module({
  imports: [
    LoggerModule.forRoot(),
  ],
  providers: [HealthMonitorService],
})
export class HealthMonitorModule {}
