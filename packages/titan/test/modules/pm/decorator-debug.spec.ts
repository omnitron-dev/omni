/**
 * Debug test for decorators
 */
import 'reflect-metadata';
import { describe, it, expect } from '@jest/globals';
import { Supervisor, Child, SUPERVISOR_METADATA_KEY } from '../../../src/modules/pm/decorators.js';
import { SupervisionStrategy } from '../../../src/modules/pm/types.js';

describe('Decorator Debug', () => {
  it('should properly apply decorators', () => {
    // Apply decorators step by step
    @Supervisor({
      strategy: SupervisionStrategy.ONE_FOR_ONE,
      maxRestarts: 5,
      window: 60000,
    })
    class TestSupervisor {
      @Child({ critical: true })
      critical = 'StableService';

      @Child({ optional: true })
      optional = 'UnstableService';
    }

    const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, TestSupervisor);
    console.log('Metadata:', metadata);
    console.log('Children Map:', metadata?.children);
    console.log('Children size:', metadata?.children?.size);

    expect(metadata).toBeDefined();
    expect(metadata.strategy).toBe(SupervisionStrategy.ONE_FOR_ONE);
    expect(metadata.maxRestarts).toBe(5);
    expect(metadata.children).toBeDefined();
    expect(metadata.children.size).toBe(2);
  });

  it('should track decorator application order', () => {
    const appliedDecorators: string[] = [];

    // Custom decorator that tracks application
    function TrackedChild(options: any = {}): PropertyDecorator {
      return (target: any, propertyKey: string | symbol) => {
        appliedDecorators.push(`Child:${String(propertyKey)}`);

        // Get or create metadata
        let metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, target.constructor);
        if (!metadata) {
          metadata = { children: new Map() };
        }
        if (!metadata.children) {
          metadata.children = new Map();
        }

        metadata.children.set(String(propertyKey), {
          name: String(propertyKey),
          processClass: null,
          propertyKey: String(propertyKey),
          ...options,
        });

        console.log(`Applied Child to ${String(propertyKey)}, map size: ${metadata.children.size}`);
        Reflect.defineMetadata(SUPERVISOR_METADATA_KEY, metadata, target.constructor);
      };
    }

    @Supervisor({
      strategy: SupervisionStrategy.ONE_FOR_ONE,
    })
    class TestSupervisor2 {
      @TrackedChild({ critical: true })
      worker1 = 'Service1';

      @TrackedChild({ optional: true })
      worker2 = 'Service2';
    }

    console.log('Applied decorators:', appliedDecorators);

    const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, TestSupervisor2);
    console.log('Final metadata:', metadata);
    console.log('Final children size:', metadata?.children?.size);

    expect(appliedDecorators).toContain('Child:worker1');
    expect(appliedDecorators).toContain('Child:worker2');
    expect(metadata.children.size).toBe(2);
  });
});
