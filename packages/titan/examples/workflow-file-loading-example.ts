/**
 * Workflow File Path Loading Example
 *
 * This example demonstrates how to load workflows from file paths
 * instead of class references, enabling better code organization,
 * dynamic workflow loading, and plugin-based architectures.
 */

import { createTestProcessManager } from '../src/modules/pm/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Example 1: Basic File-Based Workflow Loading
// ============================================================================

async function basicExample() {
  console.log('=== Example 1: Basic File-Based Workflow Loading ===\n');

  const pm = createTestProcessManager({ mock: true });

  try {
    // Load workflow from file path (instead of importing the class)
    const workflowPath = path.join(
      __dirname,
      '../test/modules/pm/fixtures/simple-workflow.ts'
    );

    const workflow = await pm.workflow(workflowPath);

    // Execute the workflow
    const result = await (workflow as any).run('hello-world');

    console.log('Workflow executed successfully!');
    console.log('Result:', JSON.stringify(result, null, 2));
    console.log('Execution log:', (workflow as any).executionLog);
  } finally {
    await pm.cleanup();
  }

  console.log('\n');
}

// ============================================================================
// Example 2: Dynamic Workflow Selection at Runtime
// ============================================================================

async function dynamicSelectionExample() {
  console.log('=== Example 2: Dynamic Workflow Selection ===\n');

  const pm = createTestProcessManager({ mock: true });

  try {
    // Simulate workflow selection from configuration or database
    const workflowType = process.env['WORKFLOW_TYPE'] || 'simple';

    const workflowRegistry: Record<string, string> = {
      simple: path.join(__dirname, '../test/modules/pm/fixtures/simple-workflow.ts'),
      complex: path.join(__dirname, '../test/modules/pm/fixtures/complex-workflow.ts'),
      pipeline: path.join(__dirname, '../test/modules/pm/fixtures/data-pipeline-workflow.ts'),
    };

    console.log(`Loading workflow type: ${workflowType}`);

    const workflowPath = workflowRegistry[workflowType];
    if (!workflowPath) {
      throw new Error(`Unknown workflow type: ${workflowType}`);
    }

    const workflow = await pm.workflow(workflowPath);
    console.log('Workflow loaded successfully from file path!');

    // Execute based on workflow type
    let result;
    if (workflowType === 'simple') {
      result = await (workflow as any).run('test-data');
    } else if (workflowType === 'complex') {
      result = await (workflow as any).run({
        orderId: 'ORD-123',
        amount: 100,
        userId: 'USER-456',
      });
    } else if (workflowType === 'pipeline') {
      result = await (workflow as any).run({
        type: 'database',
        url: 'postgresql://localhost/data',
      });
    }

    console.log('Workflow result:', JSON.stringify(result, null, 2));
  } finally {
    await pm.cleanup();
  }

  console.log('\n');
}

// ============================================================================
// Example 3: Plugin-Based Architecture
// ============================================================================

async function pluginArchitectureExample() {
  console.log('=== Example 3: Plugin-Based Architecture ===\n');

  const pm = createTestProcessManager({ mock: true });

  try {
    // Simulate loading workflows from plugins
    const plugins = [
      {
        name: 'data-processor',
        version: '1.0.0',
        workflowPath: path.join(__dirname, '../test/modules/pm/fixtures/data-pipeline-workflow.ts'),
      },
      {
        name: 'order-processor',
        version: '2.1.0',
        workflowPath: path.join(__dirname, '../test/modules/pm/fixtures/complex-workflow.ts'),
      },
      {
        name: 'simple-processor',
        version: '1.5.0',
        workflowPath: path.join(__dirname, '../test/modules/pm/fixtures/simple-workflow.ts'),
      },
    ];

    console.log(`Loading ${plugins.length} plugin workflows...\n`);

    // Load all plugin workflows
    const loadedPlugins = await Promise.all(
      plugins.map(async (plugin) => {
        console.log(`Loading plugin: ${plugin.name} v${plugin.version}`);
        const workflow = await pm.workflow(plugin.workflowPath);
        return {
          ...plugin,
          workflow,
        };
      })
    );

    console.log('\nAll plugins loaded successfully!\n');

    // Execute workflows from different plugins
    console.log('Executing data-processor plugin...');
    const dataResult = await (loadedPlugins[0].workflow as any).run({
      type: 'api',
      url: 'https://api.example.com/data',
    });
    console.log('Data pipeline metrics:', (loadedPlugins[0].workflow as any).getMetrics());

    console.log('\nExecuting order-processor plugin...');
    const orderResult = await (loadedPlugins[1].workflow as any).run({
      orderId: 'ORD-PLUGIN-001',
      amount: 250,
      userId: 'USER-PLUGIN',
    });
    console.log('Order processed:', orderResult['confirm-order']);

    console.log('\nExecuting simple-processor plugin...');
    const simpleResult = await (loadedPlugins[2].workflow as any).run('plugin-data');
    console.log('Simple processing result:', simpleResult);
  } finally {
    await pm.cleanup();
  }

  console.log('\n');
}

