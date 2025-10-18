# Multi-Monorepo Setup Guide

**Version**: 2.0.0
**Last Updated**: October 18, 2025
**Status**: Production-Ready
**Audience**: Intermediate users, DevOps, Team Leads

---

## Table of Contents

1. [Introduction](#introduction)
2. [Architecture Overview](#architecture-overview)
3. [Prerequisites](#prerequisites)
4. [Global Server Setup](#global-server-setup)
5. [Registering Monorepos](#registering-monorepos)
6. [Cross-Repository Access](#cross-repository-access)
7. [Managing Multiple Projects](#managing-multiple-projects)
8. [Synchronization Strategies](#synchronization-strategies)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

---

## Introduction

### Why Multi-Monorepo?

In real-world development, you often work across multiple monorepos:

```
/Users/dev/
  ├── work/
  │   ├── frontend-monorepo/     # Monorepo A
  │   │   └── packages/ui-kit    # Depends on auth-lib
  │   └── backend-monorepo/      # Monorepo B
  │       └── packages/auth-lib  # Used by ui-kit
  └── personal/
      └── side-project/          # Monorepo C
          └── packages/analytics # Depends on ui-kit
```

**Problem**: When working on `ui-kit`, you can't access documentation from `auth-lib` in a different monorepo.

**Solution**: Meridian's Global Architecture provides:
- Single global registry of all projects
- Cross-repository documentation access
- Unified search across all monorepos
- Identity-based project IDs (survive moves/renames)

### Key Concepts

**Global Server**: Central daemon managing all monorepos on your machine

**Project Registry**: Database of all projects, regardless of location

**Local MCP Server**: Per-monorepo server connecting to global server

**Identity-based IDs**: Projects identified by `@scope/name`, not path

---

## Architecture Overview

### Two-Tier Architecture

```
┌─────────────────────────────────────────┐
│  Claude Code (MCP Client)              │
└────────────────┬────────────────────────┘
                 │ STDIO
┌────────────────▼────────────────────────┐
│  Local MCP Server                       │
│  (per-monorepo)                         │
│  - Local cache                          │
│  - Offline mode                         │
└────────────────┬────────────────────────┘
                 │ HTTP/IPC
┌────────────────▼────────────────────────┐
│  Global Server (daemon)                 │
│  - Project Registry                     │
│  - Global Index                         │
│  - File Watching                        │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│  Storage                                │
│  - Global DB: ~/.meridian/data/         │
│  - Local Caches: [repo]/.meridian/      │
└─────────────────────────────────────────┘
```

### Data Flow

**Indexing** (bottom-up):
```
Source Code → Local MCP Server → Global Server → Global DB
```

**Query** (top-down):
```
Claude Code → Local MCP Server → Local Cache (if available)
                                ↓ (if miss)
                        Global Server → Global DB
```

### Storage Locations

**Global Storage** (`~/.meridian/`):
```
~/.meridian/
  ├── meridian.toml           # Global config
  ├── data/                   # Global RocksDB
  │   ├── registry/          # Project registry
  │   ├── symbols/           # All symbols
  │   └── docs/              # Documentation
  ├── logs/                  # Server logs
  └── server.pid             # Running server PID
```

**Local Storage** (`[monorepo]/.meridian/`):
```
[monorepo]/.meridian/
  ├── meridian.toml          # Local config
  ├── cache.db/              # Local cache
  └── state.json             # Sync state
```

---

## Prerequisites

### System Requirements

- **Meridian**: v2.0.0+ installed globally
- **Disk Space**:
  - Global: ~100MB + 10MB per project
  - Local: ~50MB per monorepo
- **Network**: Not required (all local IPC)
- **Permissions**: Read/write to `~/.meridian/` and project directories

### Installation Check

```bash
# Verify Meridian version
meridian --version
# Output: meridian 2.0.0

# Check global initialization
ls ~/.meridian/
# Output: meridian.toml data/ logs/
```

If not initialized:
```bash
meridian init --global
```

---

## Global Server Setup

### Starting the Global Server

```bash
# Start as daemon (recommended)
meridian server start --daemon

# Output:
# Starting Meridian Global Server...
# PID: 12345
# Listening on: http://localhost:7878
# Log file: ~/.meridian/logs/server.log
# Started successfully ✓
```

### Verify Server is Running

```bash
meridian server status

# Output:
# Meridian Global Server
# ════════════════════════════════════
# Status:              Running ✓
# PID:                 12345
# Uptime:              5m 23s
# Port:                7878
#
# Statistics:
# Registered monorepos: 0
# Total projects:       0
# Memory usage:         28.4 MB
# Requests handled:     0
```

### Server Configuration

Edit `~/.meridian/meridian.toml`:

```toml
[server]
host = "localhost"
port = 7878
daemon = true
auto_start = true  # Auto-start on first MCP connection

[storage]
data_dir = "~/.meridian/data"
cache_size_mb = 1024
compression = "zstd"

[indexing]
auto_index_on_add = true
watch_enabled = true
max_concurrent_indexes = 4

[cross_monorepo]
enable = true
cache_external_docs = true
max_dependency_depth = 3

[logging]
level = "info"
file = "~/.meridian/logs/server.log"
max_size_mb = 100
```

### Server Management

```bash
# Stop server
meridian server stop

# Restart server
meridian server restart

# View logs (live)
meridian server logs --follow

# View logs (last 50 lines)
meridian server logs --tail 50
```

---

## Registering Monorepos

### Auto-Discovery

```bash
# Navigate to monorepo root
cd /Users/dev/work/frontend-monorepo

# Add to global registry
meridian projects add .

# Output:
# Scanning workspace...
# Workspace type: pnpm
# Found 5 packages:
#   - @company/ui-kit
#   - @company/components
#   - @company/utils
#   - @company/core
#   - @company/api
#
# Registered monorepo: frontend-app
# Monorepo ID: frontend-app
# Projects registered: 5
# Starting indexing...
#
# Indexed 2,456 symbols in 89 files (5.2s)
# Status: Active ✓
```

### Manual Registration

```bash
# Register with explicit ID
meridian projects add /Users/dev/work/backend-monorepo --id backend-services

# Register multiple at once
meridian projects add \
  /Users/dev/work/frontend-monorepo \
  /Users/dev/work/backend-monorepo \
  /Users/dev/personal/side-project
```

### Listing Registered Monorepos

```bash
meridian projects list

# Output:
# Registered Monorepos
# ════════════════════════════════════════════════════════════
#
# 1. frontend-app (pnpm)
#    Path: /Users/dev/work/frontend-monorepo
#    Projects: 5
#    Last indexed: 2 minutes ago
#    Status: Active ✓
#
# 2. backend-services (pnpm)
#    Path: /Users/dev/work/backend-monorepo
#    Projects: 3
#    Last indexed: 5 minutes ago
#    Status: Active ✓
#
# 3. side-project (npm)
#    Path: /Users/dev/personal/side-project
#    Projects: 2
#    Last indexed: 1 hour ago
#    Status: Active ✓
#
# Total: 3 monorepos, 10 projects
```

### Project Details

```bash
meridian projects info frontend-app

# Output:
# Monorepo: frontend-app
# ════════════════════════════════════════════════════════════
# ID:              frontend-app
# Type:            pnpm
# Path:            /Users/dev/work/frontend-monorepo
# Content Hash:    a1b2c3d4e5f6...
# Status:          Active
#
# Projects:
#   1. @company/ui-kit (TypeScript)
#      Path: packages/ui-kit
#      Symbols: 456
#      Dependencies: @company/core, @external/auth-lib
#
#   2. @company/components (TypeScript)
#      Path: packages/components
#      Symbols: 234
#      Dependencies: @company/ui-kit
#
#   (... 3 more projects)
#
# Statistics:
#   Total symbols: 2,456
#   Total files: 89
#   Index size: 25.4 MB
#   Last indexed: 2 minutes ago
#
# History:
#   - 2025-10-18 14:30: Registered at /Users/dev/work/frontend-monorepo
```

---

## Cross-Repository Access

### Use Case: Accessing External Documentation

**Scenario**: Working on `@company/ui-kit` (frontend-monorepo), need docs for `@external/auth-lib` (backend-monorepo).

### From Claude Code

```
User: Show me documentation for @external/auth-lib's authenticate function

Claude (uses): strong.external.get_documentation
{
  projectId: "@external/auth-lib",
  symbolName: "authenticate",
  includeExamples: true
}

Result: Documentation from backend-monorepo, cached locally
```

### MCP Tool: `strong.external.get_documentation`

```typescript
// Automatic cross-repo access
const docs = await mcp.call('strong.external.get_documentation', {
  projectId: '@external/auth-lib',
  symbolName: 'authenticate',
  includeExamples: true,
  includeSource: false  // Source code read-only
});

// Result includes:
// - Documentation
// - Examples
// - Type signatures
// - Monorepo location (for reference)
```

### Security & Isolation

**Read-Only Access**: Can read documentation and source code from other monorepos

**No Write Access**: Cannot modify code in other monorepos

**Access Control** (future):
```toml
# ~/.meridian/meridian.toml
[security]
enable_access_control = true
allowed_monorepos = ["frontend-app", "backend-services"]
blocked_projects = ["@company/secret-project"]
```

### Caching External Dependencies

**Automatic Caching**: First access fetches from global server, then cached locally

**Cache Location**: `[monorepo]/.meridian/cache.db/external/`

**TTL**: 24 hours by default

**Manual Cache Control**:
```bash
# Check cache status
meridian cache status

# Clear external deps cache
meridian cache clear --external

# Refresh specific project
meridian cache refresh @external/auth-lib
```

---

## Managing Multiple Projects

### Project Search

**Global Search**:
```bash
meridian projects search "auth"

# Output:
# Found 3 projects matching "auth":
#
# 1. @company/auth (backend-services)
#    Path: /Users/dev/work/backend-monorepo/packages/auth
#    Type: TypeScript
#
# 2. @external/auth-lib (backend-services)
#    Path: /Users/dev/work/backend-monorepo/packages/auth-lib
#    Type: TypeScript
#
# 3. @personal/auth-utils (side-project)
#    Path: /Users/dev/personal/side-project/packages/auth-utils
#    Type: TypeScript
```

**MCP Tool**: `strong.global.search_all_projects`
```typescript
const results = await mcp.call('strong.global.search_all_projects', {
  query: 'auth',
  type: 'typescript'
});
```

### Dependency Graph

**Cross-Monorepo Dependencies**:
```bash
meridian deps graph @company/ui-kit

# Output (Mermaid):
# graph TD
#   A[@company/ui-kit] --> B[@company/core]
#   A --> C[@external/auth-lib]  # Cross-monorepo!
#   B --> D[@company/utils]
#   C --> E[external-package-from-npm]
```

**MCP Tool**: `strong.global.get_dependency_graph`
```typescript
const graph = await mcp.call('strong.global.get_dependency_graph', {
  projectId: '@company/ui-kit',
  depth: 3,
  direction: 'both',  // incoming + outgoing
  includeExternal: true  // npm packages
});

// graph.nodes: All projects in dependency tree
// graph.edges: Dependency relationships
// graph.visualization: Mermaid diagram
```

### Finding Usages Across Monorepos

```bash
# Find all usages of a symbol across ALL monorepos
meridian usages "@external/auth-lib:authenticate"

# Output:
# Found 5 usages across 2 monorepos:
#
# frontend-app (3 usages):
#   - @company/ui-kit/src/login.ts:15
#   - @company/api/src/auth.ts:42
#   - @company/core/src/middleware.ts:28
#
# side-project (2 usages):
#   - @personal/analytics/src/auth.ts:10
#   - @personal/backend/src/routes.ts:55
```

**MCP Tool**: `strong.external.find_usages`
```typescript
const usages = await mcp.call('strong.external.find_usages', {
  projectId: '@external/auth-lib',
  symbolName: 'authenticate',
  includeTests: false
});
```

### Relocating Monorepos

**Scenario**: Moving monorepo to new location

```bash
# Before move
/Users/dev/work/frontend-monorepo  # Old location

# Move directory
mv /Users/dev/work/frontend-monorepo /Users/dev/projects/frontend-monorepo

# Update registry
meridian projects relocate frontend-app /Users/dev/projects/frontend-monorepo

# Output:
# Relocating monorepo: frontend-app
# Old path: /Users/dev/work/frontend-monorepo
# New path: /Users/dev/projects/frontend-monorepo
#
# Updated project paths:
#   - @company/ui-kit
#   - @company/components
#   - (... 3 more)
#
# Re-indexing not required (ID-based)
# File watcher updated ✓
# Done!
```

**Path History**: Preserved for audit

```bash
meridian projects info frontend-app

# Shows:
# History:
#   - 2025-10-15 10:00: /Users/dev/work/frontend-monorepo (discovered)
#   - 2025-10-18 14:00: /Users/dev/projects/frontend-monorepo (relocated)
```

---

## Synchronization Strategies

### Push Synchronization

**Local → Global**: Changes in monorepo pushed to global server

**Trigger**: File change detected

**Process**:
```
File Change → Local MCP Server → Incremental Re-index → Push to Global Server
```

**Configuration**:
```toml
# [monorepo]/.meridian/meridian.toml
[sync]
push_immediately = true  # Push changes immediately
sync_on_file_change = true
```

### Pull Synchronization

**Global → Local**: External dependencies pulled to local cache

**Trigger**: First access or cache miss

**Process**:
```
MCP Request → Local Cache Miss → Fetch from Global Server → Cache Locally
```

**Configuration**:
```toml
[cache]
cache_external_deps = true
ttl_hours = 24  # Re-fetch after 24 hours
```

### Periodic Sync

**Scheduled Updates**: Keep local cache fresh

```toml
[sync]
sync_interval_minutes = 5  # Sync every 5 minutes
```

### Manual Sync

```bash
# Sync specific monorepo
cd /path/to/monorepo
meridian sync

# Sync all monorepos
meridian sync --all

# Force full re-sync
meridian sync --force
```

### Offline Mode

**Automatic Fallback**: If global server unavailable

**Limitations**:
- Only local projects accessible
- Only cached external deps accessible
- No cross-monorepo search

**Detection**:
```bash
# Local MCP server logs
WARNING: Global server unavailable, switching to offline mode
```

---

## Best Practices

### For Individuals

1. **Register All Monorepos**: Add all your active monorepos to global registry
2. **Auto-Start Global Server**: Set `auto_start = true` in config
3. **Regular Cleanup**: Periodically remove stale monorepos
4. **Cache Management**: Clear cache if disk space is limited

### For Teams

1. **Shared Documentation**: Ensure all monorepos are indexed for team-wide access
2. **Consistent Naming**: Use `@company/` scope for consistency
3. **Access Control**: Configure allowed/blocked projects as needed
4. **Monitoring**: Track global server health and performance

### For Large Organizations

1. **Separate Global Servers**: One per team or department
2. **Network File Watching**: Disable if using network drives
3. **Index Scheduling**: Schedule re-indexing during off-hours
4. **Backup Strategy**: Regular backups of `~/.meridian/data/`

### Performance Optimization

**Ignore Patterns**:
```toml
[indexing]
ignore_patterns = [
  "node_modules",
  "target",
  "dist",
  "*.test.ts",
  "*.spec.ts",
  "*.min.js"
]
```

**Limit File Size**:
```toml
[indexing]
max_file_size = "1MB"  # Skip files > 1MB
```

**Concurrency**:
```toml
[indexing]
max_concurrent_indexes = 4  # Parallel indexing
```

---

## Troubleshooting

### Issue 1: Global Server Won't Start

**Symptom**: `Error: Failed to start global server`

**Diagnosis**:
```bash
# Check if port is in use
lsof -i :7878

# Check logs
cat ~/.meridian/logs/server.log
```

**Solution**:
```bash
# Change port in ~/.meridian/meridian.toml
[server]
port = 7879  # Use different port

# Restart
meridian server restart
```

### Issue 2: Monorepo Not Found

**Symptom**: `Error: Monorepo not registered`

**Diagnosis**:
```bash
# List registered monorepos
meridian projects list

# Search for monorepo
meridian projects search "frontend"
```

**Solution**:
```bash
# Re-add monorepo
meridian projects add /path/to/monorepo
```

### Issue 3: Cross-Repo Access Fails

**Symptom**: Can't access external project docs

**Diagnosis**:
```bash
# Check if external project is registered
meridian projects info @external/auth-lib

# Check access control
cat ~/.meridian/meridian.toml | grep -A5 security
```

**Solution**:
```bash
# Ensure project is registered
meridian projects add /path/to/external-monorepo

# Re-index if needed
meridian index --project @external/auth-lib
```

### Issue 4: Sync Failures

**Symptom**: Changes not reflected across monorepos

**Diagnosis**:
```bash
# Check sync state
cat [monorepo]/.meridian/state.json

# Check last sync time
meridian cache status
```

**Solution**:
```bash
# Force sync
meridian sync --force

# Clear cache and re-sync
meridian cache clear
meridian sync
```

### Issue 5: High Memory Usage

**Symptom**: Global server using >2GB RAM

**Diagnosis**:
```bash
# Check server stats
meridian server status

# Check index sizes
du -sh ~/.meridian/data/*
```

**Solution**:
```toml
# Reduce cache size in ~/.meridian/meridian.toml
[cache]
max_cache_size_mb = 512  # Reduce from 2048

# Cleanup old data
meridian cache clear --old-only
```

### Getting Support

**Documentation**:
- [Getting Started Guide](./getting-started.md)
- [MCP Integration Guide](./mcp-integration.md)
- [Global Architecture Spec](../global-architecture-spec.md)

**Logs**:
```bash
# Server logs
tail -100 ~/.meridian/logs/server.log

# Error logs
tail -100 ~/.meridian/logs/errors.log
```

**Report Issues**:
- GitHub: https://github.com/yourusername/meridian/issues
- Include: Version, OS, logs, configuration

---

**Guide Version**: 1.0.0
**Meridian Version**: 2.0.0
**Last Updated**: October 18, 2025
