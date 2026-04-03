/**
 * Inactivity Timeout Tests
 *
 * Tests for inactivity timeout functionality including:
 * - Timeout triggers after inactivity
 * - Activity resets timeout
 * - Custom activity events work
 * - Callback called on timeout
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AuthContext, TokenStorage } from '../../../src/auth/types.js';
import { MemoryTokenStorage } from '../../../src/auth/storage.js';

/**
 * Activity event types that reset the inactivity timer
 */
type ActivityEventType = 'click' | 'keydown' | 'mousemove' | 'scroll' | 'touchstart' | 'custom';

/**
 * Inactivity timeout options
 */
interface InactivityOptions {
  /** Timeout in milliseconds */
  timeout: number;
  /** Activity events to listen for */
  events?: ActivityEventType[];
  /** Callback when timeout occurs */
  onTimeout?: () => void;
  /** Warning callback before timeout */
  onWarning?: (remainingMs: number) => void;
  /** Warning threshold in milliseconds */
  warningThreshold?: number;
  /** Whether to auto-logout on timeout */
  autoLogout?: boolean;
}

/**
 * Auth client with inactivity timeout
 */
class InactivityAuthClient {
  private storage: TokenStorage;
  private token: string | null = null;
  private context: AuthContext | undefined;
  private authenticated = false;
  private eventHandlers = new Map<string, Set<(data: any) => void>>();

  // Inactivity tracking
  private options: Required<InactivityOptions>;
  private timeoutId: number | undefined;
  private warningId: number | undefined;
  private lastActivity: number = Date.now();
  private activityListeners: Array<{ event: string; handler: () => void }> = [];
  private started = false;

  constructor(storage: TokenStorage, options: InactivityOptions) {
    this.storage = storage;
    this.options = {
      timeout: options.timeout,
      events: options.events || ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'],
      onTimeout: options.onTimeout || (() => {}),
      onWarning: options.onWarning || (() => {}),
      warningThreshold: options.warningThreshold || 60000, // 1 minute default
      autoLogout: options.autoLogout !== false,
    };

    this.restoreFromStorage();
  }

  private restoreFromStorage(): void {
    const token = this.storage.getToken();
    if (token) {
      this.token = token;
      this.authenticated = true;
    }
  }

  setAuth(token: string, context?: AuthContext): void {
    this.token = token;
    this.context = context;
    this.authenticated = true;
    this.storage.setToken(token);
    this.startInactivityTimer();
    this.emit('authenticated', { context });
  }

  clearAuth(): void {
    this.token = null;
    this.context = undefined;
    this.authenticated = false;
    this.storage.removeToken();
    this.stopInactivityTimer();
    this.emit('unauthenticated', {});
  }

  getToken(): string | null {
    return this.token;
  }

