# Global Configuration Architecture

## Overview

Meridian uses a **global-only** configuration architecture where all configuration is stored in a single location (`~/.meridian/meridian.toml`). This design eliminates project-local config files and provides a consistent, predictable configuration experience.

## Key Principles

### 1. Single Global Config

- **Location**: `~/.meridian/meridian.toml`
- **No local configs**: Projects do NOT have their own `meridian.toml` files
- **Centralized management**: All settings are managed in one place

### 2. Adaptive Detection

The system automatically detects:
- Project structure (monorepo vs single project)
- Language ecosystems (TypeScript, Rust, Python, Go, etc.)
- Project boundaries using configurable markers

### 3. Environment Variable Overrides

Configuration can be overridden via environment variables:
- `MERIDIAN_MCP_SOCKET` - Override MCP socket path
- `MERIDIAN_HTTP_PORT` - Override HTTP server port
- `MERIDIAN_MAX_TOKENS` - Override max token response limit

## Storage Architecture

### Index Location Strategy

Meridian uses a unified index storage strategy:

```
~/.meridian/
├── meridian.toml          # Global configuration
├── db/
│   └── current/
│       └── index/         # RocksDB index storage
├── data/                  # Project registry
├── cache/                 # Local project caches
└── logs/                  # Server logs
```

**No `.meridian/` directories in project folders!**

### Per-Project Caches

While the main index is global, project-specific caches are stored in:
```
~/.meridian/cache/<project-hash>/
```

The hash is computed from the project path, ensuring:
- Fast lookups
- No collisions
- Automatic cleanup when projects are removed

## Usage

### Initialize Global Config

```bash
# Create global config with defaults
meridian init-config
```

### Load Configuration

```rust
use meridian::Config;

// Load from global location (with env overrides)
let config = Config::load()?;

// For testing: load from specific path
let config = Config::from_file(&custom_path)?;
```

### Environment Overrides

```bash
# Override socket path
export MERIDIAN_MCP_SOCKET=/custom/path.sock

# Override HTTP port
export MERIDIAN_HTTP_PORT=9000

# Override max tokens
export MERIDIAN_MAX_TOKENS=5000

meridian serve --http
```

## Configuration Structure

### Index Settings

```toml
[index]
languages = ["rust", "typescript", "javascript", "markdown"]
ignore = ["node_modules", "target", ".git", "dist", "build"]
max_file_size = "1MB"
```

### Storage Settings

```toml
[storage]
path = "/Users/username/.meridian/db/current/index"
cache_size = "256MB"
```

**Note**: Storage path is always global. Do not use relative paths.

### Monorepo Detection

```toml
[monorepo]
detect_projects = true
project_markers = [
    "Cargo.toml",
    "package.json",
    "tsconfig.json",
    "go.mod",
]
```

The system automatically:
- Detects monorepo structures
- Identifies project boundaries
- Manages multiple projects in the global registry

### Memory Settings

```toml
[memory]
episodic_retention_days = 30
working_memory_size = "10MB"
consolidation_interval = "1h"
```

### Session Settings

```toml
[session]
max_sessions = 10
session_timeout = "1h"
```

### Learning Settings

```toml
[learning]
min_episodes_for_pattern = 3
confidence_threshold = 0.7
```

### MCP Server Settings

```toml
[mcp]
socket = "/tmp/meridian.sock"
max_token_response = 2000

[mcp.http]
enabled = true
host = "127.0.0.1"
port = 3000
cors_origins = ["*"]
max_connections = 100
```

## Migration from Local Configs

If you have an existing local `meridian.toml` in a project:

1. Initialize global config:
   ```bash
   meridian init-config
   ```

2. Copy desired settings from local config to `~/.meridian/meridian.toml`

3. Remove local config file:
   ```bash
   rm meridian.toml
   ```

4. The system will now use the global config for all projects

## Benefits

### For Users

- **Consistency**: Same settings across all projects
- **Simplicity**: One file to manage, not dozens
- **Portability**: Easy to backup and share settings
- **Flexibility**: Environment variables for runtime overrides

### For Developers

- **Predictability**: Always know where config is located
- **Testing**: Easy to test with temporary configs
- **Maintenance**: Single source of truth for configuration

## Advanced Usage

### Custom Config Locations (Testing)

```rust
use meridian::Config;

// Save to custom location
let config = Config::default();
config.save_to(&custom_path)?;

// Load from custom location
let config = Config::from_file(&custom_path)?;
```

### Programmatic Overrides

```rust
use meridian::Config;

let mut config = Config::load()?;

// Apply environment overrides
config.apply_env_overrides();

// Manual overrides
config.session.max_sessions = 20;
config.mcp.max_token_response = 5000;
```

## Best Practices

1. **Initialize early**: Run `meridian init-config` when setting up Meridian
2. **Use env vars for CI/CD**: Override settings in automated environments
3. **Keep it simple**: Use defaults unless you have specific needs
4. **Backup your config**: The global config is precious - back it up!
5. **Don't commit configs**: Never commit `~/.meridian/meridian.toml` to git

## Troubleshooting

### Config not found

```bash
# Symptom: "Global config not found" warning
# Solution: Initialize global config
meridian init-config
```

### Wrong storage path

```bash
# Symptom: Data stored in wrong location
# Check your config:
cat ~/.meridian/meridian.toml | grep "path ="

# Should be absolute path like:
# path = "/Users/username/.meridian/db/current/index"
```

### Environment variables not working

```bash
# Verify variable is set
echo $MERIDIAN_HTTP_PORT

# Run with verbose logging
meridian -v serve --http
```

## Future Enhancements

Planned improvements to the configuration system:

- **Config validation**: Automatic validation on load
- **Config migration**: Automatic migration from old formats
- **Config profiles**: Multiple named configurations (dev, prod, etc.)
- **Config UI**: Web-based configuration editor
- **Config sync**: Sync config across machines

## See Also

- [Storage Architecture](./STORAGE_ARCHITECTURE.md)
- [Project Registry](./PROJECT_REGISTRY.md)
- [Environment Variables](./ENVIRONMENT_VARIABLES.md)
