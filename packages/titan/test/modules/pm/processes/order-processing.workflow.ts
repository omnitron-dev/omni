/**
 * Order Processing Workflow Process
 * Used in real-world scenario tests for e-commerce order processing
 */

import { Workflow, Stage, Compensate } from '../../../../src/modules/pm/decorators.js';
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
  private paymentResult?: { transactionId?: string };
  private inventoryReserved = false;

  @Stage({ name: 'validate-order' })
  async validateOrder(order: Order): Promise<{ valid: boolean; orderId: string }> {
    // Basic validation
    if (!order.items || order.items.length === 0) {
      throw new Error('Order must contain items');
    }

    if (order.total <= 0) {
      throw new Error('Invalid order total');
    }

    this.orderId = order.id;
    return { valid: true, orderId: order.id };
  }

  @Stage({ name: 'reserve-inventory', dependsOn: 'validate-order' })
  async reserveInventory(
    order: Order,
    inventoryService: InventoryService
  ): Promise<{ reserved: boolean }> {
    const reserved = await inventoryService.reserveItems(order.id, order.items);
    if (!reserved) {
      throw new Error('Insufficient inventory');
    }

    this.inventoryReserved = true;
    return { reserved: true };
  }

  @Compensate('reserve-inventory')
  async releaseInventory(order: Order, inventoryService: InventoryService): Promise<void> {
    if (this.inventoryReserved) {
      await inventoryService.releaseReservation(order.id);
      this.inventoryReserved = false;
    }
  }

  @Stage({ name: 'process-payment', dependsOn: 'reserve-inventory' })
  async processPayment(
    order: Order,
    paymentService: PaymentProcessorService
  ): Promise<{ success: boolean; transactionId?: string }> {
    const payment: Payment = {
      orderId: order.id,
      amount: order.total,
      method: 'card',
      status: 'pending'
    };

    this.paymentResult = await paymentService.processPayment(payment);
    return this.paymentResult;
  }

  @Compensate('process-payment')
  async refundPayment(order: Order, paymentService: PaymentProcessorService): Promise<void> {
    if (this.paymentResult?.transactionId) {
      await paymentService.refundPayment(order.id);
    }
  }

  @Stage({ name: 'send-confirmation', dependsOn: 'process-payment' })
  async sendConfirmation(
    order: Order,
    notificationService: NotificationService
  ): Promise<{ sent: boolean }> {
    await notificationService.sendNotification(
      order.userId,
      `Order ${order.id} confirmed. Transaction ID: ${this.paymentResult?.transactionId}`
    );

    return { sent: true };
  }
}