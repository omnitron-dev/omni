// Backup and recovery system for Meridian
//
// Features:
// - Automatic backups before schema migrations
// - Scheduled backups (daily, keep last 7)
// - Manual backup via MCP tools
// - Point-in-time restore capability
// - Incremental backups using RocksDB checkpoints
// - Backup verification and integrity checks

use anyhow::{Context, Result, anyhow};
use chrono::{DateTime, Utc};
use rocksdb::{checkpoint::Checkpoint, Options, DB};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Backup type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackupType {
    /// Manual backup triggered by user
    Manual,
    /// Scheduled automatic backup
    Scheduled,
    /// Pre-migration backup
    PreMigration,
    /// Incremental backup (using RocksDB snapshots)
    Incremental,
}

impl BackupType {
    pub fn as_str(&self) -> &'static str {
        match self {
            BackupType::Manual => "manual",
            BackupType::Scheduled => "scheduled",
            BackupType::PreMigration => "pre_migration",
            BackupType::Incremental => "incremental",
        }
    }
}

/// Backup metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupMetadata {
    /// Unique backup ID (timestamp-based)
    pub id: String,
    /// Backup type
    pub backup_type: BackupType,
    /// Timestamp when backup was created
    pub created_at: DateTime<Utc>,
    /// Size of backup in bytes
    pub size_bytes: u64,
    /// Number of files in backup
    pub file_count: usize,
    /// Checksum of backup data (blake3 hash)
    pub checksum: String,
    /// Version of Meridian that created this backup
    pub meridian_version: String,
    /// Optional description
    pub description: Option<String>,
    /// Database schema version at backup time
    pub schema_version: Option<u32>,
    /// Whether backup has been verified
    pub verified: bool,
    /// Verification timestamp
    pub verified_at: Option<DateTime<Utc>>,
    /// Tags for categorization
    pub tags: Vec<String>,
}

impl BackupMetadata {
    pub fn new(
        id: String,
        backup_type: BackupType,
        description: Option<String>,
    ) -> Self {
        Self {
            id,
            backup_type,
            created_at: Utc::now(),
            size_bytes: 0,
            file_count: 0,
            checksum: String::new(),
            meridian_version: env!("CARGO_PKG_VERSION").to_string(),
            description,
            schema_version: None,
            verified: false,
            verified_at: None,
            tags: Vec::new(),
        }
    }
}

/// Backup configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfig {
    /// Base directory for all backups
    pub backup_dir: PathBuf,
    /// Maximum number of scheduled backups to keep
    pub max_scheduled_backups: usize,
    /// Maximum number of incremental backups to keep
    pub max_incremental_backups: usize,
    /// Whether to automatically verify backups after creation
    pub auto_verify: bool,
    /// Whether to compress backups
    pub compress: bool,
}

impl Default for BackupConfig {
    fn default() -> Self {
        let home_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."));

        Self {
            backup_dir: home_dir.join(".meridian").join("backups"),
            max_scheduled_backups: 7,
            max_incremental_backups: 10,
            auto_verify: true,
            compress: false,
        }
    }
}

/// Backup statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupStats {
    pub total_backups: usize,
    pub total_size_bytes: u64,
    pub by_type: HashMap<String, usize>,
    pub oldest_backup: Option<DateTime<Utc>>,
    pub newest_backup: Option<DateTime<Utc>>,
    pub verified_count: usize,
    pub unverified_count: usize,
}

/// Backup manager
pub struct BackupManager {
    config: BackupConfig,
    db_path: PathBuf,
    metadata_cache: Arc<RwLock<HashMap<String, BackupMetadata>>>,
}