  getContext(): AuthContext | undefined {
    return this.context;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  getLastActivity(): number {
    return this.lastActivity;
  }

  getTimeSinceLastActivity(): number {
    return Date.now() - this.lastActivity;
  }

  getRemainingTime(): number {
    return Math.max(0, this.options.timeout - this.getTimeSinceLastActivity());
  }

  /**
   * Start inactivity timer and activity listeners
   */
  startInactivityTimer(): void {
    if (this.started) return;
    this.started = true;

    this.lastActivity = Date.now();
    this.setupActivityListeners();
    this.scheduleTimeout();
  }

  /**
   * Stop inactivity timer and remove listeners
   */
  stopInactivityTimer(): void {
    this.started = false;
    this.clearScheduledTimeouts();
    this.removeActivityListeners();
  }

  /**
   * Record activity (can be called manually)
   */
  recordActivity(): void {
    this.lastActivity = Date.now();
    this.emit('activity', { timestamp: this.lastActivity });
    this.scheduleTimeout();
  }

  /**
   * Trigger custom activity event
   */
  triggerCustomActivity(): void {
    if (this.options.events.includes('custom')) {
      this.recordActivity();
    }
  }

  private setupActivityListeners(): void {
    this.removeActivityListeners();

    for (const eventType of this.options.events) {
      if (eventType === 'custom') continue;

      const handler = () => this.recordActivity();
      this.activityListeners.push({ event: eventType, handler });

      if (typeof window !== 'undefined') {
        window.addEventListener(eventType, handler, { passive: true });
      }
    }
  }

  private removeActivityListeners(): void {
    for (const { event, handler } of this.activityListeners) {
      if (typeof window !== 'undefined') {
        window.removeEventListener(event, handler);
      }
    }
    this.activityListeners = [];
  }

  private scheduleTimeout(): void {
    this.clearScheduledTimeouts();

    // Schedule warning
    if (this.options.warningThreshold > 0) {
      const warningDelay = this.options.timeout - this.options.warningThreshold;
      if (warningDelay > 0) {
        this.warningId = window.setTimeout(() => {
          const remaining = this.getRemainingTime();
          this.options.onWarning(remaining);
          this.emit('warning', { remainingMs: remaining });
        }, warningDelay);
      }
    }

    // Schedule timeout
    this.timeoutId = window.setTimeout(() => {
      this.handleTimeout();
    }, this.options.timeout);
  }

  private clearScheduledTimeouts(): void {
    if (this.timeoutId !== undefined) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    if (this.warningId !== undefined) {
      window.clearTimeout(this.warningId);
      this.warningId = undefined;
    }
  }

  private handleTimeout(): void {
    this.options.onTimeout();
    this.emit('timeout', { lastActivity: this.lastActivity });

    if (this.options.autoLogout) {
      this.clearAuth();
    }
  }

  on(event: string, handler: (data: any) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: string, handler: (data: any) => void): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  private emit(event: string, data: any): void {
    this.eventHandlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in ${event} handler:`, error);
      }
    });
  }

  destroy(): void {
    this.stopInactivityTimer();
    this.eventHandlers.clear();
  }
}

describe('Inactivity Timeout', () => {
  let storage: MemoryTokenStorage;
  let client: InactivityAuthClient;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = new MemoryTokenStorage();
  });

  afterEach(() => {
    client?.destroy();
    vi.useRealTimers();
  });

  describe('timeout triggers after inactivity', () => {
    it('should trigger timeout after specified duration', () => {
      const onTimeout = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 5000, // 5 seconds
        onTimeout,
        autoLogout: false,
      });

      client.setAuth('test-token');

      // Advance time past timeout
      vi.advanceTimersByTime(5001);

      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('should emit timeout event', () => {
      client = new InactivityAuthClient(storage, {
        timeout: 3000,
        autoLogout: false,
      });

      const timeoutHandler = vi.fn();
      client.on('timeout', timeoutHandler);

      client.setAuth('test-token');
      vi.advanceTimersByTime(3001);

      expect(timeoutHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          lastActivity: expect.any(Number),
        })
      );
    });

    it('should auto-logout on timeout when enabled', () => {
      client = new InactivityAuthClient(storage, {
        timeout: 2000,
        autoLogout: true,
      });

      client.setAuth('test-token');
      expect(client.isAuthenticated()).toBe(true);

      vi.advanceTimersByTime(2001);

      expect(client.isAuthenticated()).toBe(false);
      expect(client.getToken()).toBeNull();
    });

    it('should not auto-logout when disabled', () => {
      client = new InactivityAuthClient(storage, {
        timeout: 2000,
        autoLogout: false,
      });

      client.setAuth('test-token');

      vi.advanceTimersByTime(2001);

      expect(client.isAuthenticated()).toBe(true);
      expect(client.getToken()).toBe('test-token');
    });

    it('should track time since last activity', () => {
      client = new InactivityAuthClient(storage, {
        timeout: 10000,
        autoLogout: false,
      });

      client.setAuth('test-token');
      expect(client.getTimeSinceLastActivity()).toBe(0);

      vi.advanceTimersByTime(5000);
      expect(client.getTimeSinceLastActivity()).toBe(5000);

      vi.advanceTimersByTime(3000);
      expect(client.getTimeSinceLastActivity()).toBe(8000);
    });

    it('should calculate remaining time correctly', () => {
      client = new InactivityAuthClient(storage, {
        timeout: 10000,
        autoLogout: false,
      });

      client.setAuth('test-token');
      expect(client.getRemainingTime()).toBe(10000);

      vi.advanceTimersByTime(3000);
      expect(client.getRemainingTime()).toBe(7000);

      vi.advanceTimersByTime(7000);
      expect(client.getRemainingTime()).toBe(0);
    });
  });

  describe('activity resets timeout', () => {
    it('should reset timeout on activity', () => {
      const onTimeout = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 5000,
        onTimeout,
        autoLogout: false,
      });

      client.setAuth('test-token');

      // Advance 3 seconds
      vi.advanceTimersByTime(3000);
      expect(onTimeout).not.toHaveBeenCalled();

      // Record activity (resets timer)
      client.recordActivity();

      // Advance another 3 seconds (would have been 6 total without reset)
      vi.advanceTimersByTime(3000);
      expect(onTimeout).not.toHaveBeenCalled();

      // Advance 2 more seconds to trigger timeout
      vi.advanceTimersByTime(2001);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('should emit activity event', () => {
      client = new InactivityAuthClient(storage, {
        timeout: 5000,
        autoLogout: false,
      });

      const activityHandler = vi.fn();
      client.on('activity', activityHandler);

      client.setAuth('test-token');
      client.recordActivity();

      expect(activityHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Number),
        })
      );
    });

    it('should update last activity timestamp', () => {
      client = new InactivityAuthClient(storage, {
        timeout: 10000,
        autoLogout: false,
      });

      client.setAuth('test-token');
      const initialActivity = client.getLastActivity();

      vi.advanceTimersByTime(5000);
      client.recordActivity();

      expect(client.getLastActivity()).toBe(initialActivity + 5000);
    });

    it('should handle multiple activity resets', () => {
      const onTimeout = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 3000,
        onTimeout,
        autoLogout: false,
      });

      client.setAuth('test-token');

      // Keep resetting every 2 seconds, timeout should never fire
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(2000);
        client.recordActivity();
      }

      expect(onTimeout).not.toHaveBeenCalled();

      // Now let it timeout
      vi.advanceTimersByTime(3001);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });
  });

  describe('custom activity events', () => {
    it('should respond to custom activity event', () => {
      const onTimeout = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 5000,
        events: ['custom'],
        onTimeout,
        autoLogout: false,
      });

      client.setAuth('test-token');

      vi.advanceTimersByTime(3000);
      client.triggerCustomActivity();

      vi.advanceTimersByTime(3000);
      expect(onTimeout).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2001);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('should ignore custom activity when not in events list', () => {
      const onTimeout = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 3000,
        events: ['click', 'keydown'], // No 'custom'
        onTimeout,
        autoLogout: false,
      });

      client.setAuth('test-token');

      vi.advanceTimersByTime(2000);
      client.triggerCustomActivity(); // Should be ignored

      vi.advanceTimersByTime(1001);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('should support mixed event types', () => {
      client = new InactivityAuthClient(storage, {
        timeout: 5000,
        events: ['click', 'custom', 'keydown'],
        autoLogout: false,
      });

      const activityHandler = vi.fn();
      client.on('activity', activityHandler);

      client.setAuth('test-token');

      // Trigger custom activity
      client.triggerCustomActivity();
      expect(activityHandler).toHaveBeenCalledTimes(1);

      // Manual activity
      client.recordActivity();
      expect(activityHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('callback on timeout', () => {
    it('should call onTimeout callback', () => {
      const onTimeout = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 1000,
        onTimeout,
        autoLogout: false,
      });

      client.setAuth('test-token');
      vi.advanceTimersByTime(1001);

      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('should call onWarning before timeout', () => {
      const onWarning = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 5000,
        warningThreshold: 2000, // Warn 2 seconds before timeout
        onWarning,
        autoLogout: false,
      });

      client.setAuth('test-token');

      // Warning should fire at 3 seconds (5000 - 2000)
      vi.advanceTimersByTime(3001);
      expect(onWarning).toHaveBeenCalledTimes(1);
      expect(onWarning).toHaveBeenCalledWith(expect.any(Number));
    });

    it('should emit warning event with remaining time', () => {
      client = new InactivityAuthClient(storage, {
        timeout: 10000,
        warningThreshold: 3000,
        autoLogout: false,
      });

      const warningHandler = vi.fn();
      client.on('warning', warningHandler);

      client.setAuth('test-token');

      vi.advanceTimersByTime(7001);

      expect(warningHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          remainingMs: expect.any(Number),
        })
      );
    });

    it('should reset warning timer on activity', () => {
      const onWarning = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 5000,
        warningThreshold: 2000,
        onWarning,
        autoLogout: false,
      });

      client.setAuth('test-token');

      // Almost to warning time
      vi.advanceTimersByTime(2900);
      expect(onWarning).not.toHaveBeenCalled();

      // Activity resets timers
      client.recordActivity();

      // Advance to what would have been warning time
      vi.advanceTimersByTime(200);
      expect(onWarning).not.toHaveBeenCalled();

      // Now wait for new warning time (3000ms from activity)
      vi.advanceTimersByTime(2900);
      expect(onWarning).toHaveBeenCalledTimes(1);
    });
  });

  describe('timer lifecycle', () => {
    it('should start timer on setAuth', () => {
      const onTimeout = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 2000,
        onTimeout,
        autoLogout: false,
      });

      // Timer not started yet
      vi.advanceTimersByTime(2001);
      expect(onTimeout).not.toHaveBeenCalled();

      // Start by setting auth
      client.setAuth('test-token');
      vi.advanceTimersByTime(2001);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('should stop timer on clearAuth', () => {
      const onTimeout = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 3000,
        onTimeout,
        autoLogout: false,
      });

      client.setAuth('test-token');

      vi.advanceTimersByTime(1000);
      client.clearAuth();

      // Timer should be stopped, timeout should not fire
      vi.advanceTimersByTime(5000);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('should stop timer on destroy', () => {
      const onTimeout = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 2000,
        onTimeout,
        autoLogout: false,
      });

      client.setAuth('test-token');
      client.destroy();

      vi.advanceTimersByTime(5000);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('should only start timer once', () => {
      const onTimeout = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 2000,
        onTimeout,
        autoLogout: false,
      });

      // Start multiple times
      client.setAuth('test-token');
      client.startInactivityTimer();
      client.startInactivityTimer();

      vi.advanceTimersByTime(2001);

      // Should only fire once
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge cases', () => {
    it('should handle zero timeout', () => {
      const onTimeout = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 0,
        onTimeout,
        autoLogout: false,
      });

      client.setAuth('test-token');

      // Should fire immediately (or on next tick)
      vi.advanceTimersByTime(1);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('should handle very long timeout', () => {
      const onTimeout = vi.fn();
      const oneHour = 60 * 60 * 1000;

      client = new InactivityAuthClient(storage, {
        timeout: oneHour,
        onTimeout,
        autoLogout: false,
      });

      client.setAuth('test-token');

      vi.advanceTimersByTime(oneHour - 1);
      expect(onTimeout).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('should handle warning threshold greater than timeout', () => {
      const onWarning = vi.fn();

      client = new InactivityAuthClient(storage, {
        timeout: 3000,
        warningThreshold: 5000, // Greater than timeout
        onWarning,
        autoLogout: false,
      });

      client.setAuth('test-token');

      vi.advanceTimersByTime(3001);

      // Warning should not have been called since warningDelay would be negative
      expect(onWarning).not.toHaveBeenCalled();
    });
  });
});
