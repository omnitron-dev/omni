use anyhow::{Result, anyhow};
use async_trait::async_trait;
use meridian::storage::{Snapshot, Storage, WriteOp};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

/// Mock storage implementation for testing
#[derive(Clone)]
pub struct MockStorage {
    data: Arc<RwLock<HashMap<Vec<u8>, Vec<u8>>>>,
    fail_on_get: Arc<RwLock<bool>>,
    fail_on_put: Arc<RwLock<bool>>,
}

impl MockStorage {
    pub fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
            fail_on_get: Arc::new(RwLock::new(false)),
            fail_on_put: Arc::new(RwLock::new(false)),
        }
    }

    /// Set the storage to fail on get operations
    pub fn set_fail_on_get(&self, fail: bool) {
        *self.fail_on_get.write() = fail;
    }

    /// Set the storage to fail on put operations
    pub fn set_fail_on_put(&self, fail: bool) {
        *self.fail_on_put.write() = fail;
    }

    /// Get the internal data for inspection
    pub fn get_data(&self) -> HashMap<Vec<u8>, Vec<u8>> {
        self.data.read().clone()
    }

    /// Clear all data
    pub fn clear(&self) {
        self.data.write().clear();
    }

    /// Get number of stored items
    pub fn len(&self) -> usize {
        self.data.read().len()
    }

    /// Check if storage is empty
    pub fn is_empty(&self) -> bool {
        self.data.read().is_empty()
    }
}

impl Default for MockStorage {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Storage for MockStorage {
    async fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>> {
        if *self.fail_on_get.read() {
            return Err(anyhow!("Mock get failure"));
        }
        Ok(self.data.read().get(key).cloned())
    }

    async fn put(&self, key: &[u8], value: &[u8]) -> Result<()> {
        if *self.fail_on_put.read() {
            return Err(anyhow!("Mock put failure"));
        }
        self.data.write().insert(key.to_vec(), value.to_vec());
        Ok(())
    }

    async fn delete(&self, key: &[u8]) -> Result<()> {
        self.data.write().remove(key);
        Ok(())
    }

    async fn exists(&self, key: &[u8]) -> Result<bool> {
        Ok(self.data.read().contains_key(key))
    }

    async fn get_keys_with_prefix(&self, prefix: &[u8]) -> Result<Vec<Vec<u8>>> {
        Ok(self
            .data
            .read()
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect())
    }

    async fn batch_write(&self, operations: Vec<WriteOp>) -> Result<()> {
        let mut data = self.data.write();
        for op in operations {
            match op {
                WriteOp::Put { key, value } => {
                    data.insert(key, value);
                }
                WriteOp::Delete { key } => {
                    data.remove(&key);
                }
            }
        }
        Ok(())
    }

    async fn snapshot(&self) -> Result<Box<dyn Snapshot>> {
        Ok(Box::new(MockSnapshot {
            data: self.data.read().clone(),
        }))
    }
}

/// Mock snapshot implementation
pub struct MockSnapshot {
    data: HashMap<Vec<u8>, Vec<u8>>,
}

#[async_trait]
impl Snapshot for MockSnapshot {
    async fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>> {
        Ok(self.data.get(key).cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_mock_storage_put_get() {
        let storage = MockStorage::new();
        storage.put(b"key", b"value").await.unwrap();
        let value = storage.get(b"key").await.unwrap();
        assert_eq!(value, Some(b"value".to_vec()));
    }

    #[tokio::test]
    async fn test_mock_storage_delete() {
        let storage = MockStorage::new();
        storage.put(b"key", b"value").await.unwrap();
        storage.delete(b"key").await.unwrap();
        let value = storage.get(b"key").await.unwrap();
        assert_eq!(value, None);
    }

    #[tokio::test]
    async fn test_mock_storage_exists() {
        let storage = MockStorage::new();
        storage.put(b"key", b"value").await.unwrap();
        assert!(storage.exists(b"key").await.unwrap());
        assert!(!storage.exists(b"nonexistent").await.unwrap());
    }

    #[tokio::test]
    async fn test_mock_storage_prefix_search() {
        let storage = MockStorage::new();
        storage.put(b"prefix:key1", b"value1").await.unwrap();
        storage.put(b"prefix:key2", b"value2").await.unwrap();
        storage.put(b"other:key3", b"value3").await.unwrap();

        let keys = storage.get_keys_with_prefix(b"prefix:").await.unwrap();
        assert_eq!(keys.len(), 2);
    }

    #[tokio::test]
    async fn test_mock_storage_batch_write() {
        let storage = MockStorage::new();
        let ops = vec![
            WriteOp::Put {
                key: b"key1".to_vec(),
                value: b"value1".to_vec(),
            },
            WriteOp::Put {
                key: b"key2".to_vec(),
                value: b"value2".to_vec(),
            },
        ];

        storage.batch_write(ops).await.unwrap();
        assert_eq!(storage.len(), 2);
    }

    #[tokio::test]
    async fn test_mock_storage_fail_on_get() {
        let storage = MockStorage::new();
        storage.put(b"key", b"value").await.unwrap();
        storage.set_fail_on_get(true);

        let result = storage.get(b"key").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_mock_storage_fail_on_put() {
        let storage = MockStorage::new();
        storage.set_fail_on_put(true);

        let result = storage.put(b"key", b"value").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_mock_snapshot() {
        let storage = MockStorage::new();
        storage.put(b"key", b"value").await.unwrap();

        let snapshot = storage.snapshot().await.unwrap();
        let value = snapshot.get(b"key").await.unwrap();
        assert_eq!(value, Some(b"value".to_vec()));
    }
}