impl BackupManager {
    /// Create a new backup manager
    pub fn new(db_path: PathBuf, config: BackupConfig) -> Result<Self> {
        // Ensure backup directory exists
        fs::create_dir_all(&config.backup_dir)
            .with_context(|| format!("Failed to create backup directory: {:?}", config.backup_dir))?;

        Ok(Self {
            config,
            db_path,
            metadata_cache: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// Generate backup ID from timestamp and type
    fn generate_backup_id(backup_type: BackupType) -> String {
        let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
        format!("{}_{}", timestamp, backup_type.as_str())
    }

    /// Get backup directory path
    fn get_backup_path(&self, backup_id: &str) -> PathBuf {
        self.config.backup_dir.join(backup_id)
    }

    /// Get metadata file path
    fn get_metadata_path(&self, backup_id: &str) -> PathBuf {
        self.get_backup_path(backup_id).join("metadata.json")
    }

    /// Create a new backup
    pub async fn create_backup(
        &self,
        backup_type: BackupType,
        description: Option<String>,
        tags: Vec<String>,
    ) -> Result<BackupMetadata> {
        let backup_id = Self::generate_backup_id(backup_type);
        let backup_path = self.get_backup_path(&backup_id);

        tracing::info!(
            "Creating {:?} backup: {} at {:?}",
            backup_type,
            backup_id,
            backup_path
        );

        // Create backup directory
        fs::create_dir_all(&backup_path)
            .with_context(|| format!("Failed to create backup directory: {:?}", backup_path))?;

        // Create RocksDB checkpoint (efficient, consistent snapshot)
        let db_path = self.db_path.clone();
        let checkpoint_path = backup_path.join("data");

        tokio::task::spawn_blocking(move || {
            let db = DB::open_default(&db_path)
                .with_context(|| format!("Failed to open database at {:?}", db_path))?;

            let checkpoint = Checkpoint::new(&db)?;
            checkpoint.create_checkpoint(&checkpoint_path)
                .with_context(|| format!("Failed to create checkpoint at {:?}", checkpoint_path))?;

            Ok::<(), anyhow::Error>(())
        })
        .await??;

        // Calculate backup size and file count
        let (size_bytes, file_count) = self.calculate_backup_size(&backup_path)?;

        // Calculate checksum
        let checksum = self.calculate_checksum(&backup_path).await?;

        // Create metadata
        let mut metadata = BackupMetadata::new(backup_id.clone(), backup_type, description);
        metadata.size_bytes = size_bytes;
        metadata.file_count = file_count;
        metadata.checksum = checksum;
        metadata.tags = tags;

        // Auto-verify if enabled
        if self.config.auto_verify {
            match self.verify_backup_internal(&backup_id).await {
                Ok(_) => {
                    metadata.verified = true;
                    metadata.verified_at = Some(Utc::now());
                }
                Err(e) => {
                    tracing::warn!("Auto-verification failed for backup {}: {}", backup_id, e);
                }
            }
        }

        // Save metadata
        self.save_metadata(&metadata)?;

        // Cache metadata
        self.metadata_cache.write().await.insert(backup_id.clone(), metadata.clone());

        // Clean up old backups
        self.cleanup_old_backups(backup_type).await?;

        tracing::info!(
            "Backup created successfully: {} ({} bytes, {} files)",
            backup_id,
            size_bytes,
            file_count
        );

        Ok(metadata)
    }

    /// Calculate total size and file count of backup
    fn calculate_backup_size(&self, backup_path: &Path) -> Result<(u64, usize)> {
        let mut total_size = 0u64;
        let mut file_count = 0usize;

        fn walk_dir(path: &Path, total_size: &mut u64, file_count: &mut usize) -> Result<()> {
            for entry in fs::read_dir(path)? {
                let entry = entry?;
                let metadata = entry.metadata()?;

                if metadata.is_file() {
                    *total_size += metadata.len();
                    *file_count += 1;
                } else if metadata.is_dir() {
                    walk_dir(&entry.path(), total_size, file_count)?;
                }
            }
            Ok(())
        }

        walk_dir(backup_path, &mut total_size, &mut file_count)?;
        Ok((total_size, file_count))
    }

    /// Calculate checksum of backup data
    async fn calculate_checksum(&self, backup_path: &Path) -> Result<String> {
        let backup_path = backup_path.to_path_buf();

        tokio::task::spawn_blocking(move || {
            let mut hasher = blake3::Hasher::new();

            fn hash_dir(path: &Path, hasher: &mut blake3::Hasher) -> Result<()> {
                let mut entries: Vec<_> = fs::read_dir(path)?
                    .collect::<Result<Vec<_>, _>>()?;

                // Sort for deterministic hashing
                entries.sort_by_key(|e| e.path());

                for entry in entries {
                    let metadata = entry.metadata()?;

                    if metadata.is_file() {
                        let data = fs::read(entry.path())?;
                        hasher.update(&data);
                    } else if metadata.is_dir() {
                        hash_dir(&entry.path(), hasher)?;
                    }
                }
                Ok(())
            }

            hash_dir(&backup_path, &mut hasher)?;
            Ok(hasher.finalize().to_hex().to_string())
        })
        .await?
    }

    /// Save metadata to disk
    fn save_metadata(&self, metadata: &BackupMetadata) -> Result<()> {
        let metadata_path = self.get_metadata_path(&metadata.id);
        let json = serde_json::to_string_pretty(metadata)?;
        fs::write(&metadata_path, json)
            .with_context(|| format!("Failed to write metadata to {:?}", metadata_path))?;
        Ok(())
    }

    /// Load metadata from disk
    fn load_metadata(&self, backup_id: &str) -> Result<BackupMetadata> {
        let metadata_path = self.get_metadata_path(backup_id);
        let json = fs::read_to_string(&metadata_path)
            .with_context(|| format!("Failed to read metadata from {:?}", metadata_path))?;
        let metadata: BackupMetadata = serde_json::from_str(&json)?;
        Ok(metadata)
    }

    /// List all available backups
    pub async fn list_backups(&self) -> Result<Vec<BackupMetadata>> {
        let mut backups = Vec::new();

        let entries = fs::read_dir(&self.config.backup_dir)
            .with_context(|| format!("Failed to read backup directory: {:?}", self.config.backup_dir))?;

        for entry in entries {
            let entry = entry?;
            if entry.metadata()?.is_dir() {
                let backup_id = entry.file_name().to_string_lossy().to_string();

                // Try to load from cache first
                if let Some(metadata) = self.metadata_cache.read().await.get(&backup_id) {
                    backups.push(metadata.clone());
                    continue;
                }

                // Load from disk
                match self.load_metadata(&backup_id) {
                    Ok(metadata) => {
                        // Cache it
                        self.metadata_cache.write().await.insert(backup_id.clone(), metadata.clone());
                        backups.push(metadata);
                    }
                    Err(e) => {
                        tracing::warn!("Failed to load metadata for backup {}: {}", backup_id, e);
                    }
                }
            }
        }

        // Sort by creation time (newest first)
        backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        Ok(backups)
    }

    /// Get backup metadata by ID
    pub async fn get_backup(&self, backup_id: &str) -> Result<BackupMetadata> {
        // Check cache first
        if let Some(metadata) = self.metadata_cache.read().await.get(backup_id) {
            return Ok(metadata.clone());
        }

        // Load from disk
        let metadata = self.load_metadata(backup_id)?;

        // Cache it
        self.metadata_cache.write().await.insert(backup_id.to_string(), metadata.clone());

        Ok(metadata)
    }

    /// Restore from backup
    pub async fn restore_backup(&self, backup_id: &str, target_path: Option<PathBuf>) -> Result<()> {
        let metadata = self.get_backup(backup_id).await?;
        let backup_path = self.get_backup_path(backup_id);
        let checkpoint_path = backup_path.join("data");

        if !checkpoint_path.exists() {
            return Err(anyhow!("Backup data not found at {:?}", checkpoint_path));
        }

        let target = target_path.unwrap_or_else(|| self.db_path.clone());

        tracing::info!(
            "Restoring backup {} to {:?}",
            backup_id,
            target
        );

        // Verify backup before restoring
        if !metadata.verified {
            tracing::warn!("Backup {} has not been verified, verifying now...", backup_id);
            self.verify_backup(backup_id).await?;
        }

        // Create backup of current state before restore (safety measure)
        if target.exists() {
            let safety_backup_id = format!("{}_pre_restore", Self::generate_backup_id(BackupType::Manual));
            tracing::info!("Creating safety backup before restore: {}", safety_backup_id);
            // Don't wait for cleanup, do it manually
            let safety_path = self.get_backup_path(&safety_backup_id);
            fs::create_dir_all(&safety_path)?;
            self.copy_dir_recursive(&target, &safety_path.join("data"))?;
        }

        // Remove existing database
        if target.exists() {
            fs::remove_dir_all(&target)
                .with_context(|| format!("Failed to remove existing database at {:?}", target))?;
        }

        // Copy backup to target location
        self.copy_dir_recursive(&checkpoint_path, &target)?;

        tracing::info!("Backup restored successfully from {}", backup_id);

        Ok(())
    }

    /// Verify backup integrity
    pub async fn verify_backup(&self, backup_id: &str) -> Result<()> {
        self.verify_backup_internal(backup_id).await?;

        // Update metadata to mark as verified
        let mut metadata = self.get_backup(backup_id).await?;
        metadata.verified = true;
        metadata.verified_at = Some(Utc::now());
        self.save_metadata(&metadata)?;

        // Update cache
        self.metadata_cache.write().await.insert(backup_id.to_string(), metadata);

        Ok(())
    }

    /// Internal verification logic
    async fn verify_backup_internal(&self, backup_id: &str) -> Result<()> {
        let metadata = self.get_backup(backup_id).await?;
        let backup_path = self.get_backup_path(backup_id);
        let checkpoint_path = backup_path.join("data");

        tracing::info!("Verifying backup: {}", backup_id);

        // Check that backup directory exists
        if !backup_path.exists() {
            return Err(anyhow!("Backup directory not found: {:?}", backup_path));
        }

        // Check that checkpoint data exists
        if !checkpoint_path.exists() {
            return Err(anyhow!("Backup data not found: {:?}", checkpoint_path));
        }

        // Verify checksum
        let current_checksum = self.calculate_checksum(&backup_path).await?;
        if current_checksum != metadata.checksum {
            return Err(anyhow!(
                "Checksum mismatch for backup {}: expected {}, got {}",
                backup_id,
                metadata.checksum,
                current_checksum
            ));
        }

        // Try to open the database to verify it's valid
        let checkpoint_path_clone = checkpoint_path.clone();
        tokio::task::spawn_blocking(move || {
            let opts = Options::default();
            let db = DB::open_for_read_only(&opts, &checkpoint_path_clone, false)
                .with_context(|| format!("Failed to open backup database at {:?}", checkpoint_path_clone))?;

            // Try to read a key to ensure database is readable
            let _ = db.get(b"test_key");

            Ok::<(), anyhow::Error>(())
        })
        .await??;

        tracing::info!("Backup {} verified successfully", backup_id);

        Ok(())
    }

    /// Delete a backup
    pub async fn delete_backup(&self, backup_id: &str) -> Result<()> {
        let backup_path = self.get_backup_path(backup_id);

        tracing::info!("Deleting backup: {}", backup_id);

        if backup_path.exists() {
            fs::remove_dir_all(&backup_path)
                .with_context(|| format!("Failed to delete backup at {:?}", backup_path))?;
        }

        // Remove from cache
        self.metadata_cache.write().await.remove(backup_id);

        tracing::info!("Backup {} deleted successfully", backup_id);

        Ok(())
    }

    /// Clean up old backups based on retention policy
    async fn cleanup_old_backups(&self, backup_type: BackupType) -> Result<()> {
        let all_backups = self.list_backups().await?;

        let max_backups = match backup_type {
            BackupType::Scheduled => self.config.max_scheduled_backups,
            BackupType::Incremental => self.config.max_incremental_backups,
            _ => return Ok(()), // Don't auto-cleanup manual or pre-migration backups
        };

        let mut type_backups: Vec<_> = all_backups
            .into_iter()
            .filter(|b| b.backup_type == backup_type)
            .collect();

        if type_backups.len() <= max_backups {
            return Ok(());
        }

        // Sort by creation time (oldest first)
        type_backups.sort_by(|a, b| a.created_at.cmp(&b.created_at));

        // Delete oldest backups
        let to_delete = type_backups.len() - max_backups;
        for backup in type_backups.iter().take(to_delete) {
            tracing::info!(
                "Cleaning up old {:?} backup: {} (created at {})",
                backup_type,
                backup.id,
                backup.created_at
            );
            self.delete_backup(&backup.id).await?;
        }

        Ok(())
    }

    /// Get backup statistics
    pub async fn get_stats(&self) -> Result<BackupStats> {
        let backups = self.list_backups().await?;

        let mut by_type: HashMap<String, usize> = HashMap::new();
        let mut total_size = 0u64;
        let mut verified_count = 0;
        let mut unverified_count = 0;
        let mut oldest: Option<DateTime<Utc>> = None;
        let mut newest: Option<DateTime<Utc>> = None;

        for backup in &backups {
            *by_type.entry(backup.backup_type.as_str().to_string()).or_insert(0) += 1;
            total_size += backup.size_bytes;

            if backup.verified {
                verified_count += 1;
            } else {
                unverified_count += 1;
            }

            match oldest {
                None => oldest = Some(backup.created_at),
                Some(ref o) if backup.created_at < *o => oldest = Some(backup.created_at),
                _ => {}
            }

            match newest {
                None => newest = Some(backup.created_at),
                Some(ref n) if backup.created_at > *n => newest = Some(backup.created_at),
                _ => {}
            }
        }

        Ok(BackupStats {
            total_backups: backups.len(),
            total_size_bytes: total_size,
            by_type,
            oldest_backup: oldest,
            newest_backup: newest,
            verified_count,
            unverified_count,
        })
    }

    /// Helper: Copy directory recursively
    fn copy_dir_recursive(&self, src: &Path, dst: &Path) -> Result<()> {
        fs::create_dir_all(dst)?;

        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());

            if file_type.is_dir() {
                self.copy_dir_recursive(&src_path, &dst_path)?;
            } else {
                fs::copy(&src_path, &dst_path)?;
            }
        }

        Ok(())
    }

    /// Create a pre-migration backup
    pub async fn create_pre_migration_backup(
        &self,
        schema_version: u32,
        description: Option<String>,
    ) -> Result<BackupMetadata> {
        let desc = description.unwrap_or_else(|| {
            format!("Pre-migration backup for schema version {}", schema_version)
        });

        let mut metadata = self.create_backup(
            BackupType::PreMigration,
            Some(desc),
            vec!["migration".to_string()],
        ).await?;

        metadata.schema_version = Some(schema_version);
        self.save_metadata(&metadata)?;

        Ok(metadata)
    }

    /// Create a scheduled backup
    pub async fn create_scheduled_backup(&self) -> Result<BackupMetadata> {
        self.create_backup(
            BackupType::Scheduled,
            Some("Automated daily backup".to_string()),
            vec!["scheduled".to_string()],
        ).await
    }
}

// Include comprehensive test module
#[cfg(test)]
#[path = "backup_tests.rs"]
mod backup_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_backup_creation() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("db");
        let backup_dir = temp_dir.path().join("backups");

