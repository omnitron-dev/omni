use super::{Snapshot, Storage, WriteOp};
use anyhow::{Context, Result};
use async_trait::async_trait;
use rocksdb::{IteratorMode, Options, WriteBatch, DB};
use std::path::Path;
use std::sync::Arc;

/// RocksDB storage implementation
pub struct RocksDBStorage {
    db: Arc<DB>,
}

impl Drop for RocksDBStorage {
    fn drop(&mut self) {
        // Ensure proper cleanup
        // Arc will handle the actual drop when all references are gone
        tracing::debug!("RocksDBStorage drop called");
    }
}

impl RocksDBStorage {
    pub fn new(path: &Path) -> Result<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);

        // macOS-specific configuration to avoid file locking issues
        #[cfg(target_os = "macos")]
        {
            tracing::debug!("Applying macOS-specific RocksDB configuration");

            // Disable adaptive mutex which can cause locking issues on macOS
            opts.set_use_adaptive_mutex(false);

            // Disable memory-mapped I/O which can cause file locking problems on macOS
            opts.set_allow_mmap_reads(false);
            opts.set_allow_mmap_writes(false);

            // Use direct I/O to bypass filesystem cache issues
            // Note: This may not work on all macOS filesystems (e.g., APFS might not support it)
            // We'll catch the error if it fails
            opts.set_use_direct_reads(false); // Direct reads often fail on macOS
            opts.set_use_direct_io_for_flush_and_compaction(false);
        }

        // General optimizations for development/testing
        opts.set_max_open_files(256);  // Limit file handles
        opts.increase_parallelism(2);  // Limit parallelism for development

        // Try to repair database if it's corrupted or locked
        let db = match DB::open(&opts, path) {
            Ok(db) => db,
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("LOCK") || err_str.contains("lock") {
                    // Try to remove stale LOCK file
                    let lock_file = path.join("LOCK");
                    if lock_file.exists() {
                        tracing::warn!("Removing stale RocksDB LOCK file: {:?}", lock_file);
                        let _ = std::fs::remove_file(&lock_file);

                        // Try opening again
                        DB::open(&opts, path)
                            .with_context(|| format!("Failed to open RocksDB at {:?} (after lock cleanup)", path))?
                    } else {
                        return Err(e).with_context(|| format!("Failed to open RocksDB at {:?}", path));
                    }
                } else {
                    return Err(e).with_context(|| format!("Failed to open RocksDB at {:?}", path));
                }
            }
        };

        Ok(Self { db: Arc::new(db) })
    }

    pub fn open_with_options(path: &Path, opts: Options) -> Result<Self> {
        let db = DB::open(&opts, path)
            .with_context(|| format!("Failed to open RocksDB at {:?}", path))?;

        Ok(Self { db: Arc::new(db) })
    }

    /// Create a RocksDBStorage from an existing DB Arc
    /// This allows sharing a single RocksDB instance across multiple components
    pub fn from_db(db: Arc<DB>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl Storage for RocksDBStorage {
    async fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>> {
        let db = self.db.clone();
        let key = key.to_vec();

        tokio::task::spawn_blocking(move || {
            db.get(&key)
                .context("Failed to get value from RocksDB")
        })
        .await?
    }

    async fn put(&self, key: &[u8], value: &[u8]) -> Result<()> {
        let db = self.db.clone();
        let key = key.to_vec();
        let value = value.to_vec();

        tokio::task::spawn_blocking(move || {
            db.put(&key, &value)
                .context("Failed to put value to RocksDB")
        })
        .await?
    }

    async fn delete(&self, key: &[u8]) -> Result<()> {
        let db = self.db.clone();
        let key = key.to_vec();

        tokio::task::spawn_blocking(move || {
            db.delete(&key)
                .context("Failed to delete value from RocksDB")
        })
        .await?
    }

    async fn exists(&self, key: &[u8]) -> Result<bool> {
        Ok(self.get(key).await?.is_some())
    }

    async fn get_keys_with_prefix(&self, prefix: &[u8]) -> Result<Vec<Vec<u8>>> {
        let db = self.db.clone();
        let prefix = prefix.to_vec();

        tokio::task::spawn_blocking(move || {
            let mut keys = Vec::new();
            let iter = db.iterator(IteratorMode::Start);

            for item in iter {
                let (key, _) = item.context("Failed to iterate RocksDB")?;
                if key.starts_with(&prefix) {
                    keys.push(key.to_vec());
                } else if !keys.is_empty() {
                    // Optimization: stop if we've passed the prefix range
                    break;
                }
            }

            Ok(keys)
        })
        .await?
    }

    async fn batch_write(&self, operations: Vec<WriteOp>) -> Result<()> {
        let db = self.db.clone();

        tokio::task::spawn_blocking(move || {
            let mut batch = WriteBatch::default();

            for op in operations {
                match op {
                    WriteOp::Put { key, value } => {
                        batch.put(&key, &value);
                    }
                    WriteOp::Delete { key } => {
                        batch.delete(&key);
                    }
                }
            }

            db.write(batch)
                .context("Failed to write batch to RocksDB")
        })
        .await?
    }

    async fn snapshot(&self) -> Result<Box<dyn Snapshot>> {
        Ok(Box::new(RocksDBSnapshot {
            db: self.db.clone(),
        }))
    }
}

/// RocksDB snapshot - using Arc<DB> to manage lifetime
struct RocksDBSnapshot {
    db: Arc<DB>,
}

#[async_trait]
impl Snapshot for RocksDBSnapshot {
    async fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>> {
        // Create snapshot on-demand since we can't store it due to lifetime issues
        let snapshot = self.db.snapshot();
        snapshot
            .get(key)
            .context("Failed to get value from snapshot")
    }
}
