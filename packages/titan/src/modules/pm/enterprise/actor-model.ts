/**
 * Actor Model Implementation
 *
 * Provides actor-based concurrency with message passing and supervision
 */

import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';

import { Errors } from '../../../errors/index.js';
/**
 * Actor Message
 */
export interface ActorMessage<T = any> {
  id: string;
  type: string;
  payload: T;
  from?: string;
  timestamp: number;
}

/**
 * Actor Reference
 */
export interface ActorRef<T = any> {
  id: string;
  tell(message: any): void;
  ask<R>(message: any, timeout?: number): Promise<R>;
  stop(): Promise<void>;
  link(other: ActorRef): void;
  unlink(other: ActorRef): void;
  monitor(other: ActorRef): string;
  demonitor(monitorRef: string): void;
}

/**
 * Actor Context
 */
export interface ActorContext {
  self: ActorRef;
  sender?: ActorRef;
  parent?: ActorRef;
  system: ActorSystem;
  become(behavior: ActorBehavior): void;
  unbecome(): void;
  spawn<T>(ActorClass: new () => T, name?: string): Promise<ActorRef<T>>;
  stop(): void;
  link(other: ActorRef): void;
  unlink(other: ActorRef): void;
  monitor(other: ActorRef): string;
  demonitor(monitorRef: string): void;
}

/**
 * Actor Behavior
 */
export type ActorBehavior = (message: any, context: ActorContext) => void | Promise<void>;

/**
 * Actor Supervisor Strategy
 */
export interface SupervisorStrategy {
  decideAction(error: Error, child: ActorRef): SupervisorAction;
}

export enum SupervisorAction {
  RESTART = 'restart',
  STOP = 'stop',
  ESCALATE = 'escalate',
  RESUME = 'resume',
}

/**
 * Base Actor Class
 */
export abstract class Actor {
  public context: ActorContext = null!;
  protected behaviors: ActorBehavior[] = [];

  /**
   * Called when actor is started
   */
  onStart?(): void | Promise<void>;

  /**
   * Called when actor is stopped
   */
  onStop?(): void | Promise<void>;

  /**
   * Called before restart
   */
  onPreRestart?(error: Error): void | Promise<void>;

  /**
   * Called after restart
   */
  onPostRestart?(): void | Promise<void>;

  /**
   * Main message handler
   */
  abstract receive(message: any, context: ActorContext): void | Promise<void>;

  /**
   * Supervisor strategy for child actors
   */
  supervisorStrategy(): SupervisorStrategy {
    return new OneForOneStrategy();
  }
}

/**
 * One-for-One Supervisor Strategy
 */
export class OneForOneStrategy implements SupervisorStrategy {
  constructor(
    private maxRetries: number = 3,
    private withinMs: number = 60000
  ) {}

  private retryMap = new Map<string, { count: number; firstError: number }>();

  decideAction(error: Error, child: ActorRef): SupervisorAction {
    const key = child.id;
    const now = Date.now();
    const retryInfo = this.retryMap.get(key);

    if (!retryInfo) {
      // First error for this child
      if (this.maxRetries === 0) {
        // No retries allowed, stop immediately
        return SupervisorAction.STOP;
      }
      this.retryMap.set(key, { count: 1, firstError: now });
      return SupervisorAction.RESTART;
    }

    if (now - retryInfo.firstError > this.withinMs) {
      // Reset counter if outside time window
      if (this.maxRetries === 0) {
        return SupervisorAction.STOP;
      }
      this.retryMap.set(key, { count: 1, firstError: now });
      return SupervisorAction.RESTART;
    }

    retryInfo.count++;
    if (retryInfo.count > this.maxRetries) {
      this.retryMap.delete(key);
      return SupervisorAction.STOP;
    }

    return SupervisorAction.RESTART;
  }
}

/**
 * All-for-One Supervisor Strategy
 */
export class AllForOneStrategy implements SupervisorStrategy {
  constructor(
    private maxRetries: number = 3,
    private withinMs: number = 60000
  ) {}

  private errorCount = 0;
  private firstError?: number;

  decideAction(error: Error, child: ActorRef): SupervisorAction {
    const now = Date.now();

    if (!this.firstError) {
      this.firstError = now;
      this.errorCount = 1;
      return SupervisorAction.RESTART;
    }

    if (now - this.firstError > this.withinMs) {
      this.firstError = now;
      this.errorCount = 1;
      return SupervisorAction.RESTART;
    }

    this.errorCount++;
    if (this.errorCount > this.maxRetries) {
      return SupervisorAction.STOP;
    }

    return SupervisorAction.RESTART;
  }
}

