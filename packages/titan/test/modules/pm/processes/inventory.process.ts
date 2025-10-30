/**
 * Inventory Service Process
 * Used in real-world scenario tests for e-commerce order processing
 */

import { Process, Method, Cache } from '../../../../src/modules/pm/decorators.js';

@Process({ name: 'inventory-service', version: '1.0.0' })
export default class InventoryService {
  private inventory = new Map<string, number>([
    ['SKU001', 100],
    ['SKU002', 50],
    ['SKU003', 200],
  ]);
  private reservations = new Map<string, Map<string, number>>();

  @Method()
  @Cache({ ttl: 5000 })
  async checkAvailability(sku: string, quantity: number): Promise<boolean> {
    const available = this.inventory.get(sku) || 0;
    return available >= quantity;
  }

  @Method()
  async reserveItems(orderId: string, items: Array<{ sku: string; quantity: number }>): Promise<boolean> {
    // Check all items are available
    for (const item of items) {
      const available = this.inventory.get(item.sku) || 0;
      if (available < item.quantity) {
        return false;
      }
    }

    // Reserve items
    const reservation = new Map<string, number>();
    for (const item of items) {
      const current = this.inventory.get(item.sku)!;
      this.inventory.set(item.sku, current - item.quantity);
      reservation.set(item.sku, item.quantity);
    }

    this.reservations.set(orderId, reservation);
    return true;
  }

  @Method()
  async releaseReservation(orderId: string): Promise<void> {
    const reservation = this.reservations.get(orderId);
    if (!reservation) return;

    // Return items to inventory
    for (const [sku, quantity] of reservation) {
      const current = this.inventory.get(sku) || 0;
      this.inventory.set(sku, current + quantity);
    }

    this.reservations.delete(orderId);
  }

  @Method()
  async getInventoryLevel(sku: string): Promise<number> {
    return this.inventory.get(sku) || 0;
  }
}