        // Create a test database
        {
            let db = DB::open_default(&db_path).unwrap();
            db.put(b"key1", b"value1").unwrap();
            db.put(b"key2", b"value2").unwrap();
        }

        let config = BackupConfig {
            backup_dir: backup_dir.clone(),
            max_scheduled_backups: 3,
            max_incremental_backups: 5,
            auto_verify: true,
            compress: false,
        };

        let manager = BackupManager::new(db_path.clone(), config).unwrap();

        // Create a backup
        let metadata = manager.create_backup(
            BackupType::Manual,
            Some("Test backup".to_string()),
            vec!["test".to_string()],
        ).await.unwrap();

        assert_eq!(metadata.backup_type, BackupType::Manual);
        assert!(metadata.verified);
        assert!(metadata.size_bytes > 0);

        // List backups
        let backups = manager.list_backups().await.unwrap();
        assert_eq!(backups.len(), 1);

        // Verify backup
        manager.verify_backup(&metadata.id).await.unwrap();
    }

    #[tokio::test]
    async fn test_backup_restore() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("db");
        let restore_path = temp_dir.path().join("restore");
        let backup_dir = temp_dir.path().join("backups");

        // Create a test database
        {
            let db = DB::open_default(&db_path).unwrap();
            db.put(b"key1", b"value1").unwrap();
        }

        let config = BackupConfig {
            backup_dir: backup_dir.clone(),
            ..Default::default()
        };

        let manager = BackupManager::new(db_path.clone(), config).unwrap();

        // Create a backup
        let metadata = manager.create_backup(
            BackupType::Manual,
            Some("Test backup".to_string()),
            vec![],
        ).await.unwrap();

        // Restore to new location
        manager.restore_backup(&metadata.id, Some(restore_path.clone())).await.unwrap();

        // Verify restored data
        let db = DB::open_default(&restore_path).unwrap();
        let value = db.get(b"key1").unwrap().unwrap();
        assert_eq!(value, b"value1");
    }

    #[tokio::test]
    async fn test_backup_cleanup() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("db");
        let backup_dir = temp_dir.path().join("backups");

        // Create a test database
        {
            let db = DB::open_default(&db_path).unwrap();
            db.put(b"key1", b"value1").unwrap();
        }

        let config = BackupConfig {
            backup_dir: backup_dir.clone(),
            max_scheduled_backups: 2,
            ..Default::default()
        };

        let manager = BackupManager::new(db_path.clone(), config).unwrap();

        // Create 4 scheduled backups
        for i in 0..4 {
            manager.create_backup(
                BackupType::Scheduled,
                Some(format!("Backup {}", i)),
                vec![],
            ).await.unwrap();

            // Small delay to ensure different timestamps
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        // Should only have 2 backups (max_scheduled_backups)
        let backups = manager.list_backups().await.unwrap();
        let scheduled_backups: Vec<_> = backups
            .into_iter()
            .filter(|b| b.backup_type == BackupType::Scheduled)
            .collect();

        assert_eq!(scheduled_backups.len(), 2);
    }

    #[tokio::test]
    async fn test_backup_stats() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("db");
        let backup_dir = temp_dir.path().join("backups");

        // Create a test database
        {
            let db = DB::open_default(&db_path).unwrap();
            db.put(b"key1", b"value1").unwrap();
        }

        let config = BackupConfig {
            backup_dir: backup_dir.clone(),
            ..Default::default()
        };

        let manager = BackupManager::new(db_path.clone(), config).unwrap();

        // Create various backups
        manager.create_backup(BackupType::Manual, None, vec![]).await.unwrap();
        manager.create_backup(BackupType::Scheduled, None, vec![]).await.unwrap();
        manager.create_backup(BackupType::PreMigration, None, vec![]).await.unwrap();

        let stats = manager.get_stats().await.unwrap();

        assert_eq!(stats.total_backups, 3);
        assert!(stats.total_size_bytes > 0);
        assert_eq!(stats.by_type.get("manual").unwrap(), &1);
        assert_eq!(stats.by_type.get("scheduled").unwrap(), &1);
        assert_eq!(stats.by_type.get("pre_migration").unwrap(), &1);
    }
}
