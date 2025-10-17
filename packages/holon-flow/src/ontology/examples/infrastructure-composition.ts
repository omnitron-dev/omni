/**
 * Infrastructure Composition Examples
 *
 * Demonstrates composing infrastructure components with
 * ontological constraints for deployment targets.
 *
 * @module ontology/examples/infrastructure-composition
 */

import { Protocols } from '../core/protocols.js';
import { Capabilities, capability, capabilitySet, requirements } from '../core/capabilities.js';
import { component, composer, type Component } from '../core/composition.js';

/**
 * Infrastructure Component Types
 */

type ApplicationImage = {
  name: string;
  tag: string;
  size: number;
};

type ContainerConfig = {
  image: ApplicationImage;
  ports: number[];
  env: Record<string, string>;
  resources: {
    cpu: number;
    memory: string;
  };
};

type DeploymentManifest = {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
  };
  spec: any;
};

type DeploymentResult = {
  success: boolean;
  deploymentId: string;
  endpoint?: string;
};

/**
 * Application Builder Component
 */
const applicationBuilder = component<void, ApplicationImage>()
  .setId('infra:builder:app')
  .setName('Application Builder')
  .setVersion('1.0.0')
  .setInputType({ name: 'void' })
  .setOutputType({
    name: 'ApplicationImage',
    shape: {
      name: { name: 'string' },
      tag: { name: 'string' },
      size: { name: 'number' },
    },
  })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.FILESYSTEM))
  .addCapability(capability(Capabilities.CPU_INTENSIVE))
  .addCapability(capability(Capabilities.CONTAINER))
  .setExecute(async (_, context) => {
    context.logger?.info('Building application image...');

    // Simulate build process
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      name: 'my-app',
      tag: 'v1.0.0',
      size: 512 * 1024 * 1024, // 512 MB
    };
  })
  .setMetadata({
    description: 'Builds application into container image',
    tags: ['build', 'docker', 'infrastructure'],
  })
  .build();

/**
 * Container Configuration Component
 */
const containerConfigurator = component<ApplicationImage, ContainerConfig>()
  .setId('infra:config:container')
  .setName('Container Configurator')
  .setVersion('1.0.0')
  .setInputType({ name: 'ApplicationImage' })
  .setOutputType({ name: 'ContainerConfig' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.TRANSFORM))
  .addCapability(capability(Capabilities.STATELESS))
  .addRequirement(Capabilities.CONTAINER)
  .setExecute(async (image, context) => {
    context.logger?.info('Configuring container...', { image: image.name });

    return {
      image,
      ports: [8080, 9090],
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      resources: {
        cpu: 2,
        memory: '2Gi',
      },
    };
  })
  .setMetadata({
    description: 'Configures container with runtime parameters',
    tags: ['config', 'container'],
  })
  .build();

/**
 * Kubernetes Manifest Generator
 */
const k8sManifestGenerator = component<ContainerConfig, DeploymentManifest>()
  .setId('infra:generator:k8s')
  .setName('Kubernetes Manifest Generator')
  .setVersion('1.0.0')
  .setInputType({ name: 'ContainerConfig' })
  .setOutputType({ name: 'DeploymentManifest' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.TRANSFORM))
  .addCapability(capability(Capabilities.STATELESS))
  .addRequirement(Capabilities.CONTAINER)
  .setExecute(async (config, context) => {
    context.logger?.info('Generating Kubernetes manifest...');

    return {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: config.image.name,
        namespace: 'default',
      },
      spec: {
        replicas: 3,
        selector: {
          matchLabels: {
            app: config.image.name,
          },
        },
        template: {
          metadata: {
            labels: {
              app: config.image.name,
            },
          },
          spec: {
            containers: [
              {
                name: config.image.name,
                image: `${config.image.name}:${config.image.tag}`,
                ports: config.ports.map((port) => ({ containerPort: port })),
                env: Object.entries(config.env).map(([name, value]) => ({ name, value })),
                resources: {
                  requests: {
                    cpu: `${config.resources.cpu}`,
                    memory: config.resources.memory,
                  },
                  limits: {
                    cpu: `${config.resources.cpu}`,
                    memory: config.resources.memory,
                  },
                },
              },
            ],
          },
        },
      },
    };
  })
  .setMetadata({
    description: 'Generates Kubernetes deployment manifest',
    tags: ['k8s', 'manifest', 'infrastructure'],
  })
  .build();

