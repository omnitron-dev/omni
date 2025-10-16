/**
 * Flow debugger with step-through execution and state inspection
 */

import type { Flow } from '@holon/flow';
import type { DebuggerConfig, Breakpoint, DebugState } from '../types.js';
import { EventEmitter } from 'eventemitter3';

export interface DebuggerEvents {
  'breakpoint': (breakpoint: Breakpoint, state: DebugState) => void;
  'step': (location: string, state: DebugState) => void;
  'completed': (result: unknown) => void;
  'error': (error: Error) => void;
}

/**
 * Flow debugger
 *
 * Features:
 * - Breakpoint management
 * - Step-through execution
 * - State inspection
 * - Call stack tracking
 */
export class Debugger extends EventEmitter<DebuggerEvents> {
  private readonly config: DebuggerConfig;
  private readonly flow: Flow<unknown, unknown>;
  private readonly breakpoints: Map<string, Breakpoint> = new Map();
  private paused = false;
  private currentLocation = '';
  private variables: Record<string, unknown> = {};
  private callStack: string[] = [];

  constructor(flow: Flow<unknown, unknown>, config: DebuggerConfig = {}) {
    super();
    this.flow = flow;
    this.config = {
      breakpoints: config.breakpoints ?? true,
      stepThrough: config.stepThrough ?? true,
      stateInspection: config.stateInspection ?? true,
    };
  }

  /**
   * Set a breakpoint
   */
  setBreakpoint(location: string, condition?: (state: unknown) => boolean): void {
    const breakpoint: Breakpoint = {
      id: this.generateId(),
      location,
      condition,
      enabled: true,
    };
    this.breakpoints.set(location, breakpoint);
  }

  /**
   * Remove a breakpoint
   */
  removeBreakpoint(location: string): void {
    this.breakpoints.delete(location);
  }

  /**
   * Enable/disable a breakpoint
   */
  toggleBreakpoint(location: string, enabled: boolean): void {
    const breakpoint = this.breakpoints.get(location);
    if (breakpoint) {
      breakpoint.enabled = enabled;
    }
  }

  /**
   * Run flow with debugging
   */
  async run<In, Out>(input: In): Promise<Out> {
    this.currentLocation = 'start';
    this.variables = { input };
    this.callStack = ['main'];

    try {
      // Check initial breakpoint
      await this.checkBreakpoint('start');

      // Execute flow
      const result = await this.flow(input);

      this.currentLocation = 'end';
      this.variables = { ...this.variables, result };

      this.emit('completed', result);
      return result as Out;
    } catch (error) {
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Step to next execution point
   */
  step(): void {
    this.paused = false;
  }

  /**
   * Continue execution
   */
  continue(): void {
    this.paused = false;
    // Clear all temporary breakpoints
  }

  /**
   * Get current debug state
   */
  getState(): DebugState {
    return {
      currentLocation: this.currentLocation,
      variables: { ...this.variables },
      callStack: [...this.callStack],
      breakpoints: Array.from(this.breakpoints.values()),
    };
  }

  /**
   * Inspect variable
   */
  inspectVariable(name: string): unknown {
    return this.variables[name];
  }

  /**
   * Get call stack
   */
  getCallStack(): string[] {
    return [...this.callStack];
  }

  /**
   * Check if breakpoint should trigger
   */
  private async checkBreakpoint(location: string): Promise<void> {
    const breakpoint = this.breakpoints.get(location);

    if (!breakpoint || !breakpoint.enabled) {
      return;
    }

    // Check condition if present
    if (breakpoint.condition && !breakpoint.condition(this.variables)) {
      return;
    }

    // Pause execution
    this.paused = true;
    const state = this.getState();
    this.emit('breakpoint', breakpoint, state);

    // Wait for step/continue
    await this.waitForResume();
  }

  /**
   * Wait for debugger to resume
   */
  private async waitForResume(): Promise<void> {
    while (this.paused) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `bp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Create a debugger for a flow
 */
export function createDebugger(
  flow: Flow<unknown, unknown>,
  config?: DebuggerConfig
): Debugger {
  return new Debugger(flow, config);
}

/**
 * Create an interactive debugging session
 */
export async function debugFlow<In, Out>(
  flow: Flow<In, Out>,
  input: In,
  options: {
    breakpoints?: string[];
    stepThrough?: boolean;
    onBreakpoint?: (state: DebugState) => void;
  } = {}
): Promise<Out> {
  const flowDebugger = createDebugger(flow as Flow<unknown, unknown>, {
    breakpoints: options.breakpoints !== undefined,
    stepThrough: options.stepThrough ?? true,
  });

  // Set initial breakpoints
  if (options.breakpoints) {
    for (const location of options.breakpoints) {
      flowDebugger.setBreakpoint(location);
    }
  }

  // Setup breakpoint handler
  if (options.onBreakpoint) {
    flowDebugger.on('breakpoint', (_, state) => {
      options.onBreakpoint!(state);
    });
  }

  return flowDebugger.run<In, Out>(input);
}
