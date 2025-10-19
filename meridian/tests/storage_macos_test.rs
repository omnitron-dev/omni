/// Tests for macOS-specific RocksDB storage fixes
///
/// These tests verify that the storage layer works correctly on macOS,
/// including handling of file locking issues and fallback to in-memory storage.

use meridian::storage::{create_storage, create_default_storage, StorageConfig};
use tempfile::TempDir;

#[tokio::test]
async fn test_rocksdb_storage_basic_operations() {
    let temp_dir = TempDir::new().unwrap();
    let config = StorageConfig::new();

    let storage = create_storage(temp_dir.path(), config)
        .await
        .expect("Failed to create storage");

    // Test basic operations
    storage
        .put(b"test_key", b"test_value")
        .await
        .expect("Failed to put value");

    let value = storage
        .get(b"test_key")
        .await
        .expect("Failed to get value");

    assert_eq!(value, Some(b"test_value".to_vec()));

    // Test exists
    assert!(storage.exists(b"test_key").await.unwrap());
    assert!(!storage.exists(b"nonexistent").await.unwrap());

    // Test delete
    storage.delete(b"test_key").await.unwrap();
    assert!(!storage.exists(b"test_key").await.unwrap());
}

#[tokio::test]
async fn test_memory_storage_fallback() {
    // Create a storage with force_memory enabled
    let temp_dir = TempDir::new().unwrap();
    let config = StorageConfig::new().with_force_memory();

    let storage = create_storage(temp_dir.path(), config)
        .await
        .expect("Failed to create in-memory storage");

    // Test basic operations
    storage
        .put(b"memory_key", b"memory_value")
        .await
        .expect("Failed to put value");

    let value = storage
        .get(b"memory_key")
        .await
        .expect("Failed to get value");

    assert_eq!(value, Some(b"memory_value".to_vec()));
}

#[tokio::test]
async fn test_storage_batch_operations() {
    let temp_dir = TempDir::new().unwrap();
    let storage = create_default_storage(temp_dir.path())
        .await
        .expect("Failed to create storage");

    // Test batch write
    let ops = vec![
        meridian::storage::WriteOp::Put {
            key: b"key1".to_vec(),
            value: b"value1".to_vec(),
        },
        meridian::storage::WriteOp::Put {
            key: b"key2".to_vec(),
            value: b"value2".to_vec(),
        },
        meridian::storage::WriteOp::Put {
            key: b"key3".to_vec(),
            value: b"value3".to_vec(),
        },
    ];

    storage.batch_write(ops).await.expect("Batch write failed");

    // Verify all keys exist
    assert!(storage.exists(b"key1").await.unwrap());
    assert!(storage.exists(b"key2").await.unwrap());
    assert!(storage.exists(b"key3").await.unwrap());

    // Test batch with delete
    let ops = vec![
        meridian::storage::WriteOp::Delete {
            key: b"key1".to_vec(),
        },
        meridian::storage::WriteOp::Put {
            key: b"key4".to_vec(),
            value: b"value4".to_vec(),
        },
    ];

    storage.batch_write(ops).await.expect("Batch write failed");

    assert!(!storage.exists(b"key1").await.unwrap());
    assert!(storage.exists(b"key4").await.unwrap());
}

#[tokio::test]
async fn test_storage_prefix_query() {
    let temp_dir = TempDir::new().unwrap();
    let storage = create_default_storage(temp_dir.path())
        .await
        .expect("Failed to create storage");

    // Insert keys with different prefixes
    storage.put(b"user:1:name", b"Alice").await.unwrap();
    storage.put(b"user:2:name", b"Bob").await.unwrap();
    storage.put(b"user:3:name", b"Charlie").await.unwrap();
    storage.put(b"post:1:title", b"First Post").await.unwrap();
    storage.put(b"post:2:title", b"Second Post").await.unwrap();

    // Query user keys
    let user_keys = storage
        .get_keys_with_prefix(b"user:")
        .await
        .expect("Failed to get keys with prefix");

    assert_eq!(user_keys.len(), 3);
    assert!(user_keys.contains(&b"user:1:name".to_vec()));
    assert!(user_keys.contains(&b"user:2:name".to_vec()));
    assert!(user_keys.contains(&b"user:3:name".to_vec()));

    // Query post keys
    let post_keys = storage
        .get_keys_with_prefix(b"post:")
        .await
        .expect("Failed to get keys with prefix");

    assert_eq!(post_keys.len(), 2);
    assert!(post_keys.contains(&b"post:1:title".to_vec()));
    assert!(post_keys.contains(&b"post:2:title".to_vec()));
}

#[tokio::test]
async fn test_storage_snapshot() {
    let temp_dir = TempDir::new().unwrap();

    // Use in-memory storage for snapshot test since RocksDB snapshots
    // have lifetime issues with async contexts
    let config = StorageConfig::new().with_force_memory();
    let storage = create_storage(temp_dir.path(), config)
        .await
        .expect("Failed to create storage");

    // Put initial value
    storage.put(b"snap_key", b"initial").await.unwrap();

    // Create snapshot
    let snapshot = storage.snapshot().await.expect("Failed to create snapshot");

    // Modify storage after snapshot
    storage.put(b"snap_key", b"modified").await.unwrap();

    // Snapshot should have old value
    let snap_value = snapshot
        .get(b"snap_key")
        .await
        .expect("Failed to get from snapshot");
    assert_eq!(snap_value, Some(b"initial".to_vec()));

    // Storage should have new value
    let storage_value = storage
        .get(b"snap_key")
        .await
        .expect("Failed to get from storage");
    assert_eq!(storage_value, Some(b"modified".to_vec()));
}

#[tokio::test]
#[cfg(target_os = "macos")]
async fn test_macos_configuration() {
    // This test verifies that storage can be created on macOS
    // without file locking issues
    let temp_dir = TempDir::new().unwrap();

    // Try creating storage multiple times (this would fail with lock issues)
    for i in 0..3 {
        let config = StorageConfig::new();
        let storage = create_storage(temp_dir.path(), config)
            .await
            .expect("Failed to create storage on macOS");

        let key = format!("macos_test_{}", i);
        storage.put(key.as_bytes(), b"test_value").await.unwrap();

        let value = storage.get(key.as_bytes()).await.unwrap();
        assert_eq!(value, Some(b"test_value".to_vec()));

        // Drop storage to release resources
        drop(storage);
    }
}

#[tokio::test]
async fn test_concurrent_storage_access() {
    let temp_dir = TempDir::new().unwrap();
    let storage = std::sync::Arc::new(
        create_default_storage(temp_dir.path())
            .await
            .expect("Failed to create storage"),
    );

    let mut handles = vec![];

    // Spawn multiple tasks writing concurrently
    for i in 0..10 {
        let storage_clone = storage.clone();
        let handle = tokio::spawn(async move {
            let key = format!("concurrent_key_{}", i);
            let value = format!("concurrent_value_{}", i);
            storage_clone
                .put(key.as_bytes(), value.as_bytes())
                .await
                .unwrap();
        });
        handles.push(handle);
    }

    // Wait for all tasks to complete
    for handle in handles {
        handle.await.unwrap();
    }

    // Verify all keys exist
    for i in 0..10 {
        let key = format!("concurrent_key_{}", i);
        assert!(storage.exists(key.as_bytes()).await.unwrap());
    }
}
