/**
 * Module Eager Initialization Tests
 *
 * Tests for the architectural weakness where Titan's DI resolves providers lazily,
 * unlike NestJS which eagerly instantiates all singleton providers on module load.
 *
 * This causes event-listener-based handlers to never initialize if they are
 * registered as providers but only consumed as side-effects (constructor listeners).
 *
 * Reproduces: OrganizationNotificationHandler never instantiated despite being
 * properly registered in OrganizationsModule with useClass + inject.
 *
 * @since 0.5.0
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container, createToken } from '@nexus';
import type { IModule } from '@nexus';

// =============================================================================
// TEST FIXTURES — mirrors the real production pattern
// =============================================================================

// Tracks instantiation order for assertions
const instantiationLog: string[] = [];

// Tokens
const EVENTS_SERVICE = createToken<EventsService>('TestEventsService');
const LOGGER_SERVICE = createToken<LoggerService>('TestLoggerService');
const ORG_REPOSITORY = createToken<OrgRepository>('TestOrgRepository');
const EMPLOYEE_REPOSITORY = createToken<EmployeeRepository>('TestEmployeeRepository');
const USER_REPOSITORY = createToken<UserRepository>('TestUserRepository');
const NOTIFICATION_SERVICE = createToken<NotificationService>('TestNotificationService');
const ORGANIZATION_SERVICE = createToken<OrganizationService>('TestOrganizationService');
const NOTIFICATION_HANDLER = createToken<unknown>('TestNotificationHandler');

// Simple mock services
class EventsService {
  private handlers = new Map<string, Function[]>();
  on(event: string, handler: Function) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(handler);
  }
  emit(event: string, data: any) {
    for (const handler of this.handlers.get(event) || []) handler(data);
  }
}

class LoggerService {
  logs: string[] = [];
  info(msg: string) {
    this.logs.push(msg);
  }
}

class OrgRepository {
  findById(id: string) {
    return { id, name: 'TestOrg' };
  }
}

class EmployeeRepository {
  findOwners(orgId: string) {
    return [{ userId: 'owner1' }];
  }
}

class UserRepository {
  findByPlatformRole(role: string) {
    return [{ id: 'admin1' }];
  }
}

class NotificationService {
  sent: any[] = [];
  send(userId: string, notification: any) {
    this.sent.push({ userId, notification });
  }
}

/**
 * The handler that registers event listeners in its constructor.
 * This is the exact pattern from OrganizationNotificationHandler.
 *
 * In NestJS, this would be eagerly instantiated when the module loads.
 * In Titan (current), this never gets instantiated unless explicitly resolved.
 */
class NotificationHandler {
  public initialized = false;
  public listenersSetup = false;

  constructor(
    private notifications: NotificationService,
    private orgRepo: OrgRepository,
    private employeeRepo: EmployeeRepository,
    private userRepo: UserRepository,
    private logger: LoggerService,
    private events: EventsService
  ) {
    instantiationLog.push('NotificationHandler');
    this.initialized = true;
    this.setupListeners();
  }

  private setupListeners() {
    this.events.on('org.created', (data: any) => this.onOrgCreated(data));
    this.events.on('employee.invited', (data: any) => this.onEmployeeInvited(data));
    this.listenersSetup = true;
    this.logger.info('Notification listeners initialized');
  }

  private async onOrgCreated(data: any) {
    this.notifications.send('admin1', {
      type: 'orgCreated',
      body: `Organization "${data.name}" created`,
    });
  }

  private async onEmployeeInvited(data: any) {
    this.notifications.send(data.userId, {
      type: 'orgInvitation',
      body: `You were invited to "${data.orgName}"`,
    });
  }
}

/**
 * Main service — has the handler as a dependency in the inject array.
 * This is the exact pattern from OrganizationsService.
 */
class OrganizationService {
  constructor(
    private orgRepo: OrgRepository,
    private employeeRepo: EmployeeRepository,
    private logger: LoggerService,
    private events: EventsService,
    _notificationHandler: unknown // injected to force eager init
  ) {
    instantiationLog.push('OrganizationService');
  }

  createOrg(name: string) {
    this.events.emit('org.created', { name, organizationId: '123' });
    return { id: '123', name };
  }
}

/**
 * RPC Service — resolved by Netron auto-exposure (simulated via direct resolveAsync)
 */