/**
 * Terminated message
 */
export interface TerminatedMessage {
  type: 'Terminated';
  actorId: string;
  reason?: Error;
}

/**
 * Monitor reference
 */
interface MonitorRef {
  id: string;
  watcher: string;
  watched: string;
}

/**
 * Actor Instance
 */
class ActorInstance<T extends Actor = Actor> extends EventEmitter {
  private behaviors: ActorBehavior[] = [];
  private mailbox: ActorMessage[] = [];
  private processing = false;
  private stopped = false;
  private children = new Map<string, ActorInstance>();
  private parent?: ActorInstance;
  private linkedActors = new Set<string>();
  private monitors = new Map<string, MonitorRef>();
  private watchedBy = new Set<string>();

  constructor(
    public readonly id: string,
    private actor: T,
    private system: ActorSystem,
    parent?: ActorInstance
  ) {
    super();
    this.parent = parent;
    this.setupContext();
  }

  private setupContext(): void {
    const self = this.createRef();

    const context: ActorContext = {
      self,
      parent: this.parent?.createRef(),
      system: this.system,
      become: (behavior) => this.become(behavior),
      unbecome: () => this.unbecome(),
      spawn: async (ActorClass, name) => {
        const child = await this.system.actorOf(ActorClass as new () => Actor, name, this);
        const childInstance = (this.system as any).actors.get(child.id);
        if (childInstance) {
          this.children.set(child.id, childInstance);
        }
        return child;
      },
      stop: () => this.stop(),
      link: (other) => this.link(other),
      unlink: (other) => this.unlink(other),
      monitor: (other) => this.monitor(other),
      demonitor: (ref) => this.demonitor(ref),
    };

    this.actor.context = context;
  }

  public createRef(): ActorRef {
    return {
      id: this.id,
      tell: (message) => this.tell(message),
      ask: (message, timeout) => this.ask(message, timeout),
      stop: () => this.stop(),
      link: (other) => this.link(other),
      unlink: (other) => this.unlink(other),
      monitor: (other) => this.monitor(other),
      demonitor: (ref) => this.demonitor(ref),
    };
  }

  async start(): Promise<void> {
    if (this.actor.onStart) {
      await this.actor.onStart();
    }
  }

  link(other: ActorRef): void {
    this.linkedActors.add(other.id);
    const otherInstance = (this.system as any).actors.get(other.id);
    if (otherInstance) {
      otherInstance.linkedActors.add(this.id);
    }
  }

  unlink(other: ActorRef): void {
    this.linkedActors.delete(other.id);
    const otherInstance = (this.system as any).actors.get(other.id);
    if (otherInstance) {
      otherInstance.linkedActors.delete(this.id);
    }
  }

  monitor(other: ActorRef): string {
    const monitorId = uuid();
    const ref: MonitorRef = {
      id: monitorId,
      watcher: this.id,
      watched: other.id,
    };
    this.monitors.set(monitorId, ref);

    const otherInstance = (this.system as any).actors.get(other.id);
    if (otherInstance) {
      otherInstance.watchedBy.add(this.id);
    }

    return monitorId;
  }

  demonitor(monitorRef: string): void {
    const ref = this.monitors.get(monitorRef);
    if (ref) {
      this.monitors.delete(monitorRef);
      const otherInstance = (this.system as any).actors.get(ref.watched);
      if (otherInstance) {
        otherInstance.watchedBy.delete(this.id);
      }
    }
  }

  async stop(reason?: Error): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    // Notify linked actors (crash propagation)
    for (const linkedId of this.linkedActors) {
      const linked = (this.system as any).actors.get(linkedId);
      if (linked && !linked.stopped) {
        await linked.stop(reason || new Error(`Linked actor ${this.id} terminated`));
      }
    }

    // Notify monitors (death watch)
    for (const watcherId of this.watchedBy) {
      const watcher = (this.system as any).actors.get(watcherId);
      if (watcher && !watcher.stopped) {
        const terminatedMsg: TerminatedMessage = {
          type: 'Terminated',
          actorId: this.id,
          reason,
        };
        watcher.tell(terminatedMsg);
      }
    }

    // Stop all children
    for (const child of this.children.values()) {
      await child.stop(reason);
    }

