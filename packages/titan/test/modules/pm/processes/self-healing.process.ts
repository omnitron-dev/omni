/**
 * Self-Healing Service Process
 * Used in resilience pattern tests for self-healing mechanism
 */

import { Process, Public, SelfHeal, HealthCheck } from '../../../../src/modules/pm/decorators.js';
import type { IHealthStatus } from '../../../../src/modules/pm/types.js';

@Process({ name: 'self-healing-service', version: '1.0.0' })
export default class SelfHealingService {
  private errorCount = 0;
  private isHealthy = true;
  private autoRecoveryAttempts = 0;

  @Public()
  @SelfHeal({
    maxAttempts: 3,
    healStrategy: async (error: any, context: any) => {
      // Custom healing logic
      if (error.message.includes('temporary')) {
        await new Promise(resolve => setTimeout(resolve, 100));
        return true; // Healed, can retry
      }
      return false; // Cannot heal
    }
  })
  async processTask(taskId: string, simulateError: boolean = false): Promise<{ success: boolean; taskId: string; recoveryAttempts: number }> {
    if (simulateError && this.autoRecoveryAttempts < 2) {
      this.errorCount++;
      this.autoRecoveryAttempts++;
      throw new Error('Temporary failure - should auto-recover');
    }

    // Process task successfully
    await new Promise(resolve => setTimeout(resolve, 50));

    const recoveryAttempts = this.autoRecoveryAttempts;
    this.autoRecoveryAttempts = 0; // Reset after success

    return {
      success: true,
      taskId,
      recoveryAttempts
    };
  }

  @Public()
  async triggerRecovery(): Promise<{ recovered: boolean }> {
    // Simulate self-recovery mechanism
    await new Promise(resolve => setTimeout(resolve, 100));

    this.isHealthy = true;
    this.errorCount = 0;

    return { recovered: true };
  }

  @Public()
  async getErrorCount(): Promise<number> {
    return this.errorCount;
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    return {
      status: this.isHealthy && this.errorCount < 5 ? 'healthy' : 'degraded',
      checks: [
        {
          name: 'error-rate',
          status: this.errorCount < 5 ? 'pass' : 'warn',
          message: `${this.errorCount} errors recorded`
        }
      ],
      timestamp: Date.now()
    };
  }
}