class OrganizationsRpcService {
  constructor(private orgService: OrganizationService) {
    instantiationLog.push('OrganizationsRpcService');
  }

  createOrg(name: string) {
    return this.orgService.createOrg(name);
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe('Module Eager Initialization', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
    instantiationLog.length = 0;
  });

  afterEach(async () => {
    await container.dispose();
  });

  /**
   * This test reproduces the exact production pattern:
   * - NotificationsModule provides NOTIFICATION_SERVICE (imported)
   * - OrganizationsModule provides:
   *   - ORGANIZATION_SERVICE (useClass + inject, depends on NOTIFICATION_HANDLER)
   *   - NOTIFICATION_HANDLER (useClass + inject, registers event listeners in constructor)
   *   - OrganizationsRpcService (bare class, depends on ORGANIZATION_SERVICE via @Inject)
   *
   * The bug: NOTIFICATION_HANDLER constructor is never called because
   * Titan only resolves it lazily when someone explicitly requests it.
   */
  it('should resolve useClass+inject dependency within same module (NestJS provide syntax)', async () => {
    // Shared infrastructure modules
    const infraModule: IModule = {
      name: 'InfraModule',
      providers: [
        { provide: EVENTS_SERVICE, useClass: EventsService },
        { provide: LOGGER_SERVICE, useClass: LoggerService },
      ],
      exports: [EVENTS_SERVICE, LOGGER_SERVICE],
      global: true,
    };

    const repoModule: IModule = {
      name: 'RepoModule',
      providers: [
        { provide: ORG_REPOSITORY, useClass: OrgRepository },
        { provide: EMPLOYEE_REPOSITORY, useClass: EmployeeRepository },
        { provide: USER_REPOSITORY, useClass: UserRepository },
      ],
      exports: [ORG_REPOSITORY, EMPLOYEE_REPOSITORY, USER_REPOSITORY],
    };

    const notifModule: IModule = {
      name: 'NotificationsModule',
      providers: [{ provide: NOTIFICATION_SERVICE, useClass: NotificationService }],
      exports: [NOTIFICATION_SERVICE],
    };

    // The module with the bug pattern
    const orgModule: IModule = {
      name: 'OrganizationsModule',
      imports: [repoModule, notifModule],
      providers: [
        // Handler — registers event listeners in constructor
        {
          provide: NOTIFICATION_HANDLER,
          useClass: NotificationHandler,
          inject: [
            NOTIFICATION_SERVICE,
            ORG_REPOSITORY,
            EMPLOYEE_REPOSITORY,
            USER_REPOSITORY,
            LOGGER_SERVICE,
            EVENTS_SERVICE,
          ],
        },
        // Main service — depends on handler to force its instantiation
        {
          provide: ORGANIZATION_SERVICE,
          useClass: OrganizationService,
          inject: [ORG_REPOSITORY, EMPLOYEE_REPOSITORY, LOGGER_SERVICE, EVENTS_SERVICE, NOTIFICATION_HANDLER],
        },
      ],
      exports: [ORGANIZATION_SERVICE],
    };

    container.loadModule(infraModule);
    container.loadModule(orgModule);

    // Simulate Netron auto-exposure: resolve the RPC service
    // In production: container.resolveAsync(OrganizationsRpcService)
    // Here we resolve ORGANIZATION_SERVICE directly since the RPC service
    // in production uses @Inject(ORGANIZATION_SERVICE)
    const orgService = await container.resolveAsync(ORGANIZATION_SERVICE);

    // The handler MUST have been instantiated as a dependency
    expect(orgService).toBeInstanceOf(OrganizationService);
    expect(instantiationLog).toContain('NotificationHandler');
    expect(instantiationLog).toContain('OrganizationService');

    // Verify the handler was created BEFORE the service (dependency order)
    const handlerIdx = instantiationLog.indexOf('NotificationHandler');
    const serviceIdx = instantiationLog.indexOf('OrganizationService');
    expect(handlerIdx).toBeLessThan(serviceIdx);
  });

