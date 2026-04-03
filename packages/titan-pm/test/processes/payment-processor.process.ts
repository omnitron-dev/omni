/**
 * Payment Processor Service Process
 * Used in real-world scenario tests for e-commerce order processing
 */

import { Process, Public, CircuitBreaker, HealthCheck } from '../../src/decorators.js';
import type { IHealthStatus } from '../../src/types.js';

interface Payment {
  orderId: string;
  amount: number;
  method: 'card' | 'paypal' | 'crypto';
  transactionId?: string;
  status: 'pending' | 'completed' | 'failed';
}

@Process({ name: 'payment-processor', version: '1.0.0' })
export default class PaymentProcessorService {
  private payments = new Map<string, Payment>();
  private failureCount = 0;
  private simulateFailures = true;
  private failureRate = 0.3;

  /**
   * Control failure simulation for testing
   */
  @Public()
  async setSimulateFailures(enabled: boolean, rate: number = 0.3): Promise<void> {
    this.simulateFailures = enabled;
    this.failureRate = rate;
  }

  /**
   * Reset the service state for testing
   */
  @Public()
  async reset(): Promise<void> {
    this.failureCount = 0;
    this.payments.clear();
  }

  @Public()
  @CircuitBreaker({ threshold: 3, timeout: 5000 })
  async processPayment(payment: Payment): Promise<{ success: boolean; transactionId?: string }> {
    // Simulate payment processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Simulate occasional failures for testing resilience (can be disabled)
    if (this.simulateFailures && this.failureCount < 2 && Math.random() < this.failureRate) {
      this.failureCount++;
      throw new Error('Payment gateway temporarily unavailable');
    }

    this.failureCount = 0;
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    payment.transactionId = transactionId;
    payment.status = 'completed';
    this.payments.set(payment.orderId, payment);

    return { success: true, transactionId };
  }

  @Public()
  async refundPayment(orderId: string): Promise<boolean> {
    const payment = this.payments.get(orderId);
    if (!payment || payment.status !== 'completed') {
      return false;
    }

    // Simulate refund processing
    await new Promise((resolve) => setTimeout(resolve, 50));
    payment.status = 'pending';
    return true;
  }

  @Public()
  async getPaymentStatus(orderId: string): Promise<Payment | null> {
    return this.payments.get(orderId) || null;
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    return {
      status: 'healthy',
      checks: [
        { name: 'payment-gateway', status: 'pass', message: 'Connected' },
        { name: 'database', status: 'pass', message: `${this.payments.size} payments processed` },
      ],
      timestamp: Date.now(),
    };
  }
}
