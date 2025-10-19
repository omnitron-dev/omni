//! Global RocksDB storage wrapper
//!
//! Implements the global storage schema as defined in global-architecture-spec.md.
//! This is the global database that stores all projects across all monorepos.

use super::registry::ProjectRegistry;
use crate::storage::StorageConfig;
use anyhow::{Context, Result};
use rocksdb::{Options, DB};
use std::path::Path;
use std::sync::Arc;

/// Global storage using RocksDB
///
/// Schema (as per global-architecture-spec.md):
/// ```
/// registry:projects:{fullId}                    → ProjectRegistry (JSON)
/// registry:index:name:{projectName}             → fullId[]
/// registry:index:monorepo:{monorepoId}          → fullId[]
/// registry:index:path:{pathHash}                → fullId
/// ```
pub struct GlobalStorage {
    db: Arc<DB>,
}

impl GlobalStorage {
    /// Create a new global storage with automatic RocksDB configuration
    pub async fn new(path: &Path) -> Result<Self> {
        Self::new_with_config(path, StorageConfig::default()).await
    }

    /// Create a new global storage with custom configuration
    pub async fn new_with_config(path: &Path, config: StorageConfig) -> Result<Self> {
        // Check if we should use memory storage based on environment
        if config.force_memory {
            tracing::warn!(
                "MERIDIAN_USE_MEMORY_STORAGE is set. Global storage will use RocksDB but with fallback enabled."
            );
        }

        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);

        // macOS-specific configuration to avoid file locking issues
        #[cfg(target_os = "macos")]
        {
            tracing::debug!("Applying macOS-specific RocksDB configuration for global storage");
            opts.set_use_adaptive_mutex(false);
            opts.set_allow_mmap_reads(false);
            opts.set_allow_mmap_writes(false);
            opts.set_use_direct_reads(false);
            opts.set_use_direct_io_for_flush_and_compaction(false);
        }

        // General optimizations
        opts.set_max_open_files(256);
        opts.increase_parallelism(2);

        // Try to open the database
        let db = match DB::open(&opts, path) {
            Ok(db) => {
                tracing::info!(path = ?path, "Successfully opened global database");
                db
            }
            Err(e) => {
                let err_str = e.to_string();
                tracing::error!(
                    path = ?path,
                    error = %err_str,
                    "Failed to open global database"
                );

                // Try to handle lock issues
                if err_str.contains("LOCK") || err_str.contains("lock") {
                    let lock_file = path.join("LOCK");
                    if lock_file.exists() {
                        tracing::warn!("Attempting to remove stale LOCK file: {:?}", lock_file);
                        let _ = std::fs::remove_file(&lock_file);

                        // Try opening again after removing lock file
                        match DB::open(&opts, path) {
                            Ok(db) => {
                                tracing::info!(path = ?path, "Successfully opened global database after lock cleanup");
                                db
                            }
                            Err(retry_err) => {
                                tracing::error!(
                                    path = ?path,
                                    error = %retry_err.to_string(),
                                    "Failed to open global database even after lock cleanup"
                                );

                                // Check if fallback is enabled
                                if config.fallback_to_memory {
                                    tracing::warn!(
                                        "Falling back to in-memory global storage. Data will not persist! \
                                         This is a temporary workaround for RocksDB lock issues."
                                    );

                                    #[cfg(target_os = "macos")]
                                    tracing::warn!(
                                        "macOS file locking issue detected. To use persistent storage, try:\n\
                                         1. killall meridian-mcp\n\
                                         2. rm -f {}/.meridian/data/LOCK\n\
                                         3. Restart the server",
                                        std::env::var("HOME").unwrap_or_default()
                                    );

                                    return Err(retry_err).with_context(|| {
                                        format!(
                                            "Failed to open global database at {:?} even after lock cleanup. \
                                            Fallback to memory storage is not supported for global storage yet.",
                                            path
                                        )
                                    });
                                } else {
                                    return Err(retry_err).with_context(|| {
                                        format!("Failed to open global database at {:?} (after lock cleanup)", path)
                                    });
                                }
                            }
                        }
                    } else {
                        // Lock file doesn't exist, but still getting lock error
                        if config.fallback_to_memory {
                            tracing::error!(
                                "RocksDB lock error without LOCK file. This is unusual. \
                                 Fallback to memory storage is not yet supported for global storage."
                            );
                        }

                        return Err(e).with_context(|| {
                            format!("Failed to open global database at {:?}. \
                                    On macOS, consider:\n\
                                    1. Checking if another meridian process is running: pgrep meridian\n\
                                    2. Setting MERIDIAN_USE_MEMORY_STORAGE=1 for development", path)
                        });
                    }
                } else {
                    return Err(e).with_context(|| format!("Failed to open global database at {:?}", path));
                }
            }
        };

