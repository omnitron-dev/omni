/**
 * Feedback Components Test Suite
 *
 * Tests for feedback components:
 * - Toast
 * - Progress
 * - Skeleton
 * - Spinner
 * - Notification
 * - Stepper
 */

import { describe, it, expect } from 'vitest';

describe('Feedback Components', () => {
  describe('Toast', () => {
    it('should export Toast component', async () => {
      const { Toast } = await import('../../../src/components/feedback/Toast.js');
      expect(Toast).toBeDefined();
    });
  });

  describe('Progress', () => {
    it('should export Progress component', async () => {
      const { Progress } = await import('../../../src/components/feedback/Progress.js');
      expect(Progress).toBeDefined();
    });
  });

  describe('Skeleton', () => {
    it('should export Skeleton component', async () => {
      const { Skeleton } = await import('../../../src/components/feedback/Skeleton.js');
      expect(Skeleton).toBeDefined();
    });
  });

  describe('Spinner', () => {
    it('should export Spinner component', async () => {
      const { Spinner } = await import('../../../src/components/feedback/Spinner.js');
      expect(Spinner).toBeDefined();
    });
  });

  describe('Notification', () => {
    it('should export Notification component', async () => {
      const { Notification } = await import('../../../src/components/feedback/Notification.js');
      expect(Notification).toBeDefined();
    });
  });

  describe('Stepper', () => {
    it('should export Stepper component', async () => {
      const { Stepper } = await import('../../../src/components/feedback/Stepper.js');
      expect(Stepper).toBeDefined();
    });
  });
});