// ============================================================================
// Example 4: Multi-Tenant Workflow Isolation
// ============================================================================

async function multiTenantExample() {
  console.log('=== Example 4: Multi-Tenant Workflow Isolation ===\n');

  const pm = createTestProcessManager({ mock: true });

  try {
    // Simulate multi-tenant environment
    const tenants = [
      {
        id: 'tenant-acme-corp',
        name: 'ACME Corporation',
        workflowPath: path.join(__dirname, '../test/modules/pm/fixtures/simple-workflow.ts'),
      },
      {
        id: 'tenant-tech-startup',
        name: 'Tech Startup Inc',
        workflowPath: path.join(__dirname, '../test/modules/pm/fixtures/complex-workflow.ts'),
      },
      {
        id: 'tenant-enterprise',
        name: 'Enterprise Solutions Ltd',
        workflowPath: path.join(__dirname, '../test/modules/pm/fixtures/data-pipeline-workflow.ts'),
      },
    ];

    console.log(`Setting up workflows for ${tenants.length} tenants...\n`);

    // Load workflows for each tenant
    const tenantWorkflows = await Promise.all(
      tenants.map(async (tenant) => {
        console.log(`Loading workflow for: ${tenant.name} (${tenant.id})`);
        const workflow = await pm.workflow(tenant.workflowPath);
        return {
          ...tenant,
          workflow,
        };
      })
    );

    console.log('\nAll tenant workflows loaded!\n');

    // Execute workflows for different tenants concurrently
    console.log('Processing requests for all tenants concurrently...');
    const results = await Promise.all([
      (tenantWorkflows[0].workflow as any).run('acme-data'),
      (tenantWorkflows[1].workflow as any).run({
        orderId: 'ORD-ACME-001',
        amount: 500,
        userId: 'acme-user',
      }),
      (tenantWorkflows[2].workflow as any).run({
        type: 'database',
        url: 'enterprise://data',
      }),
    ]);

    console.log('\nAll tenant workflows executed successfully!');
    console.log('ACME Corp result:', results[0].step1);
    console.log('Tech Startup result:', results[1].validate);
    console.log('Enterprise result:', results[2].extract);
  } finally {
    await pm.cleanup();
  }

  console.log('\n');
}

// ============================================================================
// Example 5: Hot-Reloading Workflows
// ============================================================================

async function hotReloadExample() {
  console.log('=== Example 5: Hot-Reloading Workflows ===\n');

  const pm = createTestProcessManager({ mock: true });

  try {
    const workflowPath = path.join(__dirname, '../test/modules/pm/fixtures/simple-workflow.ts');

    console.log('Loading workflow version 1...');
    const workflow1 = await pm.workflow(workflowPath);
    const result1 = await (workflow1 as any).run('version-1-data');
    console.log('Version 1 executed:', result1.step1);

    // Simulate workflow reload (in production, the file might have changed)
    console.log('\nReloading workflow (simulating file update)...');
    const workflow2 = await pm.workflow(workflowPath);
    const result2 = await (workflow2 as any).run('version-2-data');
    console.log('Version 2 executed:', result2.step1);

    console.log('\nBoth versions executed successfully with different inputs!');
    console.log('Each workflow instance maintains its own state.');
  } finally {
    await pm.cleanup();
  }

  console.log('\n');
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('WORKFLOW FILE PATH LOADING EXAMPLES');
  console.log('='.repeat(70) + '\n');

  try {
    await basicExample();
    await dynamicSelectionExample();
    await pluginArchitectureExample();
    await multiTenantExample();
    await hotReloadExample();

    console.log('='.repeat(70));
    console.log('All examples completed successfully!');
    console.log('='.repeat(70) + '\n');
  } catch (error) {
    console.error('Example failed:', error);
    process.exit(1);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { basicExample, dynamicSelectionExample, pluginArchitectureExample, multiTenantExample, hotReloadExample };
