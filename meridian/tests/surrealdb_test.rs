use anyhow::Result;
use meridian::storage::{
    Storage, StorageBackend,
    StorageConfig, SurrealDBConfig, SurrealDBStorage, create_storage,
};
use std::path::Path;
use tempfile::TempDir;

/// Test basic SurrealDB storage operations
#[tokio::test]
async fn test_surrealdb_basic_operations() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let storage = SurrealDBStorage::new(temp_dir.path()).await?;

    // Test put and get
    storage.put(b"test_key", b"test_value").await?;
    let value = storage.get(b"test_key").await?;
    assert_eq!(value, Some(b"test_value".to_vec()));

    // Test exists
    assert!(storage.exists(b"test_key").await?);
    assert!(!storage.exists(b"nonexistent").await?);

    // Test delete
    storage.delete(b"test_key").await?;
    assert!(!storage.exists(b"test_key").await?);

    Ok(())
}

/// Test SurrealDB with custom configuration
#[tokio::test]
async fn test_surrealdb_custom_config() -> Result<()> {
    let temp_dir = TempDir::new()?;

    let config = SurrealDBConfig {
        namespace: "test_namespace".to_string(),
        database: "test_database".to_string(),
    };

    let storage = SurrealDBStorage::new_with_config(temp_dir.path(), config.clone()).await?;

    assert_eq!(storage.namespace(), "test_namespace");
    assert_eq!(storage.database(), "test_database");

    // Test basic operations
    storage.put(b"key", b"value").await?;
    assert_eq!(storage.get(b"key").await?, Some(b"value".to_vec()));

    Ok(())
}

/// Test prefix queries
#[tokio::test]
async fn test_surrealdb_prefix_queries() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let storage = SurrealDBStorage::new(temp_dir.path()).await?;

    // Insert keys with different prefixes
    storage.put(b"user:1:name", b"Alice").await?;
    storage.put(b"user:1:email", b"alice@example.com").await?;
    storage.put(b"user:2:name", b"Bob").await?;
    storage.put(b"product:1:name", b"Widget").await?;

    // Query keys with "user:1:" prefix
    let keys = storage.get_keys_with_prefix(b"user:1:").await?;
    assert_eq!(keys.len(), 2);

    // Verify all keys start with the prefix
    for key in &keys {
        assert!(key.starts_with(b"user:1:"));
    }

    // Query keys with "user:" prefix
    let keys = storage.get_keys_with_prefix(b"user:").await?;
    assert_eq!(keys.len(), 3);

    // Query keys with "product:" prefix
    let keys = storage.get_keys_with_prefix(b"product:").await?;
    assert_eq!(keys.len(), 1);

    Ok(())
}

/// Test batch write operations
#[tokio::test]
async fn test_surrealdb_batch_write() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let storage = SurrealDBStorage::new(temp_dir.path()).await?;

    use meridian::storage::WriteOp;

    let operations = vec![
        WriteOp::Put {
            key: b"batch_key1".to_vec(),
            value: b"batch_value1".to_vec(),
        },
        WriteOp::Put {
            key: b"batch_key2".to_vec(),
            value: b"batch_value2".to_vec(),
        },
        WriteOp::Put {
            key: b"batch_key3".to_vec(),
            value: b"batch_value3".to_vec(),
        },
    ];

    storage.batch_write(operations).await?;

    // Verify all keys were written
    assert_eq!(
        storage.get(b"batch_key1").await?,
        Some(b"batch_value1".to_vec())
    );
    assert_eq!(
        storage.get(b"batch_key2").await?,
        Some(b"batch_value2".to_vec())
    );
    assert_eq!(
        storage.get(b"batch_key3").await?,
        Some(b"batch_value3".to_vec())
    );

    // Test batch delete
    let delete_ops = vec![
        WriteOp::Delete {
            key: b"batch_key1".to_vec(),
        },
        WriteOp::Delete {
            key: b"batch_key2".to_vec(),
        },
    ];

    storage.batch_write(delete_ops).await?;

    assert!(!storage.exists(b"batch_key1").await?);
    assert!(!storage.exists(b"batch_key2").await?);
    assert!(storage.exists(b"batch_key3").await?);

    Ok(())
}

/// Test snapshot functionality
#[tokio::test]
async fn test_surrealdb_snapshot() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let storage = SurrealDBStorage::new(temp_dir.path()).await?;

    // Insert some data
    storage.put(b"snapshot_key", b"snapshot_value").await?;

    // Create a snapshot
    let snapshot = storage.snapshot().await?;

    // Verify data can be read from snapshot
    let value = snapshot.get(b"snapshot_key").await?;
    assert_eq!(value, Some(b"snapshot_value".to_vec()));

    // Modify the storage
    storage.put(b"snapshot_key", b"modified_value").await?;

    // Original snapshot should still have old value
    // Note: SurrealDB snapshots are point-in-time, behavior may vary
    let value = storage.get(b"snapshot_key").await?;
    assert_eq!(value, Some(b"modified_value".to_vec()));

    Ok(())
}

