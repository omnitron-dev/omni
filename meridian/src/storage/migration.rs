// Schema versioning and migration system for RocksDB storage

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

use super::Storage;

/// Current schema version - increment when making schema changes
pub const CURRENT_SCHEMA_VERSION: u32 = 2;

/// Schema version identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct SchemaVersion(pub u32);

impl SchemaVersion {
    pub const V1: Self = Self(1);
    pub const V2: Self = Self(2);

    pub fn current() -> Self {
        Self(CURRENT_SCHEMA_VERSION)
    }

    pub fn is_current(&self) -> bool {
        self.0 == CURRENT_SCHEMA_VERSION
    }
}

impl std::fmt::Display for SchemaVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "v{}", self.0)
    }
}

/// Migration result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationResult {
    pub from_version: SchemaVersion,
    pub to_version: SchemaVersion,
    pub started_at: DateTime<Utc>,
    pub completed_at: DateTime<Utc>,
    pub items_migrated: usize,
    pub backup_key: Option<String>,
    pub success: bool,
    pub error: Option<String>,
}

/// Migration history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationHistory {
    pub migrations: Vec<MigrationResult>,
}

impl MigrationHistory {
    pub fn new() -> Self {
        Self {
            migrations: Vec::new(),
        }
    }

    pub fn add(&mut self, result: MigrationResult) {
        self.migrations.push(result);
    }

    pub fn last_successful_migration(&self) -> Option<&MigrationResult> {
        self.migrations.iter().rev().find(|m| m.success)
    }
}

impl Default for MigrationHistory {
    fn default() -> Self {
        Self::new()
    }
}

/// Trait for data that can be migrated
#[async_trait]
pub trait Migratable: Send + Sync {
    /// Get the schema version of this data
    fn schema_version(&self) -> SchemaVersion;

    /// Get the storage key for this data
    fn storage_key(&self) -> Vec<u8>;

    /// Serialize to bytes
    fn to_bytes(&self) -> Result<Vec<u8>>;
}

/// Trait for migrations from version N to N+1
#[async_trait]
pub trait Migration: Send + Sync {
    /// Source version
    fn from_version(&self) -> SchemaVersion;

    /// Target version
    fn to_version(&self) -> SchemaVersion;

    /// Migration name/description
    fn name(&self) -> &str;

    /// Migrate a single item
    async fn migrate_item(&self, key: &[u8], value: &[u8]) -> Result<Vec<u8>>;

    /// Get the key prefix for items to migrate (e.g., "task:", "episode:")
    fn key_prefix(&self) -> &[u8];
}

/// Migration registry - maps version transitions to migrations
pub struct MigrationRegistry {
    migrations: HashMap<(SchemaVersion, SchemaVersion), Box<dyn Migration>>,
}

impl MigrationRegistry {
    pub fn new() -> Self {
        Self {
            migrations: HashMap::new(),
        }
    }

    /// Register a migration
    pub fn register(&mut self, migration: Box<dyn Migration>) {
        let key = (migration.from_version(), migration.to_version());
        self.migrations.insert(key, migration);
    }

    /// Get migration path from version A to version B
    pub fn get_migration_path(
        &self,
        from: SchemaVersion,
        to: SchemaVersion,
    ) -> Result<Vec<&dyn Migration>> {
        if from == to {
            return Ok(Vec::new());
        }

        if from > to {
            return Err(anyhow!(
                "Downgrade not supported: cannot migrate from {} to {}",
                from,
                to
            ));
        }

        let mut path = Vec::new();
        let mut current = from;

        while current < to {
            let next = SchemaVersion(current.0 + 1);
            match self.migrations.get(&(current, next)) {
                Some(migration) => {
                    path.push(migration.as_ref());
                    current = next;
                }
                None => {
                    return Err(anyhow!(
                        "No migration found from {} to {}",
                        current,
                        next
                    ));
                }
            }
        }

        Ok(path)
    }
}

impl Default for MigrationRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Migration manager - handles schema versioning and migrations
pub struct MigrationManager {
    storage: Arc<dyn Storage>,
    pub registry: MigrationRegistry,
}

impl MigrationManager {
    pub fn new(storage: Arc<dyn Storage>) -> Self {
        Self {
            storage,
            registry: MigrationRegistry::new(),
        }
    }

    /// Register a migration
    pub fn register_migration(&mut self, migration: Box<dyn Migration>) {
        self.registry.register(migration);
    }

    /// Get current schema version from storage
    pub async fn get_current_version(&self) -> Result<SchemaVersion> {
        let version_key = b"_schema_version";

        match self.storage.get(version_key).await? {
            Some(bytes) => {
                let version: SchemaVersion = serde_json::from_slice(&bytes)
                    .context("Failed to deserialize schema version")?;
                Ok(version)
            }
            None => {
                // No version stored - assume v1 (initial version)
                Ok(SchemaVersion::V1)
            }
        }
    }

