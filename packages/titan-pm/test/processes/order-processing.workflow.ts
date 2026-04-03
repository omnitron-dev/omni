/**
 * Order Processing Workflow Process
 * Used in real-world scenario tests for e-commerce order processing
 */

import { Workflow, Stage, Compensate } from '../../src/decorators.js';
import type InventoryService from './inventory.process.js';
import type PaymentProcessorService from './payment-processor.process.js';
import type NotificationService from './notification.process.js';

interface Order {
  id: string;
  userId: string;
  items: Array<{ sku: string; quantity: number; price: number }>;
  total: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface Payment {
  orderId: string;
  amount: number;
  method: 'card' | 'paypal' | 'crypto';
  transactionId?: string;
  status: 'pending' | 'completed' | 'failed';
}

@Workflow()
export default class OrderProcessingWorkflow {
  private orderId?: string;
  private order?: Order; // Store the full order for all stages
  private paymentResult?: { transactionId?: string };
  private inventoryReserved = false;

  // Services can be injected via constructor or setter
  private inventoryService?: InventoryService;
  private paymentService?: PaymentProcessorService;
  private notificationService?: NotificationService;

  // Method to set dependencies (for testing)
  setDependencies(deps: {
    inventoryService?: InventoryService;
    paymentService?: PaymentProcessorService;
    notificationService?: NotificationService;
  }) {
    this.inventoryService = deps.inventoryService;
    this.paymentService = deps.paymentService;
    this.notificationService = deps.notificationService;
  }

  @Stage({ name: 'validate-order' })
  async validateOrder(order: Order): Promise<{ valid: boolean; orderId: string }> {
    // Basic validation
    if (!order.items || order.items.length === 0) {
      throw new Error('Order must contain items');
    }

    if (order.total <= 0) {
      throw new Error('Invalid order total');
    }

    // Store the order for use by subsequent stages
    this.order = order;
    this.orderId = order.id;
    return { valid: true, orderId: order.id };
  }

  @Stage({ name: 'reserve-inventory', dependsOn: 'validate-order' })
  async reserveInventory(_prevResult: { valid: boolean; orderId: string }): Promise<{ reserved: boolean }> {
    if (!this.inventoryService) {
      throw new Error('Inventory service not configured');
    }

    // Use the stored order from the workflow instance
    const order = this.order!;
    const reserved = await this.inventoryService.reserveItems(order.id, order.items);
    if (!reserved) {
      throw new Error('Insufficient inventory');
    }

    this.inventoryReserved = true;
    return { reserved: true };
  }

  @Compensate('reserve-inventory')
  async releaseInventory(): Promise<void> {
    if (this.inventoryReserved && this.inventoryService && this.order) {
      await this.inventoryService.releaseReservation(this.order.id);
      this.inventoryReserved = false;
    }
  }

  @Stage({ name: 'process-payment', dependsOn: 'reserve-inventory' })
  async processPayment(_prevResult: { reserved: boolean }): Promise<{ success: boolean; transactionId?: string }> {
    if (!this.paymentService) {
      throw new Error('Payment service not configured');
    }

    // Use the stored order from the workflow instance
    const order = this.order!;
    const payment: Payment = {
      orderId: order.id,
      amount: order.total,
      method: 'card',
      status: 'pending',
    };

    this.paymentResult = await this.paymentService.processPayment(payment);
    return this.paymentResult;
  }

  @Compensate('process-payment')
  async refundPayment(): Promise<void> {
    if (this.paymentResult?.transactionId && this.paymentService && this.order) {
      await this.paymentService.refundPayment(this.order.id);
    }
  }

  @Stage({ name: 'send-confirmation', dependsOn: 'process-payment' })
  async sendConfirmation(_prevResult: { success: boolean; transactionId?: string }): Promise<{ sent: boolean }> {
    if (!this.notificationService) {
      throw new Error('Notification service not configured');
    }

    // Use the stored order from the workflow instance
    const order = this.order!;
    await this.notificationService.sendNotification(
      order.userId,
      `Order ${order.id} confirmed. Transaction ID: ${this.paymentResult?.transactionId}`
    );

    return { sent: true };
  }
}