/**
 * Kubernetes Deployer
 */
const k8sDeployer = component<DeploymentManifest, DeploymentResult>()
  .setId('infra:deployer:k8s')
  .setName('Kubernetes Deployer')
  .setVersion('1.0.0')
  .setInputType({ name: 'DeploymentManifest' })
  .setOutputType({ name: 'DeploymentResult' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.HTTP_CLIENT))
  .addCapability(capability(Capabilities.ASYNC))
  .addCapability(capability(Capabilities.RETRY))
  .addRequirement(Capabilities.TRANSFORM)
  .setExecute(async (manifest, context) => {
    context.logger?.info('Deploying to Kubernetes...', {
      name: manifest.metadata.name,
      namespace: manifest.metadata.namespace,
    });

    // Simulate deployment
    await new Promise((resolve) => setTimeout(resolve, 200));

    return {
      success: true,
      deploymentId: `deploy-${Date.now()}`,
      endpoint: `https://${manifest.metadata.name}.example.com`,
    };
  })
  .setMetadata({
    description: 'Deploys application to Kubernetes cluster',
    tags: ['k8s', 'deploy', 'infrastructure'],
  })
  .build();

/**
 * Docker Compose Generator (Alternative deployment target)
 */
const dockerComposeGenerator = component<ContainerConfig, string>()
  .setId('infra:generator:docker-compose')
  .setName('Docker Compose Generator')
  .setVersion('1.0.0')
  .setInputType({ name: 'ContainerConfig' })
  .setOutputType({ name: 'string' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.TRANSFORM))
  .addCapability(capability(Capabilities.STATELESS))
  .addRequirement(Capabilities.CONTAINER)
  .setExecute(async (config, context) => {
    context.logger?.info('Generating Docker Compose file...');

    const compose = `
version: '3.8'
services:
  ${config.image.name}:
    image: ${config.image.name}:${config.image.tag}
    ports:
${config.ports.map((port) => `      - "${port}:${port}"`).join('\n')}
    environment:
${Object.entries(config.env)
  .map(([name, value]) => `      ${name}: ${value}`)
  .join('\n')}
    deploy:
      resources:
        limits:
          cpus: '${config.resources.cpu}'
          memory: ${config.resources.memory}
`.trim();

    return compose;
  })
  .setMetadata({
    description: 'Generates Docker Compose configuration',
    tags: ['docker', 'compose', 'infrastructure'],
  })
  .build();

/**
 * AWS ECS Task Definition Generator (Another deployment target)
 */
const ecsTaskGenerator = component<ContainerConfig, any>()
  .setId('infra:generator:ecs')
  .setName('AWS ECS Task Generator')
  .setVersion('1.0.0')
  .setInputType({ name: 'ContainerConfig' })
  .setOutputType({ name: 'any' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.TRANSFORM))
  .addCapability(capability(Capabilities.STATELESS))
  .addRequirement(Capabilities.CONTAINER)
  .setExecute(async (config, context) => {
    context.logger?.info('Generating ECS task definition...');

    return {
      family: config.image.name,
      networkMode: 'awsvpc',
      requiresCompatibilities: ['FARGATE'],
      cpu: `${config.resources.cpu * 1024}`,
      memory: config.resources.memory.replace('Gi', '000'),
      containerDefinitions: [
        {
          name: config.image.name,
          image: `${config.image.name}:${config.image.tag}`,
          portMappings: config.ports.map((port) => ({
            containerPort: port,
            protocol: 'tcp',
          })),
          environment: Object.entries(config.env).map(([name, value]) => ({ name, value })),
        },
      ],
    };
  })
  .setMetadata({
    description: 'Generates AWS ECS task definition',
    tags: ['aws', 'ecs', 'infrastructure'],
  })
  .build();

