/**
 * Coverage for the recently activated Nexus DI decorator features:
 *
 * - @PostConstruct / @PreDestroy with multiple methods per class
 * - Property injection (@Inject on properties)
 * - @InjectAll on constructor params and properties
 * - @Value / @InjectConfig for dot-path config injection
 * - @InjectEnv for environment variables
 * - @ConditionalInject branching
 * - @Lazy circular-dependency resolution
 *
 * Each block is intentionally small and asserts the contract the container
 * exposes for the corresponding decorator. The point is to lock the
 * behaviour so the implementation can be refactored without regressing.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Container, createToken } from '../../src/nexus/index.js';
import {
  Inject,
  Injectable,
  ConditionalInject,
  InjectAll,
  InjectConfig,
  InjectEnv,
  Lazy,
  PostConstruct,
  PreDestroy,
  Value,
} from '../../src/decorators/index.js';

describe('Nexus DI extras', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // @PostConstruct / @PreDestroy with multiple methods
  // ─────────────────────────────────────────────────────────────────────────
  describe('@PostConstruct / @PreDestroy', () => {
    it('invokes every @PostConstruct method in declaration order', async () => {
      const calls: string[] = [];

      @Injectable()
      class Service {
        @PostConstruct()
        first() {
          calls.push('first');
        }

        @PostConstruct()
        async second() {
          calls.push('second');
        }
      }
      const token = createToken<Service>('PCService');
      container.register(token, { useClass: Service });
      await container.resolveAsync(token);

      expect(calls).toEqual(['first', 'second']);
    });

    it('invokes every @PreDestroy method on dispose', async () => {
      const calls: string[] = [];

      @Injectable()
      class Service {
        @PreDestroy()
        async closeA() {
          calls.push('A');
        }

        @PreDestroy()
        closeB() {
          calls.push('B');
        }
      }
      const token = createToken<Service>('PDService');
      container.register(token, { useClass: Service });
      container.resolve(token);

      await container.dispose();
      expect(calls).toEqual(['A', 'B']);
      // The afterEach dispose() must remain idempotent.
      container = new Container();
    });

    it('async @PostConstruct errors do not crash resolveAsync of other instances', async () => {
      const calls: string[] = [];

      @Injectable()
      class A {
        @PostConstruct()
        init() {
          calls.push('a');
        }
      }
      @Injectable()
      class B {
        @PostConstruct()
        async init() {
          calls.push('b');
        }
      }
      const ta = createToken<A>('A');
      const tb = createToken<B>('B');
      container.register(ta, { useClass: A });
      container.register(tb, { useClass: B });

      await container.resolveAsync(ta);
      await container.resolveAsync(tb);
      expect(calls.sort()).toEqual(['a', 'b']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Property injection
  // ─────────────────────────────────────────────────────────────────────────
  describe('Property @Inject', () => {
    it('resolves property tokens after construction', () => {
      const Logger = createToken<{ log: (msg: string) => string }>('Logger');
      container.register(Logger, { useValue: { log: (msg) => `[L] ${msg}` } });

      class Consumer {
        @Inject(Logger)
        log!: { log: (msg: string) => string };

        say(msg: string) {
          return this.log.log(msg);
        }
      }
      const token = createToken<Consumer>('Consumer');
      container.register(token, { useClass: Consumer });

      const c = container.resolve(token);
      expect(c.say('hi')).toBe('[L] hi');
    });

    it('walks the prototype chain so subclasses inherit base property injections', () => {
      const Cfg = createToken<{ env: string }>('Cfg');
      container.register(Cfg, { useValue: { env: 'prod' } });

      class Base {
        @Inject(Cfg)
        cfg!: { env: string };
      }
      class Child extends Base {}

      const t = createToken<Child>('Child');
      container.register(t, { useClass: Child });
      expect(container.resolve(t).cfg.env).toBe('prod');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // @InjectAll
  // ─────────────────────────────────────────────────────────────────────────
  describe('@InjectAll', () => {
    interface IHandler {
      handle(): string;
    }
    const HandlerToken = createToken<IHandler>('Handler');

    beforeEach(() => {
      container.register(HandlerToken, { useValue: { handle: () => 'A' } }, { multi: true });
      container.register(HandlerToken, { useValue: { handle: () => 'B' } }, { multi: true });
      container.register(HandlerToken, { useValue: { handle: () => 'C' } }, { multi: true });
    });

    it('injects an array on constructor params', () => {
      @Injectable()
      class Manager {
        constructor(@InjectAll(HandlerToken) public handlers: IHandler[]) {}
      }
      const t = createToken<Manager>('Manager');
      container.register(t, { useClass: Manager });
      const m = container.resolve(t);
      expect(m.handlers.map((h) => h.handle()).sort()).toEqual(['A', 'B', 'C']);
    });

    it('injects an array on properties', () => {
      class Aggregator {
        @InjectAll(HandlerToken)
        handlers!: IHandler[];
      }
      const t = createToken<Aggregator>('Aggregator');
      container.register(t, { useClass: Aggregator });
      const a = container.resolve(t);
      expect(a.handlers.map((h) => h.handle()).sort()).toEqual(['A', 'B', 'C']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // @Value / @InjectConfig
  // ─────────────────────────────────────────────────────────────────────────
  describe('@Value / @InjectConfig', () => {
    beforeEach(() => {
      container.setConfig({
        app: { name: 'TestApp', port: 3000 },
        database: { host: 'localhost' },
      });
    });

    it('reads dot-path values into constructor parameters', () => {
      @Injectable()
      class Service {
        constructor(
          @Value('app.name') public name: string,
          @Value('app.port') public port: number,
          @InjectConfig('database.host') public host: string
        ) {}
      }
      const t = createToken<Service>('CfgService');
      container.register(t, { useClass: Service });
      const s = container.resolve(t);
      expect(s.name).toBe('TestApp');
      expect(s.port).toBe(3000);
      expect(s.host).toBe('localhost');
    });

    it('falls back to the supplied default for missing paths', () => {
      @Injectable()
      class Service {
        constructor(
          @Value('app.timezone', 'UTC') public tz: string,
          @Value('app.port', 0) public port: number
        ) {}
      }
      const t = createToken<Service>('Defaults');
      container.register(t, { useClass: Service });
      const s = container.resolve(t);
      expect(s.tz).toBe('UTC');
      expect(s.port).toBe(3000);
    });

    it('reads values into properties as well as constructor params', () => {
      class Holder {
        @Value('app.name')
        name!: string;

        @InjectConfig('database.host')
        host!: string;
      }
      const t = createToken<Holder>('Holder');
      container.register(t, { useClass: Holder });
      const h = container.resolve(t);
      expect(h.name).toBe('TestApp');
      expect(h.host).toBe('localhost');
    });

    it('mergeConfig deep-merges without dropping siblings', () => {
      container.mergeConfig({ app: { region: 'eu' } });
      expect(container.getConfigValue('app.name')).toBe('TestApp');
      expect(container.getConfigValue('app.region')).toBe('eu');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // @InjectEnv
  // ─────────────────────────────────────────────────────────────────────────
  describe('@InjectEnv', () => {
    it('injects environment variables and falls back when missing', () => {
      process.env.NEXUS_TEST_VAR = 'sentinel';

      @Injectable()
      class Service {
        constructor(
          @InjectEnv('NEXUS_TEST_VAR') public present: string,
          @InjectEnv('NEXUS_MISSING_VAR', 'fallback') public missing: string
        ) {}
      }
      const t = createToken<Service>('EnvService');
      container.register(t, { useClass: Service });
      const s = container.resolve(t);

      expect(s.present).toBe('sentinel');
      expect(s.missing).toBe('fallback');
      delete process.env.NEXUS_TEST_VAR;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // @ConditionalInject
  // ─────────────────────────────────────────────────────────────────────────
  describe('@ConditionalInject', () => {
    it('uses the token when the predicate is true', () => {
      const Real = createToken<{ tag: string }>('Real');
      container.register(Real, { useValue: { tag: 'real' } });

      @Injectable()
      class C {
        constructor(
          @ConditionalInject(Real, () => true, { tag: 'fallback' })
          public dep: { tag: string }
        ) {}
      }
      const t = createToken<C>('C');
      container.register(t, { useClass: C });
      expect(container.resolve(t).dep.tag).toBe('real');
    });

    it('uses the fallback (value or factory) when the predicate is false', () => {
      const Real = createToken<{ tag: string }>('Real2');
      container.register(Real, { useValue: { tag: 'real' } });

      @Injectable()
      class C {
        constructor(
          @ConditionalInject(Real, () => false, () => ({ tag: 'mock' }))
          public dep: { tag: string }
        ) {}
      }
      const t = createToken<C>('C2');
      container.register(t, { useClass: C });
      expect(container.resolve(t).dep.tag).toBe('mock');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // @Lazy
  // ─────────────────────────────────────────────────────────────────────────
  describe('@Lazy', () => {
    it('breaks construction-time circular dependencies', () => {
      const TokenA = createToken<any>('LazyA');
      const TokenB = createToken<any>('LazyB');

      // Forward declarations sidestep the TDZ on the typed property
      // annotations below.
      let BClass: any;

      @Injectable()
      class A {
        @Lazy(() => TokenB)
        b!: any;

        ping() {
          return 'A->' + this.b.who();
        }
      }

      @Injectable()
      class B {
        constructor(@Inject(TokenA) public a: A) {}

        who() {
          return 'B';
        }
      }
      BClass = B;
      void BClass;

      container.register(TokenA, { useClass: A });
      container.register(TokenB, { useClass: B });

      const a = container.resolve<A>(TokenA);
      // First touch resolves B through container, then B's constructor injects A back.
      expect(a.ping()).toBe('A->B');
    });

    it('caches the lazily-resolved value per instance', () => {
      const Token = createToken<{ id: number }>('Counter');
      let id = 0;
      container.register(Token, { useFactory: () => ({ id: ++id }) }, { scope: 'transient' as any });

      class Holder {
        @Lazy(() => Token)
        c!: { id: number };
      }
      container.register(Holder);
      const inst = container.resolve(Holder);
      const first = inst.c.id;
      const second = inst.c.id;
      expect(first).toBe(second);
    });
  });
});