  /**
   * Test that event listeners actually work after handler is instantiated
   * through the dependency chain.
   */
  it('should have working event listeners after dependency-chain instantiation', async () => {
    const infraModule: IModule = {
      name: 'InfraModule',
      providers: [
        { provide: EVENTS_SERVICE, useClass: EventsService },
        { provide: LOGGER_SERVICE, useClass: LoggerService },
      ],
      exports: [EVENTS_SERVICE, LOGGER_SERVICE],
      global: true,
    };

    const repoModule: IModule = {
      name: 'RepoModule',
      providers: [
        { provide: ORG_REPOSITORY, useClass: OrgRepository },
        { provide: EMPLOYEE_REPOSITORY, useClass: EmployeeRepository },
        { provide: USER_REPOSITORY, useClass: UserRepository },
      ],
      exports: [ORG_REPOSITORY, EMPLOYEE_REPOSITORY, USER_REPOSITORY],
    };

    const notifModule: IModule = {
      name: 'NotificationsModule',
      providers: [{ provide: NOTIFICATION_SERVICE, useClass: NotificationService }],
      exports: [NOTIFICATION_SERVICE],
    };

    const orgModule: IModule = {
      name: 'OrganizationsModule',
      imports: [repoModule, notifModule],
      providers: [
        {
          provide: NOTIFICATION_HANDLER,
          useClass: NotificationHandler,
          inject: [
            NOTIFICATION_SERVICE,
            ORG_REPOSITORY,
            EMPLOYEE_REPOSITORY,
            USER_REPOSITORY,
            LOGGER_SERVICE,
            EVENTS_SERVICE,
          ],
        },
        {
          provide: ORGANIZATION_SERVICE,
          useClass: OrganizationService,
          inject: [ORG_REPOSITORY, EMPLOYEE_REPOSITORY, LOGGER_SERVICE, EVENTS_SERVICE, NOTIFICATION_HANDLER],
        },
      ],
      exports: [ORGANIZATION_SERVICE],
    };

    container.loadModule(infraModule);
    container.loadModule(orgModule);

    const orgService = await container.resolveAsync(ORGANIZATION_SERVICE);
    const notifService = await container.resolveAsync(NOTIFICATION_SERVICE);

    // Create an org — should trigger event listener in the handler
    orgService.createOrg('TestOrg');

    // The handler should have processed the event
    expect(notifService.sent).toHaveLength(1);
    expect(notifService.sent[0]).toEqual({
      userId: 'admin1',
      notification: {
        type: 'orgCreated',
        body: 'Organization "TestOrg" created',
      },
    });
  });

  /**
   * Lazy loadModule does NOT eagerly instantiate — this is expected behavior.
   * Use loadModuleAsync for eager init.
   */
  it('should NOT eagerly instantiate with synchronous loadModule', async () => {
    const events = new EventsService();
    const logger = new LoggerService();

    const module: IModule = {
      name: 'TestModule',
      providers: [
        { provide: EVENTS_SERVICE, useValue: events },
        { provide: LOGGER_SERVICE, useValue: logger },
        { provide: ORG_REPOSITORY, useClass: OrgRepository },
        { provide: EMPLOYEE_REPOSITORY, useClass: EmployeeRepository },
        { provide: USER_REPOSITORY, useClass: UserRepository },
        { provide: NOTIFICATION_SERVICE, useClass: NotificationService },
        {
          provide: NOTIFICATION_HANDLER,
          useClass: NotificationHandler,
          inject: [
            NOTIFICATION_SERVICE,
            ORG_REPOSITORY,
            EMPLOYEE_REPOSITORY,
            USER_REPOSITORY,
            LOGGER_SERVICE,
            EVENTS_SERVICE,
          ],
        },
      ],
    };

    container.loadModule(module);

    // Sync loadModule does not instantiate singletons
    expect(instantiationLog).not.toContain('NotificationHandler');
  });

