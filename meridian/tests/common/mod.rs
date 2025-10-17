pub mod fixtures;
pub mod mocks;

use meridian::storage::{RocksDBStorage, Storage};
use std::path::Path;
use std::sync::Arc;
use tempfile::TempDir;

/// Create a test storage instance with temporary directory
pub fn create_test_storage() -> (Arc<dyn Storage>, TempDir) {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let storage = RocksDBStorage::new(temp_dir.path()).expect("Failed to create storage");
    (Arc::new(storage) as Arc<dyn Storage>, temp_dir)
}

/// Create test storage at a specific path
pub fn create_test_storage_at(path: &Path) -> Arc<dyn Storage> {
    let storage = RocksDBStorage::new(path).expect("Failed to create storage");
    Arc::new(storage) as Arc<dyn Storage>
}

/// Helper to wait for async operations
pub async fn wait_for_condition<F>(mut check: F, timeout_ms: u64) -> bool
where
    F: FnMut() -> bool,
{
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_millis(timeout_ms);

    loop {
        if check() {
            return true;
        }

        if start.elapsed() > timeout {
            return false;
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_create_test_storage() {
        let (storage, _temp) = create_test_storage();
        assert!(storage.put(b"test", b"value").await.is_ok());
    }

    #[tokio::test]
    async fn test_wait_for_condition() {
        let counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter_clone = counter.clone();

        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            counter_clone.store(1, std::sync::atomic::Ordering::SeqCst);
        });

        let result = wait_for_condition(
            || counter.load(std::sync::atomic::Ordering::SeqCst) == 1,
            200,
        )
        .await;

        assert!(result);
    }
}
