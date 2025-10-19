# macOS RocksDB Storage Fix

## Problem

RocksDB was failing on macOS with the following error:
```
IO error: lock hold by current process...No locks available
```

This occurs because macOS filesystems (APFS, HFS+) don't support the type of file locking that RocksDB expects by default. Specifically, macOS has different behavior for BSD-style file locks and POSIX-style file locks.

## Solution

We've implemented a multi-layered solution to make Meridian work cross-platform:

### 1. macOS-Specific RocksDB Configuration

The `RocksDBStorage::new()` method now includes macOS-specific configuration:

```rust
#[cfg(target_os = "macos")]
{
    // Disable adaptive mutex which can cause locking issues on macOS
    opts.set_use_adaptive_mutex(false);

    // Disable memory-mapped I/O which can cause file locking problems
    opts.set_allow_mmap_reads(false);
    opts.set_allow_mmap_writes(false);

    // Note: Direct I/O often fails on macOS APFS
    opts.set_use_direct_reads(false);
    opts.set_use_direct_io_for_flush_and_compaction(false);
}

// General optimizations for development
opts.set_max_open_files(256);  // Limit file handles
opts.increase_parallelism(2);  // Limit parallelism
```

**Why these settings work:**
- **Adaptive mutex**: macOS pthread implementation behaves differently, disabling this avoids lock contention issues
- **Memory-mapped I/O**: macOS APFS has different semantics for mmap that can cause lock conflicts
- **File handles**: Limiting open files reduces resource contention
- **Parallelism**: Lower parallelism reduces concurrent lock attempts

### 2. In-Memory Storage Fallback

We've implemented `MemoryStorage` as a fallback option:

```rust
pub struct MemoryStorage {
    data: Arc<RwLock<BTreeMap<Vec<u8>, Vec<u8>>>>,
}
```

**Features:**
- Thread-safe using `parking_lot::RwLock`
- Uses `BTreeMap` for sorted key storage (enables efficient prefix queries)
- Implements full `Storage` trait
- Supports snapshots (clones entire dataset)
- **Warning: Data is not persisted to disk**

### 3. Storage Factory with Automatic Fallback

The `factory` module provides smart storage creation:

```rust
pub async fn create_storage(path: &Path, config: StorageConfig) -> Result<Arc<dyn Storage>>
```

**Configuration Options:**

1. **Force Memory Storage** (for testing):
   ```bash
   MERIDIAN_USE_MEMORY_STORAGE=1 meridian
   ```

2. **Enable Automatic Fallback**:
   ```bash
   MERIDIAN_FALLBACK_MEMORY=1 meridian
   ```

**How it works:**
1. Tries to create RocksDB storage with macOS-specific configuration
2. If RocksDB fails and fallback is enabled, uses `MemoryStorage`
3. Logs clearly which backend is being used
4. On macOS lock errors, provides helpful error message

### 4. Enhanced Error Handling

The `GlobalStorage` implementation includes:

- Automatic stale LOCK file cleanup
- macOS-specific error messages
- Suggestions for using in-memory storage during development
- Detailed logging of configuration choices

## Usage

### Default Usage (Recommended)

```rust
use meridian::storage::create_default_storage;

let storage = create_default_storage(path).await?;
// Automatically handles macOS issues and falls back if needed
```

### Custom Configuration

```rust
use meridian::storage::{create_storage, StorageConfig};

// Force in-memory storage for testing
let config = StorageConfig::new().with_force_memory();
let storage = create_storage(path, config).await?;

// Enable fallback but prefer RocksDB
let config = StorageConfig::new().with_memory_fallback();
let storage = create_storage(path, config).await?;
```

### Environment Variables

- `MERIDIAN_USE_MEMORY_STORAGE=1` - Force in-memory storage (data not persisted)
- `MERIDIAN_FALLBACK_MEMORY=1` - Automatically fall back to memory if RocksDB fails

