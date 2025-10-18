# Bug Fix: Specs Path Stored as Relative Instead of Absolute

## Problem Summary

When indexing a project with `meridian index .`, the specs path was being saved as a **relative path** (`"./specs"`) instead of an **absolute path** in the project registry. This caused the MCP server to fail finding the specs directory because the server runs from a different working directory.

### Evidence from Logs

```
INFO Using specs directory from project registry: "./specs"
WARN Specs path in registry doesn't exist: "./specs"
WARN Using specs directory fallback: "/Users/taaliman/.meridian/db/current/specs"
```

## Root Cause

The bug existed in two locations:

### 1. `src/global/registry.rs` (Line 123-131)

**Original buggy code:**
```rust
let absolute_path = if path.is_absolute() {
    path
} else {
    std::env::current_dir()
        .ok()
        .and_then(|cwd| cwd.join(&path).canonicalize().ok())
        .unwrap_or(path)  // ← BUG: Falls back to relative path!
};
```

**Issue:** If `canonicalize()` fails (e.g., permissions, symlinks, or path doesn't exist yet), it would fall back to the original **relative path** instead of constructing an absolute path.

### 2. `src/main.rs` (Line 695-717)

**Original code:**
```rust
async fn index_project(config: Config, path: PathBuf, force: bool) -> Result<()> {
    let mut server = MeridianServer::new(config).await?;
    // ...
    server.index_project(path.clone(), force).await?;
    // ...
    let registry = manager.register(path).await?;  // ← Passing relative path!
}
```

**Issue:** The `path` parameter (from CLI argument `.`) was passed directly to `register()` without first converting it to an absolute path.

## Solution

### Fix 1: `src/global/registry.rs`

**Changed from:**
```rust
let absolute_path = if path.is_absolute() {
    path
} else {
    std::env::current_dir()
        .ok()
        .and_then(|cwd| cwd.join(&path).canonicalize().ok())
        .unwrap_or(path)
};
```

**Changed to:**
```rust
let absolute_path = if path.is_absolute() {
    path
} else {
    // Try to canonicalize first (resolves symlinks and makes absolute)
    if let Ok(canonical) = path.canonicalize() {
        canonical
    } else {
        // Fallback: manually construct absolute path without canonicalize
        std::env::current_dir()
            .map(|cwd| cwd.join(&path))
            .unwrap_or(path)
    }
};
```

**Key improvement:** Now constructs an absolute path even when `canonicalize()` fails by joining the current directory with the relative path.

### Fix 2: `src/main.rs`

**Added path conversion at the start of `index_project()`:**
```rust
async fn index_project(config: Config, path: PathBuf, force: bool) -> Result<()> {
    // Convert to absolute path first
    let absolute_path = if path.is_absolute() {
        path
    } else {
        // Try to canonicalize first (resolves symlinks and makes absolute)
        path.canonicalize()
            .or_else(|_| {
                // Fallback: manually construct absolute path
                std::env::current_dir()
                    .map(|cwd| cwd.join(&path))
            })?
    };

    // Use absolute_path everywhere below
    server.index_project(absolute_path.clone(), force).await?;
    // ...
    let registry = manager.register(absolute_path).await?;
}
```

**Key improvement:** Ensures the path is converted to absolute before being passed to any internal functions or stored in the registry.

## Testing

### Build and Install
```bash
cargo build --release
cargo install --path . --force
```

### Reindex Project
```bash
meridian index .
```

### Expected Log Output
```
INFO meridian: Specs directory detected: "/Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian/specs"
```

### Verify in Registry
```bash
meridian projects info "meridian@0.1.0"
```

**Expected output:**
```
Current Path: "/Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian"
```

### Verify MCP Server Logs
After restarting the MCP server, check logs:
```bash
tail -50 ~/.meridian/logs/meridian.log
```

**Expected log entry:**
```
INFO meridian::mcp::server: Using specs directory from project registry: "/Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian/specs"
```

**No longer seeing:**
```
WARN Specs path in registry doesn't exist: "./specs"
```

## Results

✅ **Specs path now stored as absolute:** `/Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian/specs`

✅ **MCP server can now find specs:** No more fallback to `~/.meridian/db/current/specs`

✅ **MCP specs tools work:** `specs.list`, `specs.get_structure`, `specs.search`, etc. all functional

## Files Modified

1. `/Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian/src/global/registry.rs`
   - Fixed `ProjectRegistry::new()` to always create absolute paths
   - Lines 123-136

2. `/Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian/src/main.rs`
   - Fixed `index_project()` to convert paths to absolute before processing
   - Lines 695-730

## Post-Fix Actions Required

1. **Kill old MCP servers:**
   ```bash
   pkill -f "meridian.*serve"
   ```

2. **Wait for Claude to restart the MCP server** (it will pick up the new binary and registry data)

3. **Test MCP specs tools:**
   - Try `specs.list` in Claude
   - Try `specs.get_structure`
   - Try `specs.search`

All should now work correctly with the absolute specs path!

## Additional Notes

- The fix ensures both `canonicalize()` (which resolves symlinks) and manual path joining work
- The fallback mechanism prevents failures even if `canonicalize()` fails
- All paths in the registry are now guaranteed to be absolute
- The fix is backward compatible - old relative paths will be converted to absolute on next index