    if (this.actor.onStop) {
      await this.actor.onStop();
    }

    this.removeAllListeners();

    // Clean up from system
    (this.system as any).actors.delete(this.id);
    (this.system as any).rootActors.delete(this.id);
  }

  tell(message: any, sender?: ActorRef): void {
    if (this.stopped) return;

    const actorMessage: ActorMessage = {
      id: uuid(),
      type: typeof message === 'object' ? message.type || 'unknown' : 'primitive',
      payload: message,
      from: sender?.id,
      timestamp: Date.now(),
    };

    this.mailbox.push(actorMessage);
    this.processMailbox();
  }

  async ask<R>(message: any, timeout = 5000): Promise<R> {
    return new Promise((resolve, reject) => {
      const messageId = uuid();
      const timer = setTimeout(() => {
        this.removeListener(messageId, handleReply);
        reject(Errors.timeout('actor ask', timeout));
      }, timeout);

      const handleReply = (reply: any) => {
        clearTimeout(timer);
        resolve(reply);
      };

      this.once(messageId, handleReply);

      const actorMessage: ActorMessage = {
        id: messageId,
        type: typeof message === 'object' ? message.type || 'unknown' : 'primitive',
        payload: message,
        timestamp: Date.now(),
      };

      this.mailbox.push(actorMessage);
      this.processMailbox();
    });
  }

  private async processMailbox(): Promise<void> {
    if (this.processing || this.stopped || this.mailbox.length === 0) {
      return;
    }

    this.processing = true;

    while (this.mailbox.length > 0 && !this.stopped) {
      const message = this.mailbox.shift()!;

      try {
        // Update context with current sender
        if (message.from) {
          const senderInstance = (this.system as any).actors.get(message.from);
          this.actor.context.sender = senderInstance ? senderInstance.createRef() : undefined;
        }

        // Use current behavior or default receive
        const behavior = this.behaviors[this.behaviors.length - 1] || ((msg, ctx) => this.actor.receive(msg, ctx));

        const result = await behavior(message.payload, this.actor.context);

        // If message has an ID, it's an ask - send reply
        if (message.id && result !== undefined) {
          this.emit(message.id, result);
        }
      } catch (error) {
        await this.handleError(error as Error);
      }
    }

    this.processing = false;
  }

  private async handleError(error: Error): Promise<void> {
    // If there's a parent, let parent handle supervision
    if (this.parent) {
      const strategy = this.parent.actor.supervisorStrategy();
      const action = strategy.decideAction(error, this.createRef());

      switch (action) {
        case SupervisorAction.RESTART:
          // Check if AllForOne - restart all siblings
          if (strategy instanceof AllForOneStrategy) {
            // Parent restarts all children
            for (const child of this.parent.children.values()) {
              await child.restart(error);
            }
          } else {
            // OneForOne - restart only this child
            await this.restart(error);
          }
          break;
        case SupervisorAction.STOP:
          await this.stop(error);
          break;
        case SupervisorAction.RESUME:
          // Continue processing
          break;
        case SupervisorAction.ESCALATE:
          // Escalate to grandparent or crash
          if (this.parent.parent) {
            await this.parent.handleError(error);
          } else {
            await this.stop(error);
          }
          break;
        default:
          throw Errors.notFound(`Unknown supervisor action: ${action}`);
      }
    } else {
      // No parent, handle ourselves
      const strategy = this.actor.supervisorStrategy();
      const action = strategy.decideAction(error, this.createRef());

      switch (action) {
        case SupervisorAction.RESTART:
          await this.restart(error);
          break;
        case SupervisorAction.STOP:
          await this.stop(error);
          break;
        case SupervisorAction.RESUME:
          // Continue processing
          break;
        default:
          await this.stop(error);
      }
    }
  }

  async restart(error: Error): Promise<void> {
    if (this.actor.onPreRestart) {
      await this.actor.onPreRestart(error);
    }

    // Clear state
    this.mailbox = [];
    this.behaviors = [];
    this.processing = false;

    if (this.actor.onPostRestart) {
      await this.actor.onPostRestart();
    }

    // Resume processing
    if (this.mailbox.length > 0) {
      this.processMailbox();
    }
  }

  private become(behavior: ActorBehavior): void {
    this.behaviors.push(behavior);
  }

  private unbecome(): void {
    if (this.behaviors.length > 0) {
      this.behaviors.pop();
    }
  }
}

/**
 * Actor System
 */