/**
 * Demonstration of infrastructure composition
 */
export async function demonstrateInfrastructureComposition() {
  console.log('=== Infrastructure Composition Demo ===\n');

  const context = {
    correlationId: 'infra-demo',
    timestamp: Date.now(),
    environment: {},
    logger: {
      debug: (msg: string, meta?: any) => console.log('  [DEBUG]', msg, meta || ''),
      info: (msg: string, meta?: any) => console.log('  [INFO]', msg, meta || ''),
      warn: (msg: string, meta?: any) => console.log('  [WARN]', msg, meta || ''),
      error: (msg: string, meta?: any) => console.log('  [ERROR]', msg, meta || ''),
    },
  };

  // Scenario 1: Deploy to Kubernetes
  console.log('Scenario 1: Deploy to Kubernetes');
  console.log('---------------------------------');

  try {
    const k8sPipeline = composer.composePipeline(
      applicationBuilder,
      containerConfigurator,
      k8sManifestGenerator,
      k8sDeployer
    );

    console.log('✓ Composed K8s pipeline:', k8sPipeline.visualize());
    console.log('\nExecuting K8s deployment...');

    const result = await k8sPipeline.execute(undefined, context);
    console.log('✓ Deployment successful:', result);
    console.log('  Endpoint:', result.endpoint, '\n');
  } catch (error) {
    console.error('✗ Error:', (error as Error).message, '\n');
  }

  // Scenario 2: Generate Docker Compose (Alternative target)
  console.log('Scenario 2: Generate Docker Compose');
  console.log('-----------------------------------');

  try {
    const dockerPipeline = composer.composePipeline(applicationBuilder, containerConfigurator, dockerComposeGenerator);

    console.log('✓ Composed Docker pipeline:', dockerPipeline.visualize());
    console.log('\nGenerating Docker Compose...');

    const compose = await dockerPipeline.execute(undefined, context);
    console.log('✓ Docker Compose generated:');
    console.log(compose, '\n');
  } catch (error) {
    console.error('✗ Error:', (error as Error).message, '\n');
  }

  // Scenario 3: Generate ECS Task (Yet another target)
  console.log('Scenario 3: Generate AWS ECS Task');
  console.log('----------------------------------');

  try {
    const ecsPipeline = composer.composePipeline(applicationBuilder, containerConfigurator, ecsTaskGenerator);

    console.log('✓ Composed ECS pipeline:', ecsPipeline.visualize());
    console.log('\nGenerating ECS task definition...');

    const taskDef = await ecsPipeline.execute(undefined, context);
    console.log('✓ ECS task definition generated:');
    console.log(JSON.stringify(taskDef, null, 2), '\n');
  } catch (error) {
    console.error('✗ Error:', (error as Error).message, '\n');
  }

  // Scenario 4: Invalid composition (missing capabilities)
  console.log('Scenario 4: Invalid Composition');
  console.log('-------------------------------');

  const invalidComponent = component<ContainerConfig, any>()
    .setId('invalid')
    .setName('Invalid Component')
    .setVersion('1.0.0')
    .setInputType({ name: 'ContainerConfig' })
    .setOutputType({ name: 'any' })
    .setInputProtocol(Protocols.JSON)
    .setOutputProtocol(Protocols.JSON)
    .addCapability(capability(Capabilities.WRITE))
    // Missing CONTAINER capability requirement
    .addRequirement(Capabilities.DATABASE) // Wrong requirement
    .setExecute(async () => ({}))
    .build();

  try {
    const invalid = composer.compose(containerConfigurator, invalidComponent);
    console.log('✗ This should not succeed!');
  } catch (error: any) {
    console.log('✓ Composition correctly rejected:', error.message);
    console.log('  Reason:', error.reason?.details);
    console.log('  Suggestion:', error.reason?.suggestion, '\n');
  }

  console.log('=== Demo Complete ===');
}

/**
 * Export components
 */
export {
  applicationBuilder,
  containerConfigurator,
  k8sManifestGenerator,
  k8sDeployer,
  dockerComposeGenerator,
  ecsTaskGenerator,
};
