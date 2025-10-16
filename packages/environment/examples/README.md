# Environment Examples

This directory contains practical examples demonstrating how to use the `@omnitron-dev/environment` package.

## Running Examples

All examples can be run with:

```bash
tsx examples/<example-name>.ts
```

Or compile and run:

```bash
npm run build
node dist/examples/<example-name>.js
```

## Available Examples

### 1. basic-usage.ts
Demonstrates the fundamental operations:
- Creating environments
- Reading and updating configuration
- Validating configuration
- Saving and loading from disk
- Cloning environments
- Exporting to YAML

```bash
tsx examples/basic-usage.ts
```

### 2. multi-env.ts
Shows how to manage multiple environments:
- Creating base, dev, and production environments
- Merging configurations
- Diffing between environments
- Applying patches to promote changes
- Environment comparison matrix

```bash
tsx examples/multi-env.ts
```

### 3. secrets-management.ts (Coming Soon)
Will demonstrate:
- Configuring secrets providers
- Storing and retrieving encrypted secrets
- Using secrets in configuration
- Secret rotation

### 4. task-orchestration.ts (Coming Soon)
Will show:
- Defining tasks with dependencies
- Executing task workflows
- Handling task failures and retries
- Running tasks on different targets

### 5. deployment.ts (Coming Soon)
Will cover:
- Complete deployment workflow
- Multi-stage deployments (dev → staging → prod)
- Rolling back deployments
- Health checks and validation

## Output

Example outputs are saved to `examples/output/` directory.

## Notes

- All examples use TypeScript with Zod for schema validation
- Examples are self-contained and can be run independently
- Check each file for detailed inline comments explaining each step
