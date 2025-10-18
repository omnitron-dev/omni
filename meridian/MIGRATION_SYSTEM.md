# Schema Versioning and Migration System

## Overview

Meridian implements a robust schema versioning and migration system for its RocksDB storage layer. This system ensures safe evolution of data structures over time while maintaining backward compatibility and data integrity.

## Key Features

- **Automatic Version Detection**: Checks schema version on startup
- **Incremental Migrations**: Supports step-by-step migrations (v1→v2→v3)
- **Automatic Backups**: Creates backups before each migration
- **Rollback Capability**: Can restore from backup if migration fails
- **Migration History**: Tracks all migrations with timestamps and results
- **Atomic Operations**: Uses RocksDB transactions for safe migrations
- **Backward Compatible**: Handles data without version fields (assumes v1)

## Architecture

### Core Components

1. **SchemaVersion** (`src/storage/migration.rs`)
   - Version identifier (u32)
   - Current version: `CURRENT_SCHEMA_VERSION = 2`

2. **Migration Trait** (`src/storage/migration.rs`)
   - Interface for implementing migrations
   - Methods: `from_version()`, `to_version()`, `migrate_item()`

3. **MigrationRegistry** (`src/storage/migration.rs`)
   - Registry of available migrations
   - Calculates migration paths (e.g., v1→v2→v3)

4. **MigrationManager** (`src/storage/migration.rs`)
   - Orchestrates migration execution
   - Handles backups, rollbacks, and history

5. **Concrete Migrations** (`src/storage/migrations/`)
   - Task v1→v2: Adds `depends_on` and `related_tasks` fields

### Data Structures with Versioning

All versionable data structures include a `schema_version` field:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    // ... other fields
}
```

## Usage

### Automatic Migration on Startup

Migrations run automatically when the MCP server starts:

```rust
// In src/mcp/server.rs
let storage = Arc::new(RocksDBStorage::new(&config.storage.path)?);

// Check and migrate
crate::storage::check_and_migrate(storage.clone()).await?;
```

### Manual Migration Check

```bash
# Check migration status
meridian migration-status

# Run migrations manually
meridian migrate
```

### Creating New Migrations

1. **Update Current Version**

```rust
// In src/storage/migration.rs
pub const CURRENT_SCHEMA_VERSION: u32 = 3; // Increment
```

2. **Create Migration File**

```rust
// src/storage/migrations/task_v2_to_v3.rs
use crate::storage::migration::{Migration, SchemaVersion};
use async_trait::async_trait;

pub struct TaskV2ToV3Migration;

#[async_trait]
impl Migration for TaskV2ToV3Migration {
    fn from_version(&self) -> SchemaVersion {
        SchemaVersion::V2
    }

    fn to_version(&self) -> SchemaVersion {
        SchemaVersion::V3
    }

    fn name(&self) -> &str {
        "Task v2 → v3: Add new_field"
    }

    fn key_prefix(&self) -> &[u8] {
        b"task:"
    }

    async fn migrate_item(&self, key: &[u8], value: &[u8]) -> Result<Vec<u8>> {
        // Deserialize as v2
        let task_v2: TaskV2 = serde_json::from_slice(value)?;

        // Convert to v3
        let task_v3 = TaskV3 {
            // Copy existing fields
            id: task_v2.id,
            title: task_v2.title,
            // ... other fields

            // Add new field
            new_field: Some("default_value".to_string()),
        };

        // Serialize as v3
        Ok(serde_json::to_vec(&task_v3)?)
    }
}
```

3. **Register Migration**

```rust
// In src/storage/migrations/mod.rs
pub mod task_v2_to_v3;
pub use task_v2_to_v3::TaskV2ToV3Migration;