## Testing

Run macOS-specific tests:

```bash
cargo test --test storage_macos_test
```

### Test Coverage

1. **Basic Operations**: put, get, delete, exists
2. **Memory Fallback**: Force memory storage
3. **Batch Operations**: Multiple writes/deletes
4. **Prefix Queries**: Key range queries
5. **Snapshots**: Point-in-time views (memory storage only)
6. **macOS Configuration**: Multiple database opens without lock errors
7. **Concurrent Access**: Thread-safe operations

## Platform Compatibility

| Platform | RocksDB | Memory Storage | Status |
|----------|---------|----------------|--------|
| macOS (APFS) | ✅ With config | ✅ | Fully supported |
| macOS (HFS+) | ✅ With config | ✅ | Fully supported |
| Linux | ✅ Default | ✅ | Fully supported |
| Windows | ✅ Default | ✅ | Fully supported |

## Performance Considerations

### RocksDB (Recommended for Production)

- **Pros**: Persistent, high performance, handles large datasets
- **Cons**: More resource intensive, requires disk I/O

### Memory Storage (Development/Testing)

- **Pros**: Fast, no file locking issues, easy cleanup
- **Cons**: Data not persisted, limited by RAM, not suitable for production

## Migration Path

If you're using in-memory storage for development and want to switch to RocksDB:

1. Stop the Meridian daemon
2. Unset `MERIDIAN_USE_MEMORY_STORAGE`
3. Start Meridian - it will create a fresh RocksDB database
4. Re-index your projects

**Note**: There's no automatic migration between storage backends as they serve different use cases.

## Troubleshooting

### "Lock file already exists" error

**Solution**: The storage factory automatically handles this by:
1. Detecting lock errors
2. Removing stale LOCK files
3. Retrying the operation

### RocksDB still failing on macOS

**Temporary workaround**:
```bash
export MERIDIAN_USE_MEMORY_STORAGE=1
meridian
```

**Permanent solution**:
- Ensure no other processes are using the database
- Check file permissions on the database directory
- Try a different database path (e.g., `/tmp/meridian-db`)

### Performance issues with in-memory storage

**Solution**: In-memory storage is for development only. Use RocksDB for production:
```bash
unset MERIDIAN_USE_MEMORY_STORAGE
meridian
```

## Future Improvements

1. **Hybrid Mode**: Use memory storage for small datasets, RocksDB for large ones
2. **Automatic Migration**: Tool to export/import between storage backends
3. **Compression**: Add compression support for in-memory storage
4. **Persistence**: Optional snapshot-to-disk for memory storage
5. **Storage Metrics**: Detailed metrics for both backends

## Implementation Details

### File Structure

```
meridian/src/storage/
├── mod.rs                  # Storage trait definition
├── rocksdb_storage.rs      # RocksDB implementation (with macOS fix)
├── memory_storage.rs       # In-memory implementation
├── factory.rs              # Smart storage creation
└── ...                     # Other storage modules
```

### Key Changes

1. **rocksdb_storage.rs**:
   - Added `#[cfg(target_os = "macos")]` block with specific options
   - Enhanced error handling for lock files
   - Added resource limits

2. **memory_storage.rs** (new):
   - Complete in-memory implementation
   - Thread-safe with `RwLock`
   - Supports all `Storage` trait operations

3. **factory.rs** (new):
   - Automatic backend selection
   - Environment variable configuration
   - Helpful error messages

4. **global/storage.rs**:
   - Updated to use new configuration
   - Added macOS-specific error handling
   - Better logging

## References

- [RocksDB Options Documentation](https://github.com/facebook/rocksdb/wiki/Setup-Options-and-Basic-Tuning)
- [macOS File Locking Issues](https://github.com/facebook/rocksdb/issues/2296)
- [Rust RocksDB Bindings](https://docs.rs/rocksdb/latest/rocksdb/)