  /**
   * loadModuleAsync eagerly instantiates ALL singleton providers.
   * This is the fix for the handler-never-initialized bug.
   */
  it('should eagerly instantiate singleton providers with loadModuleAsync', async () => {
    const events = new EventsService();
    const logger = new LoggerService();

    const infraModule: IModule = {
      name: 'InfraModule',
      providers: [
        { provide: EVENTS_SERVICE, useValue: events },
        { provide: LOGGER_SERVICE, useValue: logger },
      ],
      exports: [EVENTS_SERVICE, LOGGER_SERVICE],
      global: true,
    };

    const repoModule: IModule = {
      name: 'RepoModule',
      providers: [
        { provide: ORG_REPOSITORY, useClass: OrgRepository },
        { provide: EMPLOYEE_REPOSITORY, useClass: EmployeeRepository },
        { provide: USER_REPOSITORY, useClass: UserRepository },
      ],
      exports: [ORG_REPOSITORY, EMPLOYEE_REPOSITORY, USER_REPOSITORY],
    };

    const notifModule: IModule = {
      name: 'NotificationsModule',
      providers: [{ provide: NOTIFICATION_SERVICE, useClass: NotificationService }],
      exports: [NOTIFICATION_SERVICE],
    };

    // Module with standalone handler — NOT consumed as a dependency by any service
    const orgModule: IModule = {
      name: 'OrganizationsModule',
      imports: [repoModule, notifModule],
      providers: [
        // Handler is registered but nobody depends on it
        {
          provide: NOTIFICATION_HANDLER,
          useClass: NotificationHandler,
          inject: [
            NOTIFICATION_SERVICE,
            ORG_REPOSITORY,
            EMPLOYEE_REPOSITORY,
            USER_REPOSITORY,
            LOGGER_SERVICE,
            EVENTS_SERVICE,
          ],
        },
        // Service does NOT inject the handler
        {
          provide: ORGANIZATION_SERVICE,
          useClass: OrganizationService,
          inject: [ORG_REPOSITORY, EMPLOYEE_REPOSITORY, LOGGER_SERVICE, EVENTS_SERVICE],
        },
      ],
      exports: [ORGANIZATION_SERVICE],
    };

    // Load infra + repos synchronously (no eager init needed for infra)
    container.loadModule(infraModule);
    container.loadModule(repoModule);
    container.loadModule(notifModule);

    // Load org module — collects eager tokens but doesn't resolve yet
    await container.loadModuleAsync(orgModule);

    // Eager init deferred — handler not yet instantiated
    expect(instantiationLog).not.toContain('NotificationHandler');

    // Now eagerly initialize — all cross-module deps are available
    await container.eagerlyInitialize();

    // Handler MUST be instantiated even though nobody depends on it
    expect(instantiationLog).toContain('NotificationHandler');
    expect(logger.logs).toContain('Notification listeners initialized');

    // Event listeners should work
    const notifService = await container.resolveAsync(NOTIFICATION_SERVICE);
    events.emit('org.created', { name: 'TestOrg', organizationId: '123' });
    expect(notifService.sent).toHaveLength(1);
  });

  /**
   * loadModuleAsync should throw with clear diagnostics when a dependency is missing.
   */
  it('should throw with diagnostic info when eager init fails', async () => {
    const MISSING_DEP = createToken('MissingDep');

    const module: IModule = {
      name: 'BrokenModule',
      providers: [
        {
          provide: NOTIFICATION_HANDLER,
          useClass: NotificationHandler,
          inject: [
            MISSING_DEP, // This doesn't exist
            MISSING_DEP,
            MISSING_DEP,
            MISSING_DEP,
            MISSING_DEP,
            MISSING_DEP,
          ],
        },
      ],
    };

    await container.loadModuleAsync(module);
    await expect(container.eagerlyInitialize()).rejects.toThrow(/BrokenModule.*failed to initialize/i);
  });

  /**
   * Tests that the handler dependency chain works when using the
   * { provide: TOKEN, useClass: Class, inject: [...] } syntax
   * (NestJS-style provider objects).
   *
   * This is the pattern used in apps/main OrganizationsModule.
   * If this test fails, the bug is in how Titan handles the provide/useClass/inject
   * syntax rather than eager initialization.
   */
  it('should resolve handler via inject array with provide-useClass-inject syntax', async () => {
    // Minimal reproduction with useValue for infrastructure
    const events = new EventsService();
    const logger = new LoggerService();
    const orgRepo = new OrgRepository();
    const empRepo = new EmployeeRepository();
    const userRepo = new UserRepository();
    const notifService = new NotificationService();

    const module: IModule = {
      name: 'TestModule',
      providers: [
        { provide: EVENTS_SERVICE, useValue: events },
        { provide: LOGGER_SERVICE, useValue: logger },
        { provide: ORG_REPOSITORY, useValue: orgRepo },
        { provide: EMPLOYEE_REPOSITORY, useValue: empRepo },
        { provide: USER_REPOSITORY, useValue: userRepo },
        { provide: NOTIFICATION_SERVICE, useValue: notifService },
        // Handler (registered BEFORE service that depends on it)
        {
          provide: NOTIFICATION_HANDLER,
          useClass: NotificationHandler,
          inject: [
            NOTIFICATION_SERVICE,
            ORG_REPOSITORY,
            EMPLOYEE_REPOSITORY,
            USER_REPOSITORY,
            LOGGER_SERVICE,
            EVENTS_SERVICE,
          ],
        },
        // Service depends on handler as last inject
        {
          provide: ORGANIZATION_SERVICE,
          useClass: OrganizationService,
          inject: [ORG_REPOSITORY, EMPLOYEE_REPOSITORY, LOGGER_SERVICE, EVENTS_SERVICE, NOTIFICATION_HANDLER],
        },
      ],
    };

    container.loadModule(module);

    const orgService = await container.resolveAsync(ORGANIZATION_SERVICE);
    expect(orgService).toBeInstanceOf(OrganizationService);
    expect(instantiationLog).toContain('NotificationHandler');

    // Verify event listeners work
    orgService.createOrg('AcmeCorp');
    expect(notifService.sent).toHaveLength(1);
  });

