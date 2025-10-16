import { describe, it, expect, beforeEach } from 'vitest';
import { Environment } from '../../../src/core/environment.js';
import {
  ValidatorFunction,
  EnvironmentContract,
  ValidationResult,
  VerificationResult,
  ContractResult,
} from '../../../src/types/validation.js';

describe('Environment - Advanced Validation', () => {
  let env: Environment;

  beforeEach(() => {
    env = Environment.create({
      name: 'test-validation',
      config: {
        server: {
          port: 3000,
          host: 'localhost',
        },
        database: {
          host: 'db.example.com',
          port: 5432,
          name: 'myapp',
        },
        api: {
          key: 'secret123',
          timeout: 5000,
        },
      },
    });
  });

  describe('Custom Validators', () => {
    it('should add custom validator for a path', () => {
      const validator: ValidatorFunction = (value) => ({
        valid: value > 1000 && value < 10000,
        message: 'Port must be between 1000 and 10000',
      });

      env.addValidator('server.port', validator);
      expect(env['validators'].size).toBe(1);
    });

    it('should remove custom validator for a path', () => {
      const validator: ValidatorFunction = (value) => ({ valid: true });

      env.addValidator('server.port', validator);
      expect(env['validators'].size).toBe(1);

      env.removeValidator('server.port');
      expect(env['validators'].size).toBe(0);
    });

    it('should execute sync custom validator during validate()', async () => {
      const validator: ValidatorFunction = (value) => ({
        valid: value > 1000 && value < 10000,
        message: 'Port must be between 1000 and 10000',
      });

      env.addValidator('server.port', validator);

      const result = await env.validate();
      expect(result.valid).toBe(true);
    });

    it('should fail validation when custom validator returns false', async () => {
      const validator: ValidatorFunction = (value) => ({
        valid: value > 10000,
        message: 'Port must be greater than 10000',
      });

      env.addValidator('server.port', validator);

      const result = await env.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toBe('Port must be greater than 10000');
    });

    it('should execute async custom validator', async () => {
      const asyncValidator: ValidatorFunction = async (value) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          valid: value === 'secret123',
          message: 'Invalid API key',
        };
      };

      env.addValidator('api.key', asyncValidator);

      const result = await env.validate();
      expect(result.valid).toBe(true);
    });

    it('should fail async custom validator', async () => {
      const asyncValidator: ValidatorFunction = async (value) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          valid: value === 'different-key',
          message: 'Invalid API key',
        };
      };

      env.addValidator('api.key', asyncValidator);

      const result = await env.validate();
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe('Invalid API key');
    });

    it('should handle validator that throws error', async () => {
      const errorValidator: ValidatorFunction = () => {
        throw new Error('Validator crashed');
      };

      env.addValidator('server.port', errorValidator);

      const result = await env.validate();
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain('Validator error: Validator crashed');
    });

    it('should provide validation context to validator', async () => {
      const contextValidator: ValidatorFunction = (value, context) => {
        const host = context.get('server.host');
        const hasPort = context.has('server.port');
        return {
          valid: hasPort && host === 'localhost',
          message: 'Server must be localhost with port',
        };
      };

      env.addValidator('server.port', contextValidator);

      const result = await env.validate();
      expect(result.valid).toBe(true);
    });

    it('should collect errors from multiple validators', async () => {
      const validator1: ValidatorFunction = () => ({
        valid: false,
        message: 'Error 1',
      });

      const validator2: ValidatorFunction = () => ({
        valid: false,
        message: 'Error 2',
      });

      env.addValidator('server.port', validator1);
      env.addValidator('server.host', validator2);

      const result = await env.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });

    it('should support validators returning error arrays', async () => {
      const validator: ValidatorFunction = () => ({
        valid: false,
        errors: [
          { path: 'server.port', message: 'Error A', value: 3000 },
          { path: 'server.port', message: 'Error B', value: 3000 },
        ],
      });

      env.addValidator('server.port', validator);

      const result = await env.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('verify() - Environment Verification', () => {
    it('should pass verification with valid config', async () => {
      const result = await env.verify();
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
      expect(result.remediable).toBe(true);
    });

    it('should detect empty configuration', async () => {
      const emptyEnv = Environment.create({ name: 'empty', config: {} });
      const result = await emptyEnv.verify({ checks: ['config'] });

      expect(result.passed).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].check).toBe('config');
      expect(result.failures[0].message).toContain('empty');
    });

    it('should verify specific checks only', async () => {
      const result = await env.verify({ checks: ['config'] });

      expect(result.passed).toBe(true);
      // Should only run config check, not schema or validators
    });

    it('should detect schema validation failures', async () => {
      const validator1: ValidatorFunction = () => ({
        valid: false,
        message: 'Schema error',
      });

      env.addValidator('server.port', validator1);

      const result = await env.verify({ checks: ['validators'] });

      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.check === 'validators')).toBe(true);
    });

    it('should check metadata integrity', async () => {
      // Manually corrupt the checksum
      (env.metadata as any).checksum = 'invalid-checksum';

      const result = await env.verify({ checks: ['metadata'] });

      expect(result.passed).toBe(false);
      const checksumFailure = result.failures.find((f) => f.check === 'metadata');
      expect(checksumFailure).toBeDefined();
      expect(checksumFailure!.message).toContain('drift');
    });

    it('should mark all failures as remediable or not', async () => {
      const throwingValidator: ValidatorFunction = () => {
        throw new Error('Unrecoverable error');
      };

      env.addValidator('server.port', throwingValidator);

      const result = await env.verify({ checks: ['validators'] });

      expect(result.passed).toBe(false);
      expect(result.remediable).toBe(false);
    });

    it('should check multiple targets', async () => {
      env.targets.define('production', {
        type: 'remote',
      });

      const result = await env.verify({
        targets: ['production'],
        checks: ['targets'],
      });

      expect(result.passed).toBe(true);
    });

    it('should detect missing targets', async () => {
      const result = await env.verify({
        targets: ['nonexistent'],
        checks: ['targets'],
      });

      expect(result.passed).toBe(false);
      const targetFailure = result.failures.find((f) => f.check === 'targets');
      expect(targetFailure).toBeDefined();
      expect(targetFailure!.target).toBe('nonexistent');
    });
  });

  describe('verifyContract() - Contract Verification', () => {
    it('should satisfy contract with all required fields present', async () => {
      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.port', 'server.host', 'database.port'],
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should detect missing required fields', async () => {
      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.port', 'server.ssl', 'database.password'],
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].type).toBe('missing');
      expect(result.violations[0].path).toBe('server.ssl');
    });

    it('should verify type constraints', async () => {
      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.port'],
        types: {
          'server.port': 'number',
          'server.host': 'string',
          'database.port': 'number',
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(true);
    });

    it('should detect type mismatches', async () => {
      env.set('server.port', 'not-a-number');

      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.port'],
        types: {
          'server.port': 'number',
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(false);
      expect(result.violations[0].type).toBe('type-mismatch');
      expect(result.violations[0].expected).toBe('number');
      expect(result.violations[0].actual).toBe('string');
    });

    it('should detect array type correctly', async () => {
      env.set('items', [1, 2, 3]);

      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['items'],
        types: {
          items: 'array',
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(true);
    });

    it('should verify numeric constraints (min)', async () => {
      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.port'],
        constraints: {
          'server.port': { min: 1000 },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(true);
    });

    it('should detect min constraint violation', async () => {
      env.set('server.port', 500);

      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.port'],
        constraints: {
          'server.port': { min: 1000 },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(false);
      expect(result.violations[0].type).toBe('constraint-violation');
      expect(result.violations[0].message).toContain('minimum');
    });

    it('should verify numeric constraints (max)', async () => {
      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.port'],
        constraints: {
          'server.port': { max: 10000 },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(true);
    });

    it('should detect max constraint violation', async () => {
      env.set('server.port', 99999);

      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.port'],
        constraints: {
          'server.port': { max: 10000 },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(false);
      expect(result.violations[0].type).toBe('constraint-violation');
      expect(result.violations[0].message).toContain('maximum');
    });

    it('should verify string length constraints (minLength)', async () => {
      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.host'],
        constraints: {
          'server.host': { minLength: 5 },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(true);
    });

    it('should detect minLength constraint violation', async () => {
      env.set('server.host', 'abc');

      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.host'],
        constraints: {
          'server.host': { minLength: 5 },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(false);
      expect(result.violations[0].message).toContain('minimum');
    });

    it('should verify string length constraints (maxLength)', async () => {
      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.host'],
        constraints: {
          'server.host': { maxLength: 50 },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(true);
    });

    it('should detect maxLength constraint violation', async () => {
      env.set('server.host', 'a'.repeat(100));

      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.host'],
        constraints: {
          'server.host': { maxLength: 50 },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(false);
      expect(result.violations[0].message).toContain('maximum');
    });

    it('should verify pattern constraints', async () => {
      env.set('server.host', '192.168.1.1');

      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.host'],
        constraints: {
          'server.host': { pattern: '^\\d+\\.\\d+\\.\\d+\\.\\d+$' },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(true);
    });

    it('should detect pattern constraint violation', async () => {
      env.set('server.host', 'invalid-ip');

      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.host'],
        constraints: {
          'server.host': { pattern: '^\\d+\\.\\d+\\.\\d+\\.\\d+$' },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(false);
      expect(result.violations[0].message).toContain('pattern');
    });

    it('should verify enum constraints', async () => {
      env.set('server.host', 'localhost');

      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.host'],
        constraints: {
          'server.host': { enum: ['localhost', '127.0.0.1', '0.0.0.0'] },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(true);
    });

    it('should detect enum constraint violation', async () => {
      env.set('server.host', 'example.com');

      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.host'],
        constraints: {
          'server.host': { enum: ['localhost', '127.0.0.1', '0.0.0.0'] },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(false);
      expect(result.violations[0].message).toContain('enum');
    });

    it('should verify array length constraints', async () => {
      env.set('items', [1, 2, 3]);

      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['items'],
        constraints: {
          items: { minLength: 2, maxLength: 5 },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(true);
    });

    it('should combine multiple constraint types', async () => {
      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.port', 'server.host'],
        types: {
          'server.port': 'number',
          'server.host': 'string',
        },
        constraints: {
          'server.port': { min: 1000, max: 65535 },
          'server.host': { minLength: 1, maxLength: 255 },
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(true);
    });

    it('should report multiple violations', async () => {
      env.set('server.port', 99999);

      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.port', 'server.ssl', 'database.user'],
        types: {
          'server.port': 'string', // Wrong type
        },
        constraints: {
          'server.port': { max: 10000 }, // Value too high
        },
      };

      const result = await env.verifyContract(contract);

      expect(result.satisfied).toBe(false);
      expect(result.violations.length).toBeGreaterThan(2);
    });
  });

  describe('Integration Tests', () => {
    it('should use custom validators and contract verification together', async () => {
      // Add custom validator
      const portValidator: ValidatorFunction = (value) => ({
        valid: value > 0 && value < 65536,
        message: 'Port must be between 0 and 65536',
      });

      env.addValidator('server.port', portValidator);

      // Verify with contract
      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['server.port', 'server.host'],
        types: {
          'server.port': 'number',
        },
        constraints: {
          'server.port': { min: 1000 },
        },
      };

      const validationResult = await env.validate();
      const contractResult = await env.verifyContract(contract);

      expect(validationResult.valid).toBe(true);
      expect(contractResult.satisfied).toBe(true);
    });

    it('should handle complex nested validation scenarios', async () => {
      env.set('config.nested.deep.value', 42);

      const validator: ValidatorFunction = (value) => ({
        valid: value === 42,
        message: 'Deep value must be 42',
      });

      env.addValidator('config.nested.deep.value', validator);

      const contract: EnvironmentContract = {
        version: '1.0.0',
        required: ['config.nested.deep.value'],
        types: {
          'config.nested.deep.value': 'number',
        },
      };

      const validationResult = await env.validate();
      const contractResult = await env.verifyContract(contract);

      expect(validationResult.valid).toBe(true);
      expect(contractResult.satisfied).toBe(true);
    });
  });
});
