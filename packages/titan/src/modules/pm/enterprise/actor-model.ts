/**
 * Actor Model Implementation
 *
 * Provides actor-based concurrency with message passing and supervision
 */

import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';

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
}

/**
 * Actor Context
 */
export interface ActorContext {
  self: ActorRef;
  sender?: ActorRef;
  system: ActorSystem;
  become(behavior: ActorBehavior): void;
  unbecome(): void;
  spawn<T>(ActorClass: new () => T, name?: string): Promise<ActorRef<T>>;
  stop(): void;
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
  RESUME = 'resume'
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
      this.retryMap.set(key, { count: 1, firstError: now });
      return SupervisorAction.RESTART;
    }

    if (now - retryInfo.firstError > this.withinMs) {
      // Reset counter if outside time window
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
 * Actor Instance
 */
class ActorInstance<T extends Actor = Actor> extends EventEmitter {
  private behaviors: ActorBehavior[] = [];
  private mailbox: ActorMessage[] = [];
  private processing = false;
  private stopped = false;
  private children = new Map<string, ActorInstance>();

  constructor(
    public readonly id: string,
    private actor: T,
    private system: ActorSystem
  ) {
    super();
    this.setupContext();
  }

  private setupContext(): void {
    const self = this.createRef();

    const context: ActorContext = {
      self,
      system: this.system,
      become: (behavior) => this.become(behavior),
      unbecome: () => this.unbecome(),
      spawn: async (ActorClass, name) => {
        const child = await this.system.actorOf(ActorClass as new () => Actor, name);
        const childInstance = (this.system as any).actors.get(child.id);
        if (childInstance) {
          this.children.set(child.id, childInstance);
        }
        return child;
      },
      stop: () => this.stop()
    };

    this.actor.context = context;
  }

  public createRef(): ActorRef {
    return {
      id: this.id,
      tell: (message) => this.tell(message),
      ask: (message, timeout) => this.ask(message, timeout),
      stop: () => this.stop()
    };
  }

  async start(): Promise<void> {
    if (this.actor.onStart) {
      await this.actor.onStart();
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    // Stop all children
    for (const child of this.children.values()) {
      await child.stop();
    }

    if (this.actor.onStop) {
      await this.actor.onStop();
    }

    this.removeAllListeners();
  }

  tell(message: any, sender?: ActorRef): void {
    if (this.stopped) return;

    const actorMessage: ActorMessage = {
      id: uuid(),
      type: typeof message === 'object' ? message.type || 'unknown' : 'primitive',
      payload: message,
      from: sender?.id,
      timestamp: Date.now()
    };

    this.mailbox.push(actorMessage);
    this.processMailbox();
  }

  async ask<R>(message: any, timeout = 5000): Promise<R> {
    return new Promise((resolve, reject) => {
      const messageId = uuid();
      const timer = setTimeout(() => {
        this.removeListener(messageId, handleReply);
        reject(new Error(`Ask timeout after ${timeout}ms`));
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
        timestamp: Date.now()
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
          this.actor.context.sender = {
            id: message.from,
            tell: () => {}, // Would be resolved by system
            ask: async <R>() => null as unknown as R,
            stop: async () => {}
          };
        }

        // Use current behavior or default receive
        const behavior = this.behaviors[this.behaviors.length - 1] ||
                        ((msg, ctx) => this.actor.receive(msg, ctx));

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
    const strategy = this.actor.supervisorStrategy();

    // Apply strategy to self (parent would normally do this)
    const action = strategy.decideAction(error, this.createRef());

    switch (action) {
      case SupervisorAction.RESTART:
        await this.restart(error);
        break;
      case SupervisorAction.STOP:
        await this.stop();
        break;
      case SupervisorAction.RESUME:
        // Continue processing
        break;
      case SupervisorAction.ESCALATE:
        // Would escalate to parent
        throw error;
    }
  }

  private async restart(error: Error): Promise<void> {
    if (this.actor.onPreRestart) {
      await this.actor.onPreRestart(error);
    }

    // Clear state
    this.mailbox = [];
    this.behaviors = [];

    // Restart children
    for (const child of this.children.values()) {
      await child.restart(error);
    }

    if (this.actor.onPostRestart) {
      await this.actor.onPostRestart();
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
    name?: string
  ): Promise<ActorRef<T>> {
    const id = name || uuid();

    if (this.actors.has(id)) {
      throw new Error(`Actor ${id} already exists`);
    }

    const actor = new ActorClass();
    const instance = new ActorInstance(id, actor, this);

    this.actors.set(id, instance);
    this.rootActors.add(id);

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
    const stopPromises = Array.from(this.rootActors).map(id => this.stop(id));
    await Promise.all(stopPromises);
  }

  /**
   * Get system metrics
   */
  getMetrics(): any {
    return {
      totalActors: this.actors.size,
      rootActors: this.rootActors.size,
      actors: Array.from(this.actors.keys())
    };
  }
}

/**
 * Router Actors
 */
export class RoundRobinRouter extends Actor {
  private routees: ActorRef[] = [];
  private currentIndex = 0;

  constructor(private routeeCount: number, private RouteeClass: new () => Actor) {
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

  constructor(private routeeCount: number, private RouteeClass: new () => Actor) {
    super();
  }

  override async onStart(): Promise<void> {
    for (let i = 0; i < this.routeeCount; i++) {
      const routee = await this.context.spawn(this.RouteeClass, `routee-${i}`);
      this.routees.push(routee);
    }
  }

  override receive(message: any, context: ActorContext): void {
    this.routees.forEach(routee => routee.tell(message));
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
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
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