export class ActorSystem {
  private actors = new Map<string, ActorInstance>();
  private rootActors = new Set<string>();

  constructor(
    private name: string = 'default',
    private config: any = {}
  ) {}

  /**
   * Create an actor
   */
  async actorOf<T extends Actor>(
    ActorClass: new () => T,
    name?: string,
    parent?: ActorInstance
  ): Promise<ActorRef<T>> {
    const id = name || uuid();

    if (this.actors.has(id)) {
      throw Errors.notFound(`Actor ${id} already exists`);
    }

    const actor = new ActorClass();
    const instance = new ActorInstance(id, actor, this, parent);

    this.actors.set(id, instance);

    if (!parent) {
      this.rootActors.add(id);
    }

    await instance.start();

    return instance.createRef() as any;
  }

  /**
   * Get actor by ID
   */
  actorFor(id: string): ActorRef | undefined {
    const instance = this.actors.get(id);
    return instance?.createRef() as any;
  }

  /**
   * Stop an actor
   */
  async stop(id: string): Promise<void> {
    const instance = this.actors.get(id);
    if (instance) {
      await instance.stop();
      this.actors.delete(id);
      this.rootActors.delete(id);
    }
  }

  /**
   * Shutdown the system
   */
  async shutdown(): Promise<void> {
    // Stop all root actors (they will stop their children)
    const stopPromises = Array.from(this.rootActors).map((id) => this.stop(id));
    await Promise.all(stopPromises);
  }

  /**
   * Get system metrics
   */
  getMetrics(): any {
    return {
      totalActors: this.actors.size,
      rootActors: this.rootActors.size,
      actors: Array.from(this.actors.keys()),
    };
  }
}

/**
 * Router Actors
 */
export class RoundRobinRouter extends Actor {
  private routees: ActorRef[] = [];
  private currentIndex = 0;

  constructor(
    private routeeCount: number,
    private RouteeClass: new () => Actor
  ) {
    super();
  }

  override async onStart(): Promise<void> {
    // Create routees
    for (let i = 0; i < this.routeeCount; i++) {
      const routee = await this.context.spawn(this.RouteeClass, `routee-${i}`);
      this.routees.push(routee);
    }
  }

  override receive(message: any, context: ActorContext): void {
    if (this.routees.length === 0) return;

    const routee = this.routees[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.routees.length;

    routee?.tell(message);
  }
}

/**
 * Broadcast Router
 */
export class BroadcastRouter extends Actor {
  private routees: ActorRef[] = [];

  constructor(
    private routeeCount: number,
    private RouteeClass: new () => Actor
  ) {
    super();
  }

  override async onStart(): Promise<void> {
    for (let i = 0; i < this.routeeCount; i++) {
      const routee = await this.context.spawn(this.RouteeClass, `routee-${i}`);
      this.routees.push(routee);
    }
  }

  override receive(message: any, context: ActorContext): void {
    this.routees.forEach((routee) => routee.tell(message));
  }
}

/**
 * Consistent Hash Router
 */
export class ConsistentHashRouter extends Actor {
  private routees: ActorRef[] = [];
  private hashRing = new Map<number, ActorRef>();

  constructor(
    private routeeCount: number,
    private RouteeClass: new () => Actor,
    private hashFunction: (message: any) => string
  ) {
    super();
  }

  override async onStart(): Promise<void> {
    for (let i = 0; i < this.routeeCount; i++) {
      const routee = await this.context.spawn(this.RouteeClass, `routee-${i}`);
      this.routees.push(routee);

      // Add to hash ring
      const hash = this.hash(`routee-${i}`);
      this.hashRing.set(hash, routee);
    }
  }

  override receive(message: any, context: ActorContext): void {
    const key = this.hashFunction(message);
    const hash = this.hash(key);

    // Find closest node in hash ring
    const routee = this.findClosestNode(hash);
    routee?.tell(message);
  }

  private hash(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash << 5) - hash + key.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private findClosestNode(hash: number): ActorRef | undefined {
    const hashes = Array.from(this.hashRing.keys()).sort((a, b) => a - b);

    for (const h of hashes) {
      if (h >= hash) {
        return this.hashRing.get(h);
      }
    }

    // Wrap around to first node
    return this.hashRing.get(hashes[0]!);
  }
}

/**
 * Export convenience functions
 */
export function createActorSystem(name?: string, config?: any): ActorSystem {
  return new ActorSystem(name, config);
}
