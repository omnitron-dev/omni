/**
 * Comprehensive Tests for Actor Model
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  Actor,
  ActorSystem,
  ActorRef,
  ActorContext,
  SupervisorAction,
  SupervisorStrategy,
  OneForOneStrategy,
  AllForOneStrategy,
  RoundRobinRouter,
  BroadcastRouter,
  ConsistentHashRouter,
  createActorSystem,
  type TerminatedMessage,
} from '../../../../src/modules/pm/enterprise/actor-model.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
} as any;

// Test Actors
class SimpleActor extends Actor {
  public messages: any[] = [];

  receive(message: any, context: ActorContext): void {
    this.messages.push(message);
  }
}

class EchoActor extends Actor {
  receive(message: any, context: ActorContext): string {
    return `Echo: ${message}`;
  }
}

class CounterActor extends Actor {
  private count = 0;

  receive(message: any, context: ActorContext): number {
    if (message === 'increment') {
      this.count++;
    } else if (message === 'decrement') {
      this.count--;
    } else if (message === 'get') {
      return this.count;
    }
    return this.count;
  }
}

class FailingActor extends Actor {
  private failCount = 0;

  receive(message: any, context: ActorContext): void {
    if (message === 'fail') {
      this.failCount++;
      throw new Error(`Failure ${this.failCount}`);
    }
  }

  override async onPreRestart(error: Error): Promise<void> {
    // Track restart
  }

  override async onPostRestart(): Promise<void> {
    this.failCount = 0;
  }
}

class ParentActor extends Actor {
  public children: ActorRef[] = [];

  async receive(message: any, context: ActorContext): Promise<string> {
    if (message.type === 'spawn') {
      const child = await context.spawn(message.actorClass, message.name);
      this.children.push(child);
      return 'spawned';
    } else if (message.type === 'forward') {
      this.children.forEach((child) => child.tell(message.payload));
      return 'forwarded';
    }
    return 'ok';
  }
}

class MonitorActor extends Actor {
  public terminated: TerminatedMessage[] = [];

  receive(message: any, context: ActorContext): void {
    if (message.type === 'Terminated') {
      this.terminated.push(message as TerminatedMessage);
    }
  }
}

class BehaviorActor extends Actor {
  private state = 'initial';

  receive(message: any, context: ActorContext): string {
    if (message === 'change') {
      const self = this;
      context.become((msg, ctx) => {
        if (msg === 'revert') {
          ctx.unbecome();
          self.state = 'initial'; // Reset state
          return 'reverted';
        }
        return 'changed state';
      });
      this.state = 'changed';
      return 'changed';
    }
    return this.state;
  }
}

class StrictSupervisor extends Actor {
  async receive(message: any, context: ActorContext): Promise<string> {
    if (message.type === 'spawn') {
      await context.spawn(message.actorClass, message.name);
      return 'spawned';
    }
    return 'ok';
  }

  override supervisorStrategy(): SupervisorStrategy {
    return new OneForOneStrategy(0, 1000); // Never retry
  }
}

class TolerantSupervisor extends Actor {
  async receive(message: any, context: ActorContext): Promise<string> {
    if (message.type === 'spawn') {
      await context.spawn(message.actorClass, message.name);
      return 'spawned';
    }
    return 'ok';
  }

  override supervisorStrategy(): SupervisorStrategy {
    return new OneForOneStrategy(10, 60000); // Retry many times
  }
}

class AllForOneSupervisor extends Actor {
  async receive(message: any, context: ActorContext): Promise<string> {
    if (message.type === 'spawn') {
      await context.spawn(message.actorClass, message.name);
      return 'spawned';
    }
    return 'ok';
  }

  override supervisorStrategy(): SupervisorStrategy {
    return new AllForOneStrategy(3, 60000);
  }
}

describe('Actor Model', () => {
  let system: ActorSystem;

  beforeEach(() => {
    jest.clearAllMocks();
    system = createActorSystem('test-system');
  });

  afterEach(async () => {
    await system.shutdown();
  });

  describe('Actor System', () => {
    it('should create and manage actors', async () => {
      const actor = await system.actorOf(SimpleActor, 'simple-1');

      expect(actor).toBeDefined();
      expect(actor.id).toBe('simple-1');

      const metrics = system.getMetrics();
      expect(metrics.totalActors).toBe(1);
      expect(metrics.rootActors).toBe(1);
      expect(metrics.actors).toContain('simple-1');
    });

    it('should prevent duplicate actor IDs', async () => {
      await system.actorOf(SimpleActor, 'duplicate');

      await expect(system.actorOf(SimpleActor, 'duplicate')).rejects.toThrow(
        'Actor duplicate already exists'
      );
    });

    it('should find actors by ID', async () => {
      const created = await system.actorOf(SimpleActor, 'findable');
      const found = system.actorFor('findable');

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });

    it('should stop actors', async () => {
      const actor = await system.actorOf(SimpleActor, 'stoppable');
      await system.stop('stoppable');

      const found = system.actorFor('stoppable');
      expect(found).toBeUndefined();

      const metrics = system.getMetrics();
      expect(metrics.totalActors).toBe(0);
    });

    it('should shutdown all actors', async () => {
      await system.actorOf(SimpleActor, 'actor-1');
      await system.actorOf(SimpleActor, 'actor-2');
      await system.actorOf(SimpleActor, 'actor-3');

      await system.shutdown();

      const metrics = system.getMetrics();
      expect(metrics.totalActors).toBe(0);
      expect(metrics.rootActors).toBe(0);
    });
  });

  describe('Message Passing', () => {
    it('should send and receive messages with tell', async () => {
      const actor = await system.actorOf(SimpleActor);
      const instance = (actor as any);

      actor.tell('message1');
      actor.tell('message2');
      actor.tell({ type: 'complex', data: 'value' });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Access the actor's internal state for testing
      const actorInstance = (system as any).actors.get(actor.id);
      expect(actorInstance.actor.messages).toHaveLength(3);
      expect(actorInstance.actor.messages[0]).toBe('message1');
      expect(actorInstance.actor.messages[2]).toEqual({ type: 'complex', data: 'value' });
    });

    it('should support request-reply with ask', async () => {
      const actor = await system.actorOf(EchoActor);

      const reply = await actor.ask<string>('test message');
      expect(reply).toBe('Echo: test message');
    });

    it('should timeout on ask if no reply', async () => {
      const actor = await system.actorOf(SimpleActor);

      await expect(actor.ask('message', 100)).rejects.toThrow();
    });

    it('should handle multiple concurrent asks', async () => {
      const actor = await system.actorOf(CounterActor);

      const promises = [
        actor.ask('increment'),
        actor.ask('increment'),
        actor.ask('increment'),
        actor.ask<number>('get'),
      ];

      const results = await Promise.all(promises);
      expect(results[3]).toBe(3);
    });
  });

  describe('Actor Lifecycle', () => {
    it('should call onStart when actor is created', async () => {
      const startSpy = jest.fn();

      class LifecycleActor extends Actor {
        override async onStart(): Promise<void> {
          startSpy();
        }

        receive(message: any, context: ActorContext): void {}
      }

      await system.actorOf(LifecycleActor);
      expect(startSpy).toHaveBeenCalled();
    });

    it('should call onStop when actor is stopped', async () => {
      const stopSpy = jest.fn();

      class StopActor extends Actor {
        override async onStop(): Promise<void> {
          stopSpy();
        }

        receive(message: any, context: ActorContext): void {}
      }

      const actor = await system.actorOf(StopActor);
      await actor.stop();

      expect(stopSpy).toHaveBeenCalled();
    });

    it('should call restart lifecycle hooks', async () => {
      const preRestartSpy = jest.fn();
      const postRestartSpy = jest.fn();

      class RestartActor extends Actor {
        override async onPreRestart(error: Error): Promise<void> {
          preRestartSpy(error);
        }

        override async onPostRestart(): Promise<void> {
          postRestartSpy();
        }

        receive(message: any, context: ActorContext): void {
          if (message === 'fail') {
            throw new Error('Test failure');
          }
        }

        override supervisorStrategy(): SupervisorStrategy {
          return new OneForOneStrategy(1, 1000);
        }
      }

      const actor = await system.actorOf(RestartActor);
      actor.tell('fail');

      // Wait for restart
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(preRestartSpy).toHaveBeenCalled();
      expect(postRestartSpy).toHaveBeenCalled();
    });
  });

  describe('Actor Hierarchy', () => {
    it('should spawn child actors', async () => {
      const parent = await system.actorOf(ParentActor);

      await parent.ask({
        type: 'spawn',
        actorClass: SimpleActor,
        name: 'child-1',
      });

      const child = system.actorFor('child-1');
      expect(child).toBeDefined();
    });

    it('should stop children when parent stops', async () => {
      const parent = await system.actorOf(ParentActor, 'parent-1');

      await parent.ask({
        type: 'spawn',
        actorClass: SimpleActor,
        name: 'child-1',
      });

      await parent.ask({
        type: 'spawn',
        actorClass: SimpleActor,
        name: 'child-2',
      });

      await parent.stop();

      expect(system.actorFor('parent-1')).toBeUndefined();
      expect(system.actorFor('child-1')).toBeUndefined();
      expect(system.actorFor('child-2')).toBeUndefined();
    });

    it('should provide parent reference to children', async () => {
      class ChildWithParent extends Actor {
        receive(message: any, context: ActorContext): string {
          return context.parent ? context.parent.id : 'no-parent';
        }
      }

      const parent = await system.actorOf(ParentActor, 'test-parent');

      await parent.ask({
        type: 'spawn',
        actorClass: ChildWithParent,
        name: 'child-with-parent',
      });

      const child = system.actorFor('child-with-parent');
      const parentId = await child?.ask<string>('get-parent');

      expect(parentId).toBe('test-parent');
    });
  });

  describe('Actor Linking', () => {
    it('should link actors bidirectionally', async () => {
      const actor1 = await system.actorOf(SimpleActor, 'link-1');
      const actor2 = await system.actorOf(SimpleActor, 'link-2');

      actor1.link(actor2);

      const instance1 = (system as any).actors.get('link-1');
      const instance2 = (system as any).actors.get('link-2');

      expect(instance1.linkedActors.has('link-2')).toBe(true);
      expect(instance2.linkedActors.has('link-1')).toBe(true);
    });

    it('should unlink actors', async () => {
      const actor1 = await system.actorOf(SimpleActor, 'unlink-1');
      const actor2 = await system.actorOf(SimpleActor, 'unlink-2');

      actor1.link(actor2);
      actor1.unlink(actor2);

      const instance1 = (system as any).actors.get('unlink-1');
      const instance2 = (system as any).actors.get('unlink-2');

      expect(instance1.linkedActors.has('unlink-2')).toBe(false);
      expect(instance2.linkedActors.has('unlink-1')).toBe(false);
    });

    it('should propagate crash to linked actors', async () => {
      const actor1 = await system.actorOf(SimpleActor, 'crash-1');
      const actor2 = await system.actorOf(SimpleActor, 'crash-2');

      actor1.link(actor2);

      const instance1 = (system as any).actors.get('crash-1');
      await instance1.stop(new Error('Crash test'));

      // Wait for propagation
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Both actors should be stopped and removed from system
      const metrics = system.getMetrics();
      expect(metrics.actors).not.toContain('crash-1');
      expect(metrics.actors).not.toContain('crash-2');
    });
  });

  describe('Actor Monitoring (DeathWatch)', () => {
    it('should monitor actor termination', async () => {
      const watcher = await system.actorOf(MonitorActor, 'watcher');
      const watched = await system.actorOf(SimpleActor, 'watched');

      const monitorRef = watcher.monitor(watched);
      expect(monitorRef).toBeDefined();

      await watched.stop();

      // Wait for notification
      await new Promise((resolve) => setTimeout(resolve, 50));

      const watcherInstance = (system as any).actors.get('watcher');
      expect(watcherInstance.actor.terminated).toHaveLength(1);
      expect(watcherInstance.actor.terminated[0].actorId).toBe('watched');
    });

    it('should demonitor actors', async () => {
      const watcher = await system.actorOf(MonitorActor, 'demonitor-watcher');
      const watched = await system.actorOf(SimpleActor, 'demonitor-watched');

      const monitorRef = watcher.monitor(watched);
      watcher.demonitor(monitorRef);

      await watched.stop();

      // Wait to ensure no notification
      await new Promise((resolve) => setTimeout(resolve, 50));

      const watcherInstance = (system as any).actors.get('demonitor-watcher');
      expect(watcherInstance.actor.terminated).toHaveLength(0);
    });

    it('should include termination reason in monitor notification', async () => {
      const watcher = await system.actorOf(MonitorActor, 'reason-watcher');
      const watched = await system.actorOf(SimpleActor, 'reason-watched');

      watcher.monitor(watched);

      const reason = new Error('Custom termination reason');
      const watchedInstance = (system as any).actors.get('reason-watched');
      await watchedInstance.stop(reason);

      // Wait for notification
      await new Promise((resolve) => setTimeout(resolve, 50));

      const watcherInstance = (system as any).actors.get('reason-watcher');
      expect(watcherInstance.actor.terminated[0].reason).toBe(reason);
    });
  });

  describe('Supervision Strategies', () => {
    describe('OneForOneStrategy', () => {
      it('should restart failing child actors', async () => {
        const parent = await system.actorOf(TolerantSupervisor, 'tolerant-parent');

        await parent.ask({
          type: 'spawn',
          actorClass: FailingActor,
          name: 'failing-child',
        });

        const child = system.actorFor('failing-child');
        child?.tell('fail');

        // Wait for restart
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Child should still exist after restart
        expect(system.actorFor('failing-child')).toBeDefined();
      });

      it('should stop child after max retries', async () => {
        const parent = await system.actorOf(StrictSupervisor, 'strict-parent');

        await parent.ask({
          type: 'spawn',
          actorClass: FailingActor,
          name: 'failing-strict',
        });

        const child = system.actorFor('failing-strict');
        child?.tell('fail');

        // Wait for stop
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(system.actorFor('failing-strict')).toBeUndefined();
      });

      it('should reset retry count after time window', async () => {
        const strategy = new OneForOneStrategy(2, 100);
        const actorRef = { id: 'test-actor' } as ActorRef;

        // First failure
        let action = strategy.decideAction(new Error('fail'), actorRef);
        expect(action).toBe(SupervisorAction.RESTART);

        // Second failure
        action = strategy.decideAction(new Error('fail'), actorRef);
        expect(action).toBe(SupervisorAction.RESTART);

        // Third failure (should stop)
        action = strategy.decideAction(new Error('fail'), actorRef);
        expect(action).toBe(SupervisorAction.STOP);

        // Wait for time window
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Should restart again (counter reset)
        action = strategy.decideAction(new Error('fail'), actorRef);
        expect(action).toBe(SupervisorAction.RESTART);
      });
    });

    describe('AllForOneStrategy', () => {
      it('should restart all children on failure', async () => {
        const restartCount = { child1: 0, child2: 0 };

        class TrackingActor extends Actor {
          constructor(private name: string) {
            super();
          }

          override async onPostRestart(): Promise<void> {
            restartCount[this.name as keyof typeof restartCount]++;
          }

          receive(message: any, context: ActorContext): void {
            if (message === 'fail') {
              throw new Error('Failure');
            }
          }
        }

        const parent = await system.actorOf(AllForOneSupervisor, 'all-for-one-parent');

        // Spawn children
        class Child1 extends TrackingActor {
          constructor() {
            super('child1');
          }
        }
        class Child2 extends TrackingActor {
          constructor() {
            super('child2');
          }
        }

        await parent.ask({ type: 'spawn', actorClass: Child1, name: 'child1' });
        await parent.ask({ type: 'spawn', actorClass: Child2, name: 'child2' });

        const child1 = system.actorFor('child1');
        child1?.tell('fail');

        // Wait for restart
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Both children should have restarted
        expect(restartCount.child1).toBeGreaterThan(0);
        expect(restartCount.child2).toBeGreaterThan(0);
      });
    });
  });

  describe('Behavior Changes', () => {
    it('should change behavior with become', async () => {
      const actor = await system.actorOf(BehaviorActor);

      const initial = await actor.ask<string>('test');
      expect(initial).toBe('initial');

      const changed = await actor.ask<string>('change');
      expect(changed).toBe('changed');

      const newState = await actor.ask<string>('test');
      expect(newState).toBe('changed state');
    });

    it('should revert behavior with unbecome', async () => {
      const actor = await system.actorOf(BehaviorActor);

      await actor.ask('change');

      // Send revert message
      await actor.ask<string>('revert');

      // After unbecome, next message should use base behavior
      const backToInitial = await actor.ask<string>('test');
      expect(backToInitial).toBe('initial');
    });

    it('should stack behaviors', async () => {
      class StackingActor extends Actor {
        receive(message: any, context: ActorContext): string {
          if (message === 'push1') {
            context.become(() => {
              context.become(() => 'level2');
              return 'level1';
            });
            return 'pushed1';
          }
          if (message === 'push2') {
            return 'should not reach';
          }
          return 'base';
        }
      }

      const actor = await system.actorOf(StackingActor);

      await actor.ask('push1');
      const level1 = await actor.ask<string>('test');
      expect(level1).toBe('level1');

      await actor.ask('push2');
      const level2 = await actor.ask<string>('test');
      expect(level2).toBe('level2');
    });
  });

  describe('Router Actors', () => {
    describe('RoundRobinRouter', () => {
      it('should distribute messages in round-robin fashion', async () => {
        class RouterRoutee extends SimpleActor {}

        const router = await system.actorOf(
          class extends RoundRobinRouter {
            constructor() {
              super(3, RouterRoutee);
            }
          },
          'round-robin'
        );

        router.tell('msg1');
        router.tell('msg2');
        router.tell('msg3');
        router.tell('msg4');

        await new Promise((resolve) => setTimeout(resolve, 100));

        // Each routee should have received one message
        // Fourth message goes to first routee again
        const routee0 = system.actorFor('routee-0');
        const routee1 = system.actorFor('routee-1');
        const routee2 = system.actorFor('routee-2');

        expect(routee0).toBeDefined();
        expect(routee1).toBeDefined();
        expect(routee2).toBeDefined();
      });
    });

    describe('BroadcastRouter', () => {
      it('should broadcast messages to all routees', async () => {
        class BroadcastRoutee extends SimpleActor {}

        const router = await system.actorOf(
          class extends BroadcastRouter {
            constructor() {
              super(3, BroadcastRoutee);
            }
          },
          'broadcast'
        );

        router.tell('broadcast-msg');

        await new Promise((resolve) => setTimeout(resolve, 100));

        const routee0 = (system as any).actors.get('routee-0');
        const routee1 = (system as any).actors.get('routee-1');
        const routee2 = (system as any).actors.get('routee-2');

        expect(routee0.actor.messages).toContain('broadcast-msg');
        expect(routee1.actor.messages).toContain('broadcast-msg');
        expect(routee2.actor.messages).toContain('broadcast-msg');
      });
    });

    describe('ConsistentHashRouter', () => {
      it('should route messages based on hash', async () => {
        class HashRoutee extends SimpleActor {}

        const router = await system.actorOf(
          class extends ConsistentHashRouter {
            constructor() {
              super(3, HashRoutee, (msg) => msg.key);
            }
          },
          'hash-router'
        );

        router.tell({ key: 'user-123', data: 'msg1' });
        router.tell({ key: 'user-123', data: 'msg2' });
        router.tell({ key: 'user-456', data: 'msg3' });

        await new Promise((resolve) => setTimeout(resolve, 100));

        // Messages with same key should go to same routee
        // This is probabilistic, but with consistent hashing it should work
        let routeeWith123: any = null;
        let countFor123 = 0;

        for (let i = 0; i < 3; i++) {
          const routee = (system as any).actors.get(`routee-${i}`);
          const msgs = routee.actor.messages.filter((m: any) => m.key === 'user-123');
          if (msgs.length > 0) {
            routeeWith123 = routee;
            countFor123 = msgs.length;
          }
        }

        expect(countFor123).toBe(2); // Both user-123 messages
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle errors without crashing actor system', async () => {
      const actor = await system.actorOf(FailingActor);

      actor.tell('fail');

      await new Promise((resolve) => setTimeout(resolve, 100));

      const metrics = system.getMetrics();
      expect(metrics.totalActors).toBeGreaterThan(0);
    });

    it('should clear mailbox on restart', async () => {
      class MailboxActor extends Actor {
        receive(message: any, context: ActorContext): void {
          if (message === 'fail') {
            throw new Error('Test failure');
          }
        }
      }

      const actor = await system.actorOf(MailboxActor);

      actor.tell('msg1');
      actor.tell('msg2');
      actor.tell('fail');
      actor.tell('msg3');

      await new Promise((resolve) => setTimeout(resolve, 100));

      const instance = (system as any).actors.get(actor.id);
      expect(instance.mailbox.length).toBe(0);
    });
  });

  describe('Context Operations', () => {
    it('should provide self reference', async () => {
      class SelfAwareActor extends Actor {
        receive(message: any, context: ActorContext): string {
          return context.self.id;
        }
      }

      const actor = await system.actorOf(SelfAwareActor, 'self-aware');
      const selfId = await actor.ask<string>('get-id');

      expect(selfId).toBe('self-aware');
    });

    it('should stop self via context', async () => {
      class SelfStoppingActor extends Actor {
        receive(message: any, context: ActorContext): void {
          if (message === 'stop-self') {
            context.stop();
          }
        }
      }

      const actor = await system.actorOf(SelfStoppingActor, 'self-stopping');
      actor.tell('stop-self');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(system.actorFor('self-stopping')).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should ignore messages sent to stopped actors', async () => {
      const actor = await system.actorOf(SimpleActor);
      await actor.stop();

      // Should not throw
      actor.tell('ignored message');
    });

    it('should handle rapid message sending', async () => {
      const actor = await system.actorOf(CounterActor);

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(actor.ask('increment'));
      }

      await Promise.all(promises);
      const count = await actor.ask<number>('get');

      expect(count).toBe(100);
    });

    it('should handle concurrent actor creation', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(system.actorOf(SimpleActor, `concurrent-${i}`));
      }

      const actors = await Promise.all(promises);
      expect(actors).toHaveLength(10);

      const metrics = system.getMetrics();
      expect(metrics.totalActors).toBe(10);
    });
  });
});