pub fn register_all_migrations(registry: &mut MigrationRegistry) {
    registry.register(Box::new(TaskV1ToV2Migration));
    registry.register(Box::new(TaskV2ToV3Migration)); // Add new migration
}
```

4. **Update Data Structure**

```rust
// In src/progress/types.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,

    // Existing fields...
    pub id: TaskId,
    pub title: String,

    // New field in v3
    pub new_field: Option<String>,
}
```

## Migration Workflow

1. **Version Check**
   - Server reads `_schema_version` from storage
   - Compares with `CURRENT_SCHEMA_VERSION`

2. **Migration Path Calculation**
   - Registry finds chain of migrations (e.g., v1→v2→v3)
   - Validates all migrations exist

3. **Backup Creation**
   - All affected data backed up with timestamp
   - Backup key: `_backup_YYYYMMDD_HHMMSS`

4. **Migration Execution**
   - Migrations run sequentially
   - Each item migrated individually
   - Uses RocksDB transactions for atomicity

5. **Version Update**
   - On success: Update `_schema_version`
   - On failure: Rollback from backup

6. **History Recording**
   - Record in `_migration_history`
   - Includes: timestamps, items migrated, success/failure

## Error Handling

### Migration Failure

If a migration fails:

1. **Automatic Rollback**: Data restored from backup
2. **Error Logging**: Detailed error messages logged
3. **Server Halt**: Server stops to prevent data corruption
4. **User Notification**: Clear error message displayed

Example error message:

```
✗ Migration failed: Failed to deserialize Task v2
Database has been rolled back to previous state
Please check the logs and report this issue
```

### Recovery

1. Check logs for error details
2. Fix underlying issue (if possible)
3. Delete backup if migration succeeded
4. Restart server to retry migration

## Backward Compatibility

### Missing Version Field

Data without `schema_version` field is assumed to be v1:

```rust
fn default_schema_version() -> u32 {
    crate::storage::CURRENT_SCHEMA_VERSION
}

#[serde(default = "default_schema_version")]
pub schema_version: u32,
```

### Optional Fields

New fields should be optional to allow deserialization of old data:

```rust
// Good - optional field
pub new_field: Option<String>,

// Bad - required field breaks compatibility
pub new_field: String,
```

## Testing

### Unit Tests

Each migration has its own tests:

```rust
#[tokio::test]
async fn test_task_v1_to_v2_migration() {
    let migration = TaskV1ToV2Migration;
    let v1_bytes = /* ... */;
    let v2_bytes = migration.migrate_item(key, &v1_bytes).await.unwrap();
    let task_v2: Task = serde_json::from_slice(&v2_bytes).unwrap();
    assert_eq!(task_v2.depends_on.len(), 0);
}
```

### Integration Tests

Full migration workflow tests in `src/storage/migration_tests.rs`:

- Multiple tasks migration
- Backup and rollback
- Migration history
- Backward compatibility

### Run Tests

```bash
cd meridian
cargo test migration
```

## Performance Considerations

### Large Datasets

For large datasets:

1. **Batching**: Migrations process items individually (no batching currently)
2. **Progress Logging**: Every 100 items logged
3. **Memory**: Minimal memory usage (stream processing)

### Downtime

Migrations run synchronously on startup:

- Small datasets (< 1000 items): < 1 second
- Medium datasets (1000-10k items): 1-10 seconds
- Large datasets (> 10k items): May take minutes

Consider offline migration for very large datasets.

## Monitoring

### Migration Logs

```
INFO Checking schema version...
INFO Current schema version: v1, Target version: v2
WARN Schema migration required: v1 -> v2
INFO Starting automatic migration...
INFO Running migration: Task v1 → v2: Add depends_on and related_tasks fields
INFO Found 1234 items to migrate
INFO Backup created: _backup_20240101_120000
INFO ✓ Migration completed successfully
INFO   - v1 -> v2: 1234 items migrated in 2.34s
INFO     Backup created: _backup_20240101_120000
```

### Migration Status

```bash
meridian migration-status
```

Output:
```
Schema Version Status
====================
Current version: v2
Target version:  v2

✓ Schema is up to date

Migration History:
------------------
1. v1 -> v2 at 2024-01-01 12:00:00
   Status: ✓ Success
   Items migrated: 1234
   Duration: 2.34s
   Backup: _backup_20240101_120000
```

## Troubleshooting

### "Migration failed" Error

1. Check logs for specific error
2. Verify data integrity
3. Report issue with error details

### "Schema version is newer than supported"

1. Upgrade Meridian to latest version
2. Or downgrade database (not recommended)

### Slow Migration

1. Check dataset size
2. Consider offline migration
3. Optimize migration code

## Future Enhancements

- [ ] Parallel migration processing
- [ ] Compression of backups
- [ ] Automatic backup cleanup (age-based)
- [ ] Migration progress API
- [ ] Dry-run mode for testing migrations
- [ ] Schema validation before migration
- [ ] Downgrade support (with data loss warnings)

## References

- Migration implementation: `src/storage/migration.rs`
- Concrete migrations: `src/storage/migrations/`
- Startup integration: `src/storage/startup.rs`
- Test suite: `src/storage/migration_tests.rs`