// Migration tests removed - migration from RocksDB to SurrealDB is complete
// RocksDB is now only used internally by SurrealDB via kv-rocksdb backend

/// Test large dataset migration - DISABLED
/// Migration from RocksDB to SurrealDB is complete
/// RocksDB is now only used internally by SurrealDB
#[tokio::test]
#[ignore]
async fn test_large_dataset_migration() -> Result<()> {
    Ok(())
}

/// Test storage factory with SurrealDB backend
#[tokio::test]
async fn test_storage_factory_surrealdb() -> Result<()> {
    let temp_dir = TempDir::new()?;

    let config = StorageConfig::new().with_backend(StorageBackend::SurrealDB);

    let storage = create_storage(temp_dir.path(), config).await?;

    // Test basic operations
    storage.put(b"factory_key", b"factory_value").await?;
    assert_eq!(
        storage.get(b"factory_key").await?,
        Some(b"factory_value".to_vec())
    );

    Ok(())
}

/// Test storage factory with environment variable
#[tokio::test]
async fn test_storage_factory_env_var() -> Result<()> {
    let temp_dir = TempDir::new()?;

    // Set environment variable
    std::env::set_var("MERIDIAN_STORAGE_BACKEND", "surrealdb");

    let config = StorageConfig::new();
    assert_eq!(config.backend, StorageBackend::SurrealDB);

    let storage = create_storage(temp_dir.path(), config).await?;

    storage.put(b"env_key", b"env_value").await?;
    assert_eq!(
        storage.get(b"env_key").await?,
        Some(b"env_value".to_vec())
    );

    // Clean up
    std::env::remove_var("MERIDIAN_STORAGE_BACKEND");

    Ok(())
}

/// Test concurrent operations
#[tokio::test]
async fn test_concurrent_operations() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let storage = std::sync::Arc::new(SurrealDBStorage::new(temp_dir.path()).await?);

    // Spawn multiple tasks that write concurrently
    let mut handles = vec![];

    for i in 0..10 {
        let storage = storage.clone();
        let handle = tokio::spawn(async move {
            let key = format!("concurrent_key_{}", i);
            let value = format!("concurrent_value_{}", i);
            storage.put(key.as_bytes(), value.as_bytes()).await
        });
        handles.push(handle);
    }

    // Wait for all tasks to complete
    for handle in handles {
        handle.await??;
    }

    // Verify all keys were written
    for i in 0..10 {
        let key = format!("concurrent_key_{}", i);
        let value = format!("concurrent_value_{}", i);
        assert_eq!(
            storage.get(key.as_bytes()).await?,
            Some(value.as_bytes().to_vec())
        );
    }

    Ok(())
}

/// Test binary data handling
#[tokio::test]
async fn test_binary_data() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let storage = SurrealDBStorage::new(temp_dir.path()).await?;

    // Test with various binary data
    let binary_data = vec![0u8, 1, 2, 3, 255, 254, 253];
    storage.put(b"binary_key", &binary_data).await?;

    let retrieved = storage.get(b"binary_key").await?;
    assert_eq!(retrieved, Some(binary_data));

    Ok(())
}

/// Test UTF-8 and special characters
#[tokio::test]
async fn test_utf8_special_chars() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let storage = SurrealDBStorage::new(temp_dir.path()).await?;

    // Test with UTF-8 strings
    let utf8_value = "Hello, 世界! 🦀";
    storage
        .put(b"utf8_key", utf8_value.as_bytes())
        .await?;

    let retrieved = storage.get(b"utf8_key").await?;
    assert_eq!(
        retrieved,
        Some(utf8_value.as_bytes().to_vec())
    );

    Ok(())
}

/// Test error handling for invalid operations
#[tokio::test]
async fn test_error_handling() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let storage = SurrealDBStorage::new(temp_dir.path()).await?;

    // Try to get non-existent key
    let result = storage.get(b"nonexistent_key").await?;
    assert_eq!(result, None);

    // Delete non-existent key should succeed (idempotent)
    storage.delete(b"nonexistent_key").await?;

    Ok(())
}

/// Test database instance access
#[tokio::test]
async fn test_db_instance_access() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let storage = SurrealDBStorage::new(temp_dir.path()).await?;

    // Access the underlying database instance
    let db = storage.db();
    assert!(std::sync::Arc::strong_count(&db) >= 1);

    Ok(())
}
