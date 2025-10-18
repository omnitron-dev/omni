# Backup System - Quick Reference

## MCP Tools API

### backup.create - Create Manual Backup
```typescript
const backup = await mcp__meridian__backup_create({
  description: "Pre-deployment backup",
  tags: ["production", "deploy"]
});
// Returns: { backup_id, created_at, size_bytes, file_count, verified }
```

### backup.list - List Backups
```typescript
const backups = await mcp__meridian__backup_list({
  backup_type: "manual",  // Optional: manual|scheduled|pre_migration|incremental
  verified_only: true     // Optional: only show verified backups
});
// Returns: { backups: [...], total_count }
```

### backup.restore - Restore from Backup
```typescript
await mcp__meridian__backup_restore({
  backup_id: "20251018_214530_manual",
  target_path: "/optional/custom/path"  // Optional
});
// Returns: { success, restored_from }
```

### backup.verify - Verify Backup
```typescript
await mcp__meridian__backup_verify({
  backup_id: "20251018_214530_manual"
});
// Returns: { verified, verified_at, checksum_valid }
```

### backup.delete - Delete Backup
```typescript
await mcp__meridian__backup_delete({
  backup_id: "20251018_214530_manual"
});
// Returns: { success, deleted_backup_id }
```

### backup.get_stats - Get Statistics
```typescript
const stats = await mcp__meridian__backup_get_stats({});
// Returns: { total_backups, total_size_bytes, by_type, oldest_backup, newest_backup, verified_count, unverified_count }
```

### backup.create_scheduled - Scheduled Backup (Internal)
```typescript
const backup = await mcp__meridian__backup_create_scheduled({});
// Returns: { backup_id, created_at }
```

### backup.create_pre_migration - Pre-Migration Backup (Internal)
```typescript
const backup = await mcp__meridian__backup_create_pre_migration({
  schema_version: 2,
  description: "Before migrating to v3"
});
// Returns: { backup_id, schema_version }
```

## CLI Commands

```bash
# Create backup
backup_cli create "My backup" tag1 tag2

# List all backups
backup_cli list

# Verify backup
backup_cli verify 20251018_214530_manual

# Restore backup
backup_cli restore 20251018_214530_manual

# Delete backup
backup_cli delete 20251018_214530_manual

# Show statistics
backup_cli stats

# Create scheduled backup
backup_cli scheduled
```

## Common Workflows

### Before Risky Operation
```typescript
// 1. Create backup
const backup = await mcp__meridian__backup_create({
  description: "Before data migration",
  tags: ["migration", "safety"]
});

try {
  // 2. Perform risky operation
  await performDataMigration();
} catch (error) {
  // 3. Restore if failed
  await mcp__meridian__backup_restore({ backup_id: backup.backup_id });
  throw error;
}
```

### Check System Health
```typescript
const stats = await mcp__meridian__backup_get_stats({});

// Alert if no backup in 48 hours
const newest = new Date(stats.newest_backup);
const hours = (Date.now() - newest.getTime()) / (1000 * 60 * 60);
if (hours > 48) {
  alert("No backup in 48 hours!");
}

// Verify unverified backups
if (stats.unverified_count > 0) {
  const backups = await mcp__meridian__backup_list({ verified_only: false });
  for (const b of backups.backups) {
    if (!b.verified) {
      await mcp__meridian__backup_verify({ backup_id: b.id });
    }
  }
}
```

### Disaster Recovery
```typescript
// 1. List verified backups
const backups = await mcp__meridian__backup_list({ verified_only: true });

// 2. Show to user
backups.backups.forEach((b, i) => {
  console.log(`${i+1}. ${b.id} - ${b.created_at} (${b.description})`);
});

// 3. Restore selected backup
await mcp__meridian__backup_restore({
  backup_id: backups.backups[0].id  // Most recent
});
```

## Configuration

```rust
use meridian::storage::{BackupConfig, BackupManager};

let config = BackupConfig {
    backup_dir: PathBuf::from("~/.meridian/backups"),
    max_scheduled_backups: 7,        // Keep last 7 scheduled
    max_incremental_backups: 10,     // Keep last 10 incremental
    auto_verify: true,               // Verify after creation
    compress: false,                 // Future feature
};

let manager = BackupManager::new(db_path, config)?;
```

## Backup Structure

```
~/.meridian/backups/
  20251018_214530_manual/
    data/              # RocksDB checkpoint
    metadata.json      # Backup metadata
  20251018_020000_scheduled/
    data/
    metadata.json
```

## Performance

| Database Size | Backup | Restore | Verify |
|--------------|--------|---------|--------|
| 100 MB       | ~500ms | ~1s     | ~200ms |
| 1 GB         | ~3-5s  | ~8-10s  | ~1-2s  |
| 10 GB        | ~30-50s| ~80-100s| ~10-20s|

## Retention Policies

- **Manual backups**: Never auto-deleted
- **Scheduled backups**: Keep last 7 (configurable)
- **Pre-migration backups**: Never auto-deleted
- **Incremental backups**: Keep last 10 (configurable)

## Error Handling

All tools return errors with context:
```typescript
try {
  await mcp__meridian__backup_restore({ backup_id: "invalid" });
} catch (error) {
  console.error(error);
  // "Backup directory not found: ..."
  // "Checksum mismatch for backup ..."
  // "Failed to open backup database ..."
}
```

## Security

1. **Checksum Validation**: Blake3 hash verified on create and restore
2. **Safety Backups**: Automatic safety backup before restore
3. **Permissions**: Set `chmod 700 ~/.meridian/backups`
4. **Encryption**: Future enhancement (not yet implemented)

## Monitoring

Track these metrics:
- Backup age (alert if > 48 hours)
- Unverified backups (should be 0)
- Total size (alert if exceeds threshold)
- Backup success rate

## Troubleshooting

### "Permission denied"
```bash
chmod 700 ~/.meridian/backups
```

### "Checksum mismatch"
- Backup is corrupted
- Use a different backup
- Check disk for errors

### Too much disk space
```rust
// Reduce retention
BackupConfig {
    max_scheduled_backups: 3,  // Instead of 7
    ..Default::default()
}
```

## Integration Example

```rust
// In MCP server startup
let backup_manager = BackupManager::new(db_path, BackupConfig::default())?;
let backup_manager = Arc::new(RwLock::new(backup_manager));

handlers.set_backup_manager(backup_manager.clone());

// Start scheduled backups
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(86400));
    loop {
        interval.tick().await;
        let _ = backup_manager.write().await.create_scheduled_backup().await;
    }
});
```

## Files Reference

- **Implementation**: `src/storage/backup.rs` (649 lines)
- **Tests**: `src/storage/backup_tests.rs` (400+ lines)
- **MCP Tools**: `src/mcp/tools.rs` (backup section)
- **Handlers**: `src/mcp/handlers.rs` (backup handlers)
- **Documentation**: `BACKUP_SYSTEM.md` (550+ lines)
- **Examples**: `examples/backup_integration.rs`, `examples/backup_cli.rs`

## Help

For detailed documentation, see:
- `BACKUP_SYSTEM.md` - Complete system documentation
- `BACKUP_IMPLEMENTATION_SUMMARY.md` - Implementation details
- `examples/backup_integration.rs` - Integration examples
