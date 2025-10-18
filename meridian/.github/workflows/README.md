# GitHub Actions Workflows

This directory contains the CI/CD workflows for Meridian.

## Workflows

### 1. CI (`ci.yml`)

**Triggers:** Push and PR to `main` and `develop` branches

**Jobs:**
- **test**: Runs test suite on Linux, macOS, and Windows with stable, beta, and nightly Rust
- **coverage**: Generates code coverage using `cargo-llvm-cov` and uploads to Codecov
- **clippy**: Runs Clippy linting with warnings as errors
- **fmt**: Checks code formatting with rustfmt
- **benchmarks**: Runs Criterion benchmarks and tracks performance regressions
- **build**: Builds release binaries for all platforms

**Features:**
- Multi-platform testing (Linux, macOS, Windows)
- Multi-version testing (stable, beta, nightly)
- Cargo caching for faster builds
- Performance regression detection
- Artifact uploads for built binaries

### 2. Security (`security.yml`)

**Triggers:** Push, PR, and daily scheduled runs

**Jobs:**
- **audit**: Runs `cargo audit` to check for vulnerable dependencies
- **rustsec**: Uses `cargo-deny` to check RUSTSEC advisories, licenses, bans, and sources
- **supply-chain**: Runs `cargo-vet` for supply chain security
- **secret-scanning**: Uses Gitleaks to scan for leaked secrets
- **dependency-review**: Reviews dependencies in PRs for security issues
- **codeql**: Runs CodeQL security analysis
- **unused-deps**: Checks for unused dependencies with `cargo-udeps`

**Features:**
- Automated security scanning
- License compliance checking
- Daily scheduled scans
- Secret detection in commits
- Dependency vulnerability tracking

### 3. Release (`release.yml`)

**Triggers:** Push of version tags (e.g., `v1.0.0`)

**Jobs:**
- **create-release**: Creates GitHub release with auto-generated changelog
- **build-binaries**: Builds binaries for multiple platforms and architectures
  - Linux: x86_64, aarch64
  - macOS: x86_64, aarch64 (Apple Silicon)
  - Windows: x86_64
- **publish-crate**: Publishes to crates.io
- **docker**: Builds and pushes multi-arch Docker images

**Features:**
- Automated releases on tags
- Cross-platform binary builds
- Changelog generation from git commits
- Docker image builds (amd64 and arm64)
- Artifact compression and upload

## Local Testing

### Prerequisites

```bash
# Install act for local workflow testing
brew install act  # macOS
# or
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash  # Linux
```

### Running Workflows Locally

```bash
# Test CI workflow
act push -j test

# Test specific job
act push -j clippy

# Test with specific event
act pull_request -j test
```

### Validate YAML Syntax

```bash
# Using Python
python3 -c "
import yaml
with open('.github/workflows/ci.yml', 'r') as f:
    yaml.safe_load(f)
print('Valid YAML')
"

# Or install yamllint
brew install yamllint
yamllint .github/workflows/
```

## Configuration

### Secrets Required

Add these secrets to your GitHub repository settings:

- `CODECOV_TOKEN`: Token for Codecov coverage uploads
- `GITLEAKS_LICENSE`: License for Gitleaks (optional, works without)
- `CARGO_TOKEN`: Token for publishing to crates.io
- `DOCKER_USERNAME`: Docker Hub username
- `DOCKER_PASSWORD`: Docker Hub password

### Badge URLs

Add these to your README:

```markdown
[![CI](https://github.com/omnitron-dev/meridian/actions/workflows/ci.yml/badge.svg)](https://github.com/omnitron-dev/meridian/actions/workflows/ci.yml)
[![Security](https://github.com/omnitron-dev/meridian/actions/workflows/security.yml/badge.svg)](https://github.com/omnitron-dev/meridian/actions/workflows/security.yml)
[![codecov](https://codecov.io/gh/omnitron-dev/meridian/branch/main/graph/badge.svg)](https://codecov.io/gh/omnitron-dev/meridian)
```

## Caching Strategy

All workflows use aggressive caching to speed up builds:

- **Cargo registry**: `~/.cargo/registry`
- **Cargo git index**: `~/.cargo/git`
- **Target directory**: `target/`

Cache keys include:
- OS: `${{ runner.os }}`
- Rust version: `${{ matrix.rust }}`
- Lock file hash: `${{ hashFiles('**/Cargo.lock') }}`

## Performance Benchmarks

The CI workflow runs Criterion benchmarks and tracks performance over time using `benchmark-action/github-action-benchmark`.

**Alerts:**
- Triggered at 150% performance regression
- Comments on commits with regressions
- Does not fail CI (informational only)

## Release Process

1. Update version in `Cargo.toml`
2. Commit changes: `git commit -am "chore: bump version to 1.0.0"`
3. Create tag: `git tag -a v1.0.0 -m "Release v1.0.0"`
4. Push tag: `git push origin v1.0.0`
5. GitHub Actions will:
   - Build binaries for all platforms
   - Generate changelog
   - Create GitHub release
   - Publish to crates.io
   - Build and push Docker images

## Troubleshooting

### Workflow Fails on Specific Platform

Check the workflow run logs in GitHub Actions. Common issues:

- **macOS ARM builds**: Ensure dependencies support aarch64-apple-darwin
- **Windows builds**: Path separators and line endings
- **Linux ARM builds**: Cross-compilation tools installed correctly

### Cargo Audit Fails

Update dependencies:

```bash
cargo update
cargo audit
```

### CodeQL Analysis Issues

CodeQL analyzes Rust as C++ (LLVM IR). If it fails:

1. Check if the build succeeds locally
2. Ensure all dependencies build correctly
3. Review CodeQL logs for specific errors

### Docker Build Fails

Test locally:

```bash
docker build -t meridian:test .
docker run --rm meridian:test meridian --version
```

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [rust-toolchain Action](https://github.com/dtolnay/rust-toolchain)
- [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov)
- [cargo-deny](https://github.com/EmbarkStudios/cargo-deny)
- [Gitleaks](https://github.com/gitleaks/gitleaks)