    /// Set current schema version in storage
    pub async fn set_current_version(&self, version: SchemaVersion) -> Result<()> {
        let version_key = b"_schema_version";
        let version_bytes = serde_json::to_vec(&version)
            .context("Failed to serialize schema version")?;

        self.storage.put(version_key, &version_bytes).await?;
        Ok(())
    }

    /// Get migration history
    pub async fn get_migration_history(&self) -> Result<MigrationHistory> {
        let history_key = b"_migration_history";

        match self.storage.get(history_key).await? {
            Some(bytes) => {
                let history: MigrationHistory = serde_json::from_slice(&bytes)
                    .context("Failed to deserialize migration history")?;
                Ok(history)
            }
            None => Ok(MigrationHistory::new()),
        }
    }

    /// Save migration history
    async fn save_migration_history(&self, history: &MigrationHistory) -> Result<()> {
        let history_key = b"_migration_history";
        let history_bytes = serde_json::to_vec(history)
            .context("Failed to serialize migration history")?;

        self.storage.put(history_key, &history_bytes).await?;
        Ok(())
    }

    /// Create backup of data before migration
    pub async fn create_backup(&self, prefix: &[u8]) -> Result<String> {
        let backup_timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
        let backup_key = format!("_backup_{}", backup_timestamp);

        // Get all keys with prefix
        let keys = self.storage.get_keys_with_prefix(prefix).await?;

        // Store backup metadata
        let backup_data = BackupMetadata {
            timestamp: Utc::now(),
            prefix: String::from_utf8_lossy(prefix).to_string(),
            item_count: keys.len(),
            keys: keys.iter().map(|k| String::from_utf8_lossy(k).to_string()).collect(),
        };

        let backup_bytes = serde_json::to_vec(&backup_data)
            .context("Failed to serialize backup metadata")?;

        self.storage.put(backup_key.as_bytes(), &backup_bytes).await?;

        // Store each item with backup prefix
        for key in keys {
            if let Some(value) = self.storage.get(&key).await? {
                let backup_item_key = format!("{}:{}", backup_key, String::from_utf8_lossy(&key));
                self.storage.put(backup_item_key.as_bytes(), &value).await?;
            }
        }

        Ok(backup_key)
    }

    /// Rollback to backup
    pub async fn rollback_to_backup(&self, backup_key: &str) -> Result<()> {
        // Load backup metadata
        let backup_bytes = self.storage.get(backup_key.as_bytes()).await?
            .ok_or_else(|| anyhow!("Backup not found: {}", backup_key))?;

        let backup_metadata: BackupMetadata = serde_json::from_slice(&backup_bytes)
            .context("Failed to deserialize backup metadata")?;

        // Delete current items with the prefix
        let current_keys = self.storage.get_keys_with_prefix(backup_metadata.prefix.as_bytes()).await?;
        for key in current_keys {
            self.storage.delete(&key).await?;
        }

        // Restore backed up items
        for original_key in &backup_metadata.keys {
            let backup_item_key = format!("{}:{}", backup_key, original_key);
            if let Some(value) = self.storage.get(backup_item_key.as_bytes()).await? {
                self.storage.put(original_key.as_bytes(), &value).await?;
            }
        }

        tracing::info!(
            "Rolled back {} items from backup: {}",
            backup_metadata.item_count,
            backup_key
        );

        Ok(())
    }

    /// Check if migration is needed
    pub async fn needs_migration(&self) -> Result<bool> {
        let current = self.get_current_version().await?;
        Ok(!current.is_current())
    }

    /// Run all necessary migrations to bring schema to current version
    pub async fn migrate_to_current(&self) -> Result<Vec<MigrationResult>> {
        let from_version = self.get_current_version().await?;
        let to_version = SchemaVersion::current();

        if from_version == to_version {
            tracing::info!("Schema is already at current version: {}", to_version);
            return Ok(Vec::new());
        }

        tracing::info!("Migrating schema from {} to {}", from_version, to_version);

        // Get migration path
        let migrations = self.registry.get_migration_path(from_version, to_version)?;

        if migrations.is_empty() {
            tracing::warn!("No migrations found for {} -> {}", from_version, to_version);
            return Ok(Vec::new());
        }

        let mut results = Vec::new();
        let mut history = self.get_migration_history().await?;

        // Execute each migration in order
        for migration in migrations {
            let started_at = Utc::now();
            let mut items_migrated = 0;

            tracing::info!(
                "Running migration: {} ({} -> {})",
                migration.name(),
                migration.from_version(),
                migration.to_version()
            );

            // Create backup before migration
            let backup_key = match self.create_backup(migration.key_prefix()).await {
                Ok(key) => {
                    tracing::info!("Backup created: {}", key);
                    Some(key)
                }
                Err(e) => {
                    tracing::error!("Failed to create backup: {}", e);
                    return Err(e);
                }
            };

            // Run migration
            let migration_result = match self.run_migration(migration, &mut items_migrated).await {
                Ok(_) => {
                    // Update version after successful migration
                    self.set_current_version(migration.to_version()).await?;

                    MigrationResult {
                        from_version: migration.from_version(),
                        to_version: migration.to_version(),
                        started_at,
                        completed_at: Utc::now(),
                        items_migrated,
                        backup_key: backup_key.clone(),
                        success: true,
                        error: None,
                    }
                }
                Err(e) => {
                    tracing::error!("Migration failed: {}", e);

                    // Attempt rollback
                    if let Some(ref key) = backup_key {
                        tracing::info!("Attempting rollback to backup: {}", key);
                        if let Err(rollback_err) = self.rollback_to_backup(key).await {
                            tracing::error!("Rollback failed: {}", rollback_err);
                        } else {
                            tracing::info!("Rollback successful");
                        }
                    }

                    MigrationResult {
                        from_version: migration.from_version(),
                        to_version: migration.to_version(),
                        started_at,
                        completed_at: Utc::now(),
                        items_migrated,
                        backup_key,
                        success: false,
                        error: Some(e.to_string()),
                    }
                }
            };

            history.add(migration_result.clone());
            results.push(migration_result.clone());

            // Save history after each migration
            self.save_migration_history(&history).await?;

            // Stop on first failure
            if !migration_result.success {
                return Err(anyhow!("Migration failed: {}", migration_result.error.unwrap()));
            }
        }

        tracing::info!("All migrations completed successfully");
        Ok(results)
    }