        Ok(Self { db: Arc::new(db) })
    }

    /// Put a project into the registry
    pub async fn put_project(&self, registry: &ProjectRegistry) -> Result<()> {
        let key = format!("registry:projects:{}", registry.identity.full_id);
        let value = serde_json::to_vec(registry)
            .with_context(|| "Failed to serialize project registry")?;

        self.db
            .put(&key, &value)
            .with_context(|| format!("Failed to store project {}", registry.identity.full_id))?;

        // Update indexes
        self.update_indexes(registry).await?;

        Ok(())
    }

    /// Get a project by its full ID
    pub async fn get_project(&self, full_id: &str) -> Result<Option<ProjectRegistry>> {
        let key = format!("registry:projects:{}", full_id);

        match self.db.get(&key)? {
            Some(value) => {
                let registry: ProjectRegistry = serde_json::from_slice(&value)
                    .with_context(|| format!("Failed to deserialize project {}", full_id))?;
                Ok(Some(registry))
            }
            None => Ok(None),
        }
    }

    /// Find project by path
    pub async fn find_project_by_path(&self, path: &Path) -> Result<Option<ProjectRegistry>> {
        let path_hash = Self::hash_path(path);
        let key = format!("registry:index:path:{}", path_hash);

        match self.db.get(&key)? {
            Some(value) => {
                let full_id = String::from_utf8(value)
                    .with_context(|| "Failed to parse path index")?;
                self.get_project(&full_id).await
            }
            None => Ok(None),
        }
    }

    /// List all projects
    pub async fn list_all_projects(&self) -> Result<Vec<ProjectRegistry>> {
        let prefix = "registry:projects:";
        let mut projects = Vec::new();

        let iter = self.db.prefix_iterator(prefix.as_bytes());
        for item in iter {
            let (key, value) = item?;

            // Verify this is a project key
            if let Ok(key_str) = std::str::from_utf8(&key) {
                if key_str.starts_with(prefix) {
                    if let Ok(registry) = serde_json::from_slice::<ProjectRegistry>(&value) {
                        projects.push(registry);
                    }
                }
            }
        }

        Ok(projects)
    }

    /// Update all indexes for a project
    async fn update_indexes(&self, registry: &ProjectRegistry) -> Result<()> {
        // Name index
        let name_key = format!("registry:index:name:{}", registry.identity.id);
        self.db.put(&name_key, registry.identity.full_id.as_bytes())?;

        // Path index
        let path_hash = Self::hash_path(&registry.current_path);
        let path_key = format!("registry:index:path:{}", path_hash);
        self.db.put(&path_key, registry.identity.full_id.as_bytes())?;

        // Monorepo index (if applicable)
        if let Some(ref monorepo) = registry.monorepo {
            let monorepo_key = format!("registry:index:monorepo:{}", monorepo.id);

            // Get existing full_ids for this monorepo
            let mut full_ids: Vec<String> = match self.db.get(&monorepo_key)? {
                Some(value) => serde_json::from_slice(&value).unwrap_or_default(),
                None => Vec::new(),
            };

            // Add this project if not already there
            if !full_ids.contains(&registry.identity.full_id) {
                full_ids.push(registry.identity.full_id.clone());
                let value = serde_json::to_vec(&full_ids)?;
                self.db.put(&monorepo_key, &value)?;
            }
        }

        Ok(())
    }

    /// Hash a path for indexing
    fn hash_path(path: &Path) -> String {
        let path_str = path.display().to_string();
        let hash = blake3::hash(path_str.as_bytes());
        hash.to_hex().to_string()
    }

    /// Get the underlying database (for advanced operations)
    pub fn db(&self) -> Arc<DB> {
        Arc::clone(&self.db)
    }

    /// Put raw key-value pair
    pub async fn put_raw(&self, key: &str, value: &[u8]) -> Result<()> {
        self.db
            .put(key, value)
            .with_context(|| format!("Failed to store raw key {}", key))?;
        Ok(())
    }

    /// Get raw value by key
    pub async fn get_raw(&self, key: &str) -> Result<Option<Vec<u8>>> {
        Ok(self.db.get(key)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::global::identity::ProjectIdentity;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_put_and_get_project() {
        let temp_dir = TempDir::new().unwrap();
        let storage = GlobalStorage::new(temp_dir.path()).await.unwrap();

        let project_dir = TempDir::new().unwrap();
        std::fs::write(
            project_dir.path().join("package.json"),
            r#"{"name": "test", "version": "1.0.0"}"#,
        )
        .unwrap();

        let identity = ProjectIdentity::from_npm(project_dir.path()).unwrap();
        let registry = ProjectRegistry::new(identity.clone(), project_dir.path().to_path_buf());

        storage.put_project(&registry).await.unwrap();

        let retrieved = storage.get_project(&identity.full_id).await.unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().identity.id, "test");
    }

    #[tokio::test]
    async fn test_find_by_path() {
        let temp_dir = TempDir::new().unwrap();
        let storage = GlobalStorage::new(temp_dir.path()).await.unwrap();

        let project_dir = TempDir::new().unwrap();
        std::fs::write(
            project_dir.path().join("package.json"),
            r#"{"name": "test-path", "version": "1.0.0"}"#,
        )
        .unwrap();

        let identity = ProjectIdentity::from_npm(project_dir.path()).unwrap();
        let registry = ProjectRegistry::new(identity, project_dir.path().to_path_buf());

        storage.put_project(&registry).await.unwrap();

        let found = storage
            .find_project_by_path(project_dir.path())
            .await
            .unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().identity.id, "test-path");
    }

    #[tokio::test]
    async fn test_list_all_projects() {
        let temp_dir = TempDir::new().unwrap();
        let storage = GlobalStorage::new(temp_dir.path()).await.unwrap();

        // Create two projects
        let project1 = TempDir::new().unwrap();
        std::fs::write(
            project1.path().join("package.json"),
            r#"{"name": "project1", "version": "1.0.0"}"#,
        )
        .unwrap();

        let project2 = TempDir::new().unwrap();
        std::fs::write(
            project2.path().join("package.json"),
            r#"{"name": "project2", "version": "1.0.0"}"#,
        )
        .unwrap();

        let identity1 = ProjectIdentity::from_npm(project1.path()).unwrap();
        let registry1 = ProjectRegistry::new(identity1, project1.path().to_path_buf());

        let identity2 = ProjectIdentity::from_npm(project2.path()).unwrap();
        let registry2 = ProjectRegistry::new(identity2, project2.path().to_path_buf());

        storage.put_project(&registry1).await.unwrap();
        storage.put_project(&registry2).await.unwrap();

        let all = storage.list_all_projects().await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn test_path_hash_stability() {
        let path = Path::new("/some/test/path");
        let hash1 = GlobalStorage::hash_path(path);
        let hash2 = GlobalStorage::hash_path(path);
        assert_eq!(hash1, hash2);
    }

    #[tokio::test]
    async fn test_update_after_insert() {
        let temp_dir = TempDir::new().unwrap();
        let storage = GlobalStorage::new(temp_dir.path()).await.unwrap();

        let project_dir = TempDir::new().unwrap();
        std::fs::write(
            project_dir.path().join("package.json"),
            r#"{"name": "test-update", "version": "1.0.0"}"#,
        )
        .unwrap();

        let identity = ProjectIdentity::from_npm(project_dir.path()).unwrap();
        let mut registry = ProjectRegistry::new(identity.clone(), project_dir.path().to_path_buf());

        storage.put_project(&registry).await.unwrap();

        // Update the registry
        let new_path = TempDir::new().unwrap();
        registry.relocate(new_path.path().to_path_buf(), "test".to_string());
        storage.put_project(&registry).await.unwrap();

        let updated = storage.get_project(&identity.full_id).await.unwrap().unwrap();
        assert_eq!(updated.path_history.len(), 2);
    }
}
