use super::{MemoryStorage, RocksDBStorage, Storage};
use anyhow::{Context, Result};
use std::path::Path;
use std::sync::Arc;

/// Storage configuration options
#[derive(Debug, Clone)]
pub struct StorageConfig {
    /// Whether to fall back to in-memory storage if RocksDB fails
    pub fallback_to_memory: bool,

    /// Whether to force in-memory storage (for testing)
    pub force_memory: bool,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            fallback_to_memory: Self::should_fallback_to_memory(),
            force_memory: Self::should_force_memory(),
        }
    }
}

impl StorageConfig {
    /// Create a new storage configuration
    pub fn new() -> Self {
        Self::default()
    }

    /// Enable fallback to in-memory storage
    pub fn with_memory_fallback(mut self) -> Self {
        self.fallback_to_memory = true;
        self
    }

    /// Force in-memory storage (for testing)
    pub fn with_force_memory(mut self) -> Self {
        self.force_memory = true;
        self
    }

    /// Check if we should fall back to in-memory storage based on environment
    fn should_fallback_to_memory() -> bool {
        std::env::var("MERIDIAN_FALLBACK_MEMORY")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    }

    /// Check if we should force in-memory storage based on environment
    fn should_force_memory() -> bool {
        std::env::var("MERIDIAN_USE_MEMORY_STORAGE")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    }
}

/// Create a storage backend with automatic fallback
///
/// This function attempts to create a RocksDB storage backend. If that fails
/// and fallback is enabled, it will create an in-memory storage backend instead.
///
/// # Arguments
///
/// * `path` - Path to the database directory
/// * `config` - Storage configuration options
///
/// # Returns
///
/// An Arc-wrapped storage backend
///
/// # Environment Variables
///
/// * `MERIDIAN_USE_MEMORY_STORAGE=1` - Force in-memory storage
/// * `MERIDIAN_FALLBACK_MEMORY=1` - Enable automatic fallback to in-memory storage
///
/// # Examples
///
/// ```rust,no_run
/// use meridian::storage::factory::{create_storage, StorageConfig};
/// use std::path::Path;
///
/// # async fn example() -> anyhow::Result<()> {
/// let path = Path::new("/tmp/meridian-db");
/// let config = StorageConfig::new().with_memory_fallback();
/// let storage = create_storage(path, config).await?;
/// # Ok(())
/// # }
/// ```
pub async fn create_storage(path: &Path, config: StorageConfig) -> Result<Arc<dyn Storage>> {
    // Check if we should force in-memory storage
    if config.force_memory {
        tracing::warn!(
            "Forcing in-memory storage (MERIDIAN_USE_MEMORY_STORAGE=1). Data will not persist!"
        );
        return Ok(Arc::new(MemoryStorage::new()));
    }

    // Try to create RocksDB storage
    match RocksDBStorage::new(path) {
        Ok(storage) => {
            tracing::info!(path = ?path, "Successfully opened RocksDB storage");
            Ok(Arc::new(storage))
        }
        Err(e) => {
            let error_msg = e.to_string();
            tracing::error!(
                path = ?path,
                error = %error_msg,
                "Failed to open RocksDB storage"
            );

            // Check if we should fall back to in-memory storage
            if config.fallback_to_memory {
                tracing::warn!(
                    "Falling back to in-memory storage. Data will not persist! \
                     Set MERIDIAN_FALLBACK_MEMORY=0 to disable this behavior."
                );

                #[cfg(target_os = "macos")]
                if error_msg.contains("lock") || error_msg.contains("LOCK") {
                    tracing::warn!(
                        "macOS file locking issue detected. Consider using in-memory storage \
                         for development by setting MERIDIAN_USE_MEMORY_STORAGE=1"
                    );
                }

                Ok(Arc::new(MemoryStorage::new()))
            } else {
                Err(e).context("Failed to create storage backend and fallback is disabled")
            }
        }
    }
}

/// Create a storage backend with default configuration
///
/// This is a convenience function that uses the default StorageConfig,
/// which checks environment variables for configuration.
pub async fn create_default_storage(path: &Path) -> Result<Arc<dyn Storage>> {
    create_storage(path, StorageConfig::default()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_rocksdb_storage_creation() {
        let temp_dir = TempDir::new().unwrap();
        let config = StorageConfig::new();

        let storage = create_storage(temp_dir.path(), config).await.unwrap();

        // Test basic operations
        storage.put(b"key", b"value").await.unwrap();
        let value = storage.get(b"key").await.unwrap();
        assert_eq!(value, Some(b"value".to_vec()));
    }

    #[tokio::test]
    async fn test_force_memory_storage() {
        let temp_dir = TempDir::new().unwrap();
        let config = StorageConfig::new().with_force_memory();

        let storage = create_storage(temp_dir.path(), config).await.unwrap();

        // Test basic operations
        storage.put(b"key", b"value").await.unwrap();
        let value = storage.get(b"key").await.unwrap();
        assert_eq!(value, Some(b"value".to_vec()));
    }

    #[tokio::test]
    async fn test_fallback_on_bad_path() {
        // Use a path that should fail to open as RocksDB
        let bad_path = Path::new("/dev/null/impossible/path");
        let config = StorageConfig::new().with_memory_fallback();

        let storage = create_storage(bad_path, config).await.unwrap();

        // Should fall back to memory storage
        storage.put(b"key", b"value").await.unwrap();
        let value = storage.get(b"key").await.unwrap();
        assert_eq!(value, Some(b"value".to_vec()));
    }

    #[tokio::test]
    async fn test_no_fallback_fails() {
        // Use a path that should fail to open as RocksDB
        let bad_path = Path::new("/dev/null/impossible/path");
        let config = StorageConfig {
            fallback_to_memory: false,
            force_memory: false,
        };

        let result = create_storage(bad_path, config).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_default_storage() {
        let temp_dir = TempDir::new().unwrap();
        let storage = create_default_storage(temp_dir.path()).await.unwrap();

        storage.put(b"key", b"value").await.unwrap();
        let value = storage.get(b"key").await.unwrap();
        assert_eq!(value, Some(b"value".to_vec()));
    }
}