  /**
   * Same test but handler registered AFTER the service in the providers array.
   * Tests that registration order doesn't affect resolution.
   */
  it('should resolve handler regardless of registration order in providers', async () => {
    const events = new EventsService();
    const logger = new LoggerService();

    const module: IModule = {
      name: 'TestModule',
      providers: [
        { provide: EVENTS_SERVICE, useValue: events },
        { provide: LOGGER_SERVICE, useValue: logger },
        { provide: ORG_REPOSITORY, useClass: OrgRepository },
        { provide: EMPLOYEE_REPOSITORY, useClass: EmployeeRepository },
        { provide: USER_REPOSITORY, useClass: UserRepository },
        { provide: NOTIFICATION_SERVICE, useClass: NotificationService },
        // Service registered FIRST — depends on handler that comes LATER
        {
          provide: ORGANIZATION_SERVICE,
          useClass: OrganizationService,
          inject: [ORG_REPOSITORY, EMPLOYEE_REPOSITORY, LOGGER_SERVICE, EVENTS_SERVICE, NOTIFICATION_HANDLER],
        },
        // Handler registered AFTER service that depends on it
        {
          provide: NOTIFICATION_HANDLER,
          useClass: NotificationHandler,
          inject: [
            NOTIFICATION_SERVICE,
            ORG_REPOSITORY,
            EMPLOYEE_REPOSITORY,
            USER_REPOSITORY,
            LOGGER_SERVICE,
            EVENTS_SERVICE,
          ],
        },
      ],
    };

    container.loadModule(module);

    const orgService = await container.resolveAsync(ORGANIZATION_SERVICE);
    expect(orgService).toBeInstanceOf(OrganizationService);
    expect(instantiationLog).toContain('NotificationHandler');
    expect(instantiationLog).toContain('OrganizationService');
  });

  /**
   * Cross-module eager init: sub-module's providers depend on parent module's providers.
   * This is the exact pattern from priceverse: AggregatorModule depends on
   * OHLCV_REPOSITORY registered at AppModule level.
   *
   * eagerlyInitialize() must be called AFTER all modules are loaded.
   */
  it('should resolve cross-module dependencies when eagerlyInitialize runs after all modules loaded', async () => {
    const REPO_TOKEN = createToken<OrgRepository>('CrossModuleRepo');
    const SERVICE_TOKEN = createToken<unknown>('CrossModuleService');

    // Sub-module registered first via imports — depends on REPO_TOKEN from parent
    const subModule: IModule = {
      name: 'SubModule',
      providers: [
        {
          provide: SERVICE_TOKEN,
          useFactory: (repo: OrgRepository) => {
            instantiationLog.push('CrossModuleService');
            return { repo };
          },
          inject: [REPO_TOKEN],
        },
      ],
      exports: [SERVICE_TOKEN],
    };

    // Parent module registers REPO_TOKEN in its own providers
    const parentModule: IModule = {
      name: 'ParentModule',
      imports: [subModule],
      providers: [{ provide: REPO_TOKEN, useClass: OrgRepository }],
      exports: [REPO_TOKEN],
    };

    // Load sub first (simulating import processing), then parent
    await container.loadModuleAsync(subModule);
    await container.loadModuleAsync(parentModule);

    // Before eagerlyInitialize — sub-module's service not yet created
    expect(instantiationLog).not.toContain('CrossModuleService');

    // Now eagerly init — REPO_TOKEN is available from parent module
    await container.eagerlyInitialize();

    expect(instantiationLog).toContain('CrossModuleService');
  });
});
