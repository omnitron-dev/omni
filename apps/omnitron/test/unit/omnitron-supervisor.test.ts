import { describe, it, expect } from 'vitest';
import { SupervisionStrategy, RestartDecision } from '@omnitron-dev/titan-pm';
import {
  mapSupervisionStrategy,
  buildSupervisorOptions,
  defaultRestartDecision,
} from '../../src/supervisor/omnitron-supervisor.js';
import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import type { IEcosystemConfig } from '../../src/config/types.js';

describe('OmnitronSupervisor', () => {
  describe('mapSupervisionStrategy', () => {
    it('maps one_for_one', () => {
      expect(mapSupervisionStrategy('one_for_one')).toBe(SupervisionStrategy.ONE_FOR_ONE);
    });

    it('maps one_for_all', () => {
      expect(mapSupervisionStrategy('one_for_all')).toBe(SupervisionStrategy.ONE_FOR_ALL);
    });

    it('maps rest_for_one', () => {
      expect(mapSupervisionStrategy('rest_for_one')).toBe(SupervisionStrategy.REST_FOR_ONE);
    });

    it('defaults to ONE_FOR_ONE for unknown strategy', () => {
      expect(mapSupervisionStrategy('unknown')).toBe(SupervisionStrategy.ONE_FOR_ONE);
      expect(mapSupervisionStrategy('')).toBe(SupervisionStrategy.ONE_FOR_ONE);
    });
  });

  describe('buildSupervisorOptions', () => {
    it('maps ecosystem config to ISupervisorOptions', () => {
      const config = {
        apps: [],
        supervision: DEFAULT_ECOSYSTEM.supervision,
        monitoring: DEFAULT_ECOSYSTEM.monitoring,
        logging: DEFAULT_ECOSYSTEM.logging,
        daemon: DEFAULT_ECOSYSTEM.daemon,
        env: 'test',
      } as IEcosystemConfig;

      const opts = buildSupervisorOptions(config);
      expect(opts.strategy).toBe(SupervisionStrategy.ONE_FOR_ONE);
      expect(opts.maxRestarts).toBe(5);
      expect(opts.window).toBe(60_000);
      expect(opts.backoff).toEqual(DEFAULT_ECOSYSTEM.supervision.backoff);
    });
  });

  describe('defaultRestartDecision', () => {
    it('returns RESTART when under limit', () => {
      expect(defaultRestartDecision('app', true, 0, 5)).toBe(RestartDecision.RESTART);
      expect(defaultRestartDecision('app', false, 4, 5)).toBe(RestartDecision.RESTART);
    });

    it('returns ESCALATE for critical app exceeding limit', () => {
      expect(defaultRestartDecision('app', true, 5, 5)).toBe(RestartDecision.ESCALATE);
      expect(defaultRestartDecision('app', true, 10, 5)).toBe(RestartDecision.ESCALATE);
    });

    it('returns IGNORE for non-critical app exceeding limit', () => {
      expect(defaultRestartDecision('app', false, 5, 5)).toBe(RestartDecision.IGNORE);
      expect(defaultRestartDecision('app', false, 10, 5)).toBe(RestartDecision.IGNORE);
    });
  });
});
