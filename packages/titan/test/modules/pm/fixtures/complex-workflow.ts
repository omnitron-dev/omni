/**
 * Complex workflow with parallel stages and compensation
 */
import { Workflow, Stage, Compensate } from '../../../../src/modules/pm/decorators.js';

interface OrderData {
  orderId: string;
  amount: number;
  userId: string;
}

@Workflow()
export default class ComplexWorkflow {
  public executionLog: string[] = [];
  public compensationLog: string[] = [];
  private paymentProcessed = false;
  private inventoryReserved = false;

  @Stage({ name: 'validate' })
  async validate(data: OrderData): Promise<{ valid: boolean; orderId: string }> {
    this.executionLog.push('validate');
    if (!data.orderId || !data.userId) {
      throw new Error('Invalid order data');
    }
    return { valid: true, orderId: data.orderId };
  }

  @Stage({ name: 'reserve-inventory', dependsOn: 'validate', parallel: true })
  async reserveInventory(data: any): Promise<{ reserved: boolean }> {
    this.executionLog.push('reserve-inventory');
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.inventoryReserved = true;
    return { reserved: true };
  }

  @Compensate('reserve-inventory')
  async releaseInventory(): Promise<void> {
    this.compensationLog.push('release-inventory');
    if (this.inventoryReserved) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      this.inventoryReserved = false;
    }
  }

  @Stage({ name: 'process-payment', dependsOn: 'validate', parallel: true })
  async processPayment(data: any): Promise<{ paymentId: string }> {
    this.executionLog.push('process-payment');
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.paymentProcessed = true;
    return { paymentId: `PAY-${Date.now()}` };
  }

  @Compensate('process-payment')
  async refundPayment(): Promise<void> {
    this.compensationLog.push('refund-payment');
    if (this.paymentProcessed) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      this.paymentProcessed = false;
    }
  }

  @Stage({ name: 'confirm-order', dependsOn: ['reserve-inventory', 'process-payment'] })
  async confirmOrder(data: any): Promise<{ confirmed: boolean; orderReference: string }> {
    this.executionLog.push('confirm-order');
    return {
      confirmed: true,
      orderReference: `ORD-${Date.now()}`,
    };
  }
}
