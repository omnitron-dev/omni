use anyhow::Result;
use meridian::storage::{
    create_storage, StorageBackend, StorageConfig, SurrealDBConfig, SurrealDBStorage, Storage,
};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    println!("=== SurrealDB Storage Example ===\n");

    // Create temporary directory for database
    let temp_dir = tempfile::tempdir()?;
    let db_path = temp_dir.path().join("example_db");

    // Example 1: Direct SurrealDB storage creation
    println!("1. Creating SurrealDB storage directly...");
    let storage = SurrealDBStorage::new(&db_path).await?;
    println!("   ✓ Storage created successfully");

    // Example 2: Basic operations
    println!("\n2. Testing basic operations...");
    storage.put(b"hello", b"world").await?;
    println!("   ✓ Put: hello -> world");

    let value = storage.get(b"hello").await?;
    println!("   ✓ Get: hello -> {:?}", String::from_utf8_lossy(value.as_ref().unwrap()));

    let exists = storage.exists(b"hello").await?;
    println!("   ✓ Exists: hello -> {}", exists);

    // Example 3: Prefix queries
    println!("\n3. Testing prefix queries...");
    storage.put(b"user:1:name", b"Alice").await?;
    storage.put(b"user:1:email", b"alice@example.com").await?;
    storage.put(b"user:2:name", b"Bob").await?;
    println!("   ✓ Inserted 3 user keys");

    let keys = storage.get_keys_with_prefix(b"user:1:").await?;
    println!("   ✓ Found {} keys with prefix 'user:1:'", keys.len());

    // Example 4: Delete operation
    println!("\n4. Testing delete operation...");
    storage.delete(b"hello").await?;
    let exists = storage.exists(b"hello").await?;
    println!("   ✓ Deleted 'hello', exists: {}", exists);

    // Example 5: Using factory with configuration
    println!("\n5. Testing storage factory...");
    let factory_path = temp_dir.path().join("factory_db");
    let config = StorageConfig::new()
        .with_backend(StorageBackend::SurrealDB)
        .with_surrealdb_config(SurrealDBConfig {
            namespace: "example_ns".to_string(),
            database: "example_db".to_string(),
        });

    let factory_storage = create_storage(&factory_path, config).await?;
    factory_storage.put(b"factory_test", b"success").await?;
    println!("   ✓ Factory storage works correctly");

    // Example 6: Batch operations
    println!("\n6. Testing batch operations...");
    use meridian::storage::WriteOp;

    let batch_ops = vec![
        WriteOp::Put {
            key: b"batch:1".to_vec(),
            value: b"value1".to_vec(),
        },
        WriteOp::Put {
            key: b"batch:2".to_vec(),
            value: b"value2".to_vec(),
        },
        WriteOp::Put {
            key: b"batch:3".to_vec(),
            value: b"value3".to_vec(),
        },
    ];

    storage.batch_write(batch_ops).await?;
    let batch_keys = storage.get_keys_with_prefix(b"batch:").await?;
    println!("   ✓ Batch write completed, {} keys created", batch_keys.len());

    println!("\n=== All examples completed successfully! ===");

    Ok(())
}
