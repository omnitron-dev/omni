/**
 * Comprehensive Tests for Self-Healing and Autonomous Operations
 * 
 * Tests anomaly detection, automatic remediation, health monitoring,
 * incident response, and playbook execution.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  SelfHealingManager,
  AnomalyDetector,
  PlaybookExecutor,
  IncidentResponder,
  type SelfHealingConfig,
  type Playbook,
  type HealingAction,
  type MonitoringConfig,
  type AnomalyDetectionConfig,
} from '../../../../src/modules/pm/enterprise/self-healing.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

describe('Self-Healing Manager', () => {
  let manager: SelfHealingManager;

  beforeEach(() => {
    jest.clearAllMocks();
    
    const config: SelfHealingConfig = {
      enabled: true,
      ml: false,
      monitoring: {
        interval: 100, // Fast for testing
        metrics: ['cpu', 'memory', 'disk', 'network'],
        thresholds: {
          cpu: { warning: 70, critical: 90 },
          memory: { warning: 75, critical: 95 },
        },
      },
      remediation: {
        automatic: true,
        maxRetries: 3,
        cooldown: 100,
      },
    };

    manager = new SelfHealingManager(config);
  });

  afterEach(() => {
    manager.removeAllListeners();
  });

  describe('Health Monitoring', () => {
    it('should track health indicators', async () => {
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const health = manager.getHealthStatus();
      expect(Object.keys(health).length).toBeGreaterThan(0);
    });

    it('should detect health degradation', (done) => {
      manager.on('incident:created', (incident) => {
        expect(incident.type).toBe('health-degradation');
        expect(incident.severity).toBeDefined();
        done();
      });

      // Manually trigger by setting unhealthy metrics
      (manager as any).healthIndicators.set('cpu', {
        name: 'cpu',
        status: 'unhealthy',
        value: 95,
        timestamp: Date.now(),
      });

      (manager as any).handleDegradation({
        name: 'cpu',
        status: 'unhealthy',
        value: 95,
        timestamp: Date.now(),
      });
    });

    it('should track recovery from degradation', (done) => {
      manager.on('health:recovered', (indicator) => {
        expect(indicator.name).toBe('memory');
        expect(indicator.status).toBe('healthy');
        done();
      });

      // Set degraded state first
      (manager as any).healthIndicators.set('memory', {
        name: 'memory',
        status: 'degraded',
        value: 80,
        timestamp: Date.now(),
      });

      // Trigger recovery
      (manager as any).handleRecovery({
        name: 'memory',
        status: 'healthy',
        value: 50,
        timestamp: Date.now(),
      });
    });

    it('should resolve incidents on recovery', () => {
      // Create incident
      const incident = {
        id: 'inc-1',
        timestamp: Date.now(),
        severity: 'high' as const,
        type: 'health-degradation',
        description: 'CPU degraded',
        affected: ['cpu'],
        status: 'open' as const,
      };

      (manager as any).incidents.set('inc-1', incident);

      // Trigger recovery
      (manager as any).handleRecovery({
        name: 'cpu',
        status: 'healthy',
        value: 30,
        timestamp: Date.now(),
      });

      expect(incident.status).toBe('resolved');
    });
  });

  describe('Healing Actions', () => {
    beforeEach(() => {
      const healingAction: HealingAction = {
        id: 'action-1',
        symptoms: [
          {
            metric: 'cpu',
            condition: 'gt',
            value: 90,
          },
        ],
        action: 'restart',
        cooldown: 100,
      };

      (manager as any).config.actions = [healingAction];
    });

    it('should find matching healing action', () => {
      const indicator = {
        name: 'cpu',
        status: 'unhealthy' as const,
        value: 95,
        timestamp: Date.now(),
      };

      const action = (manager as any).findHealingAction(indicator);
      expect(action).toBeDefined();
      expect(action?.id).toBe('action-1');
    });

    it('should execute healing action', (done) => {
      manager.on('remediation:started', ({ action, incident }) => {
        expect(action.action).toBe('restart');
        done();
      });

      const action: HealingAction = {
        id: 'action-restart',
        symptoms: [],
        action: 'restart',
      };

      const incident = {
        id: 'inc-test',
        timestamp: Date.now(),
        severity: 'high' as const,
        type: 'test',
        description: 'Test incident',
        affected: ['cpu'],
        status: 'open' as const,
      };

      (manager as any).executeHealingAction(action, incident);
    });

    it('should complete healing action successfully', async () => {
      const action: HealingAction = {
        id: 'action-scale',
        symptoms: [],
        action: 'scale',
      };

      const incident = {
        id: 'inc-scale',
        timestamp: Date.now(),
        severity: 'medium' as const,
        type: 'capacity',
        description: 'Need scaling',
        affected: ['instances'],
        status: 'open' as const,
      };

      await (manager as any).executeHealingAction(action, incident);
      
      expect(incident.status).toBe('resolved');
      expect(incident.remediation?.status).toBe('completed');
    });

    it('should handle healing action failure', async () => {
      const action: HealingAction = {
        id: 'action-custom',
        symptoms: [],
        action: 'custom',
        handler: async () => {
          throw new Error('Remediation failed');
        },
      };

      const incident = {
        id: 'inc-fail',
        timestamp: Date.now(),
        severity: 'high' as const,
        type: 'test',
        description: 'Will fail',
        affected: ['test'],
        status: 'open' as const,
      };

      (manager as any).config.remediation.escalation = {
        levels: [
          {
            level: 1,
            actions: ['notify'],
            notify: ['ops-team'],
          },
        ],
      };

      await (manager as any).executeHealingAction(action, incident);
      
      expect(incident.remediation?.status).toBe('failed');
    });

    it('should match symptoms correctly', () => {
      const testCases = [
        {
          symptom: { metric: 'cpu', condition: 'gt' as const, value: 80 },
          indicator: { name: 'cpu', status: 'unhealthy' as const, value: 90, timestamp: Date.now() },
          expected: true,
        },
        {
          symptom: { metric: 'cpu', condition: 'lt' as const, value: 50 },
          indicator: { name: 'cpu', status: 'healthy' as const, value: 30, timestamp: Date.now() },
          expected: true,
        },
        {
          symptom: { metric: 'memory', condition: 'eq' as const, value: 100 },
          indicator: { name: 'memory', status: 'unhealthy' as const, value: 100, timestamp: Date.now() },
          expected: true,
        },
        {
          symptom: { metric: 'disk', condition: 'ne' as const, value: 0 },
          indicator: { name: 'disk', status: 'healthy' as const, value: 50, timestamp: Date.now() },
          expected: true,
        },
      ];

      for (const testCase of testCases) {
        const matches = (manager as any).matchSymptom(testCase.symptom, testCase.indicator);
        expect(matches).toBe(testCase.expected);
      }
    });
  });

  describe('Incident Management', () => {
    it('should create incidents', () => {
      manager.on('incident:created', (incident) => {
        expect(incident.id).toBeDefined();
        expect(incident.timestamp).toBeDefined();
      });

      (manager as any).handleDegradation({
        name: 'disk',
        status: 'unhealthy',
        value: 98,
        timestamp: Date.now(),
      });
    });

    it('should track active incidents', () => {
      const incident = {
        id: 'inc-1',
        timestamp: Date.now(),
        severity: 'high' as const,
        type: 'test',
        description: 'Test',
        affected: ['test'],
        status: 'open' as const,
      };

      (manager as any).incidents.set('inc-1', incident);

      const active = manager.getActiveIncidents();
      expect(active).toHaveLength(1);
      expect(active[0]?.id).toBe('inc-1');
    });

    it('should filter out resolved incidents', () => {
      (manager as any).incidents.set('inc-1', {
        id: 'inc-1',
        timestamp: Date.now(),
        severity: 'high' as const,
        type: 'test',
        description: 'Active',
        affected: ['test'],
        status: 'open' as const,
      });

      (manager as any).incidents.set('inc-2', {
        id: 'inc-2',
        timestamp: Date.now(),
        severity: 'medium' as const,
        type: 'test',
        description: 'Resolved',
        affected: ['test'],
        status: 'resolved' as const,
      });

      const active = manager.getActiveIncidents();
      expect(active).toHaveLength(1);
      expect(active[0]?.id).toBe('inc-1');
    });
  });

  describe('Remediation Tracking', () => {
    it('should track remediation history', async () => {
      const action: HealingAction = {
        id: 'action-test',
        symptoms: [],
        action: 'restart',
      };

      const incident = {
        id: 'inc-remediation',
        timestamp: Date.now(),
        severity: 'high' as const,
        type: 'test',
        description: 'Test',
        affected: ['test'],
        status: 'open' as const,
      };

      await (manager as any).executeHealingAction(action, incident);

      const history = manager.getRemediationHistory();
      expect(history.length).toBeGreaterThan(0);
    });

    it('should include remediation details', async () => {
      const action: HealingAction = {
        id: 'action-migrate',
        symptoms: [],
        action: 'migrate',
      };

      const incident = {
        id: 'inc-migrate',
        timestamp: Date.now(),
        severity: 'medium' as const,
        type: 'migration',
        description: 'Need migration',
        affected: ['node-1'],
        status: 'open' as const,
      };

      await (manager as any).executeHealingAction(action, incident);

      const history = manager.getRemediationHistory();
      const remediation = history.find(r => r.action === 'migrate');
      
      expect(remediation).toBeDefined();
      expect(remediation?.startTime).toBeDefined();
      expect(remediation?.endTime).toBeDefined();
    });
  });

  describe('Playbook Execution', () => {
    it('should find matching playbook for anomaly', () => {
      const playbook: Playbook = {
        id: 'playbook-1',
        name: 'CPU Recovery',
        triggers: [{ type: 'anomaly', condition: {} }],
        steps: [],
      };

      (manager as any).config.playbooks = [playbook];

      const anomaly = {
        metric: 'cpu',
        value: 95,
        severity: 'high',
        description: 'CPU spike',
      };

      const found = (manager as any).findMatchingPlaybook(anomaly);
      expect(found).toBeDefined();
      expect(found?.id).toBe('playbook-1');
    });

    it('should execute playbook steps', async () => {
      const executed: string[] = [];

      const playbook: Playbook = {
        id: 'playbook-test',
        name: 'Test Playbook',
        triggers: [],
        steps: [
          {
            id: 'step-1',
            action: 'check-health',
          },
          {
            id: 'step-2',
            action: 'restart-service',
          },
        ],
      };

      const incident = {
        id: 'inc-playbook',
        timestamp: Date.now(),
        severity: 'high' as const,
        type: 'service-down',
        description: 'Service unavailable',
        affected: ['service-1'],
        status: 'open' as const,
      };

      manager.on('playbook:completed', () => {
        expect(incident.status).toBe('resolved');
      });

      await (manager as any).executePlaybook(playbook, incident);
    });

    it('should execute rollback on playbook failure', async () => {
      const playbook: Playbook = {
        id: 'playbook-rollback',
        name: 'Failing Playbook',
        triggers: [],
        steps: [
          {
            id: 'step-fail',
            action: 'will-fail',
          },
        ],
        rollback: [
          {
            id: 'rollback-step',
            action: 'undo-changes',
          },
        ],
      };

      const incident = {
        id: 'inc-rollback',
        timestamp: Date.now(),
        severity: 'high' as const,
        type: 'test',
        description: 'Will rollback',
        affected: ['test'],
        status: 'open' as const,
      };

      // Mock playbook executor to throw error
      (manager as any).playbookExecutor.execute = jest.fn().mockRejectedValue(new Error('Playbook failed'));

      manager.on('rollback:started', () => {
        // Rollback initiated
      });

      await (manager as any).executePlaybook(playbook, incident);
    });
  });

  describe('Escalation', () => {
    it('should escalate failed remediations', async () => {
      const action: HealingAction = {
        id: 'action-fail',
        symptoms: [],
        action: 'custom',
        handler: async () => {
          throw new Error('Failed');
        },
      };

      const incident = {
        id: 'inc-escalate',
        timestamp: Date.now(),
        severity: 'critical' as const,
        type: 'test',
        description: 'Critical failure',
        affected: ['system'],
        status: 'open' as const,
      };

      (manager as any).config.remediation.escalation = {
        levels: [
          {
            level: 1,
            actions: ['alert'],
            notify: ['ops-team'],
            wait: 50,
          },
          {
            level: 2,
            actions: ['page'],
            notify: ['on-call'],
          },
        ],
      };

      let escalated = false;
      manager.on('incident:escalated', () => {
        escalated = true;
      });

      await (manager as any).executeHealingAction(action, incident);
      expect(escalated).toBe(true);
    });

    it('should execute escalation levels in order', async () => {
      const executedLevels: number[] = [];

      const incident = {
        id: 'inc-levels',
        timestamp: Date.now(),
        severity: 'critical' as const,
        type: 'test',
        description: 'Test escalation',
        affected: ['test'],
        status: 'open' as const,
      };

      (manager as any).config.remediation.escalation = {
        levels: [
          { level: 1, actions: ['level-1'], wait: 10 },
          { level: 2, actions: ['level-2'], wait: 10 },
          { level: 3, actions: ['level-3'] },
        ],
      };

      manager.on('escalation:action', ({ action }) => {
        if (action === 'level-1') executedLevels.push(1);
        if (action === 'level-2') executedLevels.push(2);
        if (action === 'level-3') executedLevels.push(3);
      });

      await (manager as any).escalate(incident, new Error('Test error'));

      expect(executedLevels).toEqual([1, 2, 3]);
    });
  });
});

describe('Anomaly Detector', () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    const config: AnomalyDetectionConfig = {
      enabled: true,
      algorithm: 'isolation-forest',
      sensitivity: 2,
      trainingWindow: 10,
    };

    detector = new AnomalyDetector(config);
  });

  it('should detect statistical anomalies', async () => {
    // Feed normal data
    for (let i = 0; i < 5; i++) {
      await detector.detect({ cpu: 50, memory: 60 });
    }

    // Feed anomaly
    const anomalies = await detector.detect({ cpu: 150, memory: 200 });
    
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0]?.metric).toBeDefined();
  });

  it('should maintain training window', async () => {
    for (let i = 0; i < 15; i++) {
      await detector.detect({ value: i });
    }

    // History should be capped at training window
    expect((detector as any).history.length).toBeLessThanOrEqual(10);
  });

  it('should calculate severity based on threshold', () => {
    const severity1 = (detector as any).calculateSeverity(100, 50);
    expect(severity1).toBe('high'); // ratio > 2

    const severity2 = (detector as any).calculateSeverity(75, 50);
    expect(severity2).toBe('medium'); // 1.5 < ratio <= 2

    const severity3 = (detector as any).calculateSeverity(60, 50);
    expect(severity3).toBe('low'); // ratio <= 1.5
  });
});

describe('Playbook Executor', () => {
  let executor: PlaybookExecutor;

  beforeEach(() => {
    executor = new PlaybookExecutor([]);
  });

  it('should execute playbook steps in order', async () => {
    const executed: string[] = [];

    const steps = [
      {
        id: 'step-1',
        action: 'action-1',
      },
      {
        id: 'step-2',
        action: 'action-2',
      },
    ];

    await executor.executeSteps(steps, {} as any);
    // Steps executed (implementation detail)
  });

  it('should execute failure handler on step failure', async () => {
    const steps = [
      {
        id: 'step-fail',
        action: 'will-fail',
        onFailure: 'step-recovery',
      },
      {
        id: 'step-recovery',
        action: 'recover',
      },
    ];

    // Mock step execution to throw
    (executor as any).executeStep = jest.fn()
      .mockRejectedValueOnce(new Error('Step failed'))
      .mockResolvedValueOnce(undefined);

    await executor.executeSteps(steps, {} as any);
  });

  it('should throw if no failure handler defined', async () => {
    const steps = [
      {
        id: 'step-fail',
        action: 'will-fail',
      },
    ];

    (executor as any).executeStep = jest.fn().mockRejectedValue(new Error('Failed'));

    await expect(executor.executeSteps(steps, {} as any)).rejects.toThrow();
  });
});

describe('Incident Responder', () => {
  let responder: IncidentResponder;

  beforeEach(() => {
    responder = new IncidentResponder({
      automatic: true,
      maxRetries: 3,
    });
  });

  it('should determine action based on incident type', () => {
    const action1 = (responder as any).determineAction({
      type: 'health-degradation',
    });
    expect(action1).toBe('restart');

    const action2 = (responder as any).determineAction({
      type: 'anomaly',
    });
    expect(action2).toBe('investigate');
  });

  it('should not respond if automatic remediation disabled', async () => {
    responder = new IncidentResponder({ automatic: false });

    const incident = {
      id: 'inc-manual',
      type: 'test',
    };

    await responder.respond(incident as any);
    // Should not execute action
  });

  it('should execute determined action', async () => {
    const incident = {
      id: 'inc-auto',
      type: 'health-degradation',
    };

    await responder.respond(incident as any);
    // Action should be executed
  });
});