    /// Run a single migration
    async fn run_migration(
        &self,
        migration: &dyn Migration,
        items_migrated: &mut usize,
    ) -> Result<()> {
        // Get all keys with the migration's prefix
        let keys = self.storage.get_keys_with_prefix(migration.key_prefix()).await?;

        tracing::info!("Found {} items to migrate", keys.len());

        // Migrate each item
        for key in keys {
            if let Some(value) = self.storage.get(&key).await? {
                match migration.migrate_item(&key, &value).await {
                    Ok(new_value) => {
                        self.storage.put(&key, &new_value).await?;
                        *items_migrated += 1;
                    }
                    Err(e) => {
                        tracing::error!("Failed to migrate item {:?}: {}", String::from_utf8_lossy(&key), e);
                        return Err(e);
                    }
                }
            }
        }

        Ok(())
    }
}

/// Backup metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
struct BackupMetadata {
    timestamp: DateTime<Utc>,
    prefix: String,
    item_count: usize,
    keys: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::rocksdb_storage::RocksDBStorage;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_version_management() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap()) as Arc<dyn Storage>;
        let manager = MigrationManager::new(storage);

        // Initially should be v1 (no version stored)
        let version = manager.get_current_version().await.unwrap();
        assert_eq!(version, SchemaVersion::V1);

        // Set to v2
        manager.set_current_version(SchemaVersion::V2).await.unwrap();

        // Should now be v2
        let version = manager.get_current_version().await.unwrap();
        assert_eq!(version, SchemaVersion::V2);
    }

    #[tokio::test]
    async fn test_migration_history() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap()) as Arc<dyn Storage>;
        let manager = MigrationManager::new(storage);

        // Initially no history
        let history = manager.get_migration_history().await.unwrap();
        assert_eq!(history.migrations.len(), 0);

        // Add a migration result
        let mut history = MigrationHistory::new();
        history.add(MigrationResult {
            from_version: SchemaVersion::V1,
            to_version: SchemaVersion::V2,
            started_at: Utc::now(),
            completed_at: Utc::now(),
            items_migrated: 10,
            backup_key: Some("backup_123".to_string()),
            success: true,
            error: None,
        });

        manager.save_migration_history(&history).await.unwrap();

        // Load and verify
        let loaded_history = manager.get_migration_history().await.unwrap();
        assert_eq!(loaded_history.migrations.len(), 1);
        assert_eq!(loaded_history.migrations[0].from_version, SchemaVersion::V1);
        assert_eq!(loaded_history.migrations[0].to_version, SchemaVersion::V2);
    }

    #[tokio::test]
    async fn test_backup_and_rollback() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap()) as Arc<dyn Storage>;
        let manager = MigrationManager::new(storage.clone());

        // Create some test data
        storage.put(b"task:1", b"data1").await.unwrap();
        storage.put(b"task:2", b"data2").await.unwrap();

        // Create backup
        let backup_key = manager.create_backup(b"task:").await.unwrap();
        assert!(!backup_key.is_empty());

        // Modify data
        storage.put(b"task:1", b"modified1").await.unwrap();
        storage.delete(b"task:2").await.unwrap();

        // Verify modifications
        assert_eq!(storage.get(b"task:1").await.unwrap().unwrap(), b"modified1");
        assert!(storage.get(b"task:2").await.unwrap().is_none());

        // Rollback
        manager.rollback_to_backup(&backup_key).await.unwrap();

        // Verify rollback
        assert_eq!(storage.get(b"task:1").await.unwrap().unwrap(), b"data1");
        assert_eq!(storage.get(b"task:2").await.unwrap().unwrap(), b"data2");
    }
}
