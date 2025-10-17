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

impl RocksDBStorage {
    pub fn new(path: &Path) -> Result<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);

        let db = DB::open(&opts, path)
            .with_context(|| format!("Failed to open RocksDB at {:?}", path))?;

        Ok(Self { db: Arc::new(db) })
    }

    pub fn open_with_options(path: &Path, opts: Options) -> Result<Self> {
        let db = DB::open(&opts, path)
            .with_context(|| format!("Failed to open RocksDB at {:?}", path))?;

        Ok(Self { db: Arc::new(db) })
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
