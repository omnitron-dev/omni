# GitHub Actions Workflows

This directory contains GitHub Actions workflows for the Omnitron monorepo.

## Workflows

### 1. CI (`ci.yml`)
**Trigger**: On push and pull requests to `main` and `develop` branches

Comprehensive CI pipeline that runs:
- **Linting and Formatting**: Checks code style and formatting
- **Core Package Tests**: Tests all core packages on Node.js 20.x and 22.x
- **Build Check**: Verifies all packages build successfully

### 2. Test Core Packages (`test-core-packages.yml`)
**Trigger**: On push/PR when core package files change

Tests individual core packages in parallel:
- `@omnitron-dev/common`
- `@omnitron-dev/eventemitter`
- `@omnitron-dev/smartbuffer`
- `@omnitron-dev/messagepack`

Features:
- Matrix strategy for testing on Node.js 20.x and 22.x
- Parallel execution for faster feedback
- Path-based triggers (only runs when relevant files change)
- Test result artifacts upload

### 3. Test All Core Packages (`test-all-core-packages.yml`)
**Trigger**: 
- Manual dispatch via GitHub UI
- Daily at 2 AM UTC
- On push to `main` branch

Comprehensive testing of all core packages with:
- Sequential test execution
- Detailed test summary report
- Coverage report uploads
- Continue-on-error for complete test visibility

## Caching Strategy

All workflows use aggressive caching to speed up builds:
- **Yarn dependencies**: Cached based on `yarn.lock` hash
- **Turbo build cache**: Incremental build caching for faster rebuilds
- **Node modules**: Yarn's Plug'n'Play cache optimization

## Test Coverage

Tests are run on:
- **Node.js versions**: 20.x, 22.x
- **Operating System**: Ubuntu latest
- **Packages covered**:
  - `@omnitron-dev/common` - Core utilities and helpers
  - `@omnitron-dev/eventemitter` - Event emitter implementation
  - `@omnitron-dev/smartbuffer` - Binary buffer operations
  - `@omnitron-dev/messagepack` - MessagePack serialization

## Running Workflows Locally

To test workflows locally, you can use [act](https://github.com/nektos/act):

```bash
# Install act
brew install act # macOS
# or
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash # Linux

# Run CI workflow
act -W .github/workflows/ci.yml

# Run specific job
act -W .github/workflows/test-core-packages.yml -j test
```

## Workflow Badges

Add these badges to your README:

```markdown
![CI](https://github.com/omnitron-dev/omni/workflows/CI/badge.svg)
![Test Core Packages](https://github.com/omnitron-dev/omni/workflows/Test%20Core%20Packages/badge.svg)
```

## Troubleshooting

### Common Issues

1. **Tests timeout**: Increase `NODE_OPTIONS: --max-old-space-size=4096`
2. **Cache miss**: Clear caches in GitHub Actions settings
3. **Yarn install fails**: Ensure `yarn.lock` is committed and up-to-date

### Debug Mode

Enable debug logging by setting these secrets in your repository:
- `ACTIONS_RUNNER_DEBUG`: `true`
- `ACTIONS_STEP_DEBUG`: `true`