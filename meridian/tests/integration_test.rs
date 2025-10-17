use meridian::{Config, MeridianServer};
use tempfile::TempDir;

#[tokio::test]
async fn test_server_initialization() {
    let temp_dir = TempDir::new().unwrap();
    let mut config = Config::default();
    config.storage.path = temp_dir.path().join("index");

    let result = MeridianServer::new(config).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_config_load() {
    let config = Config::default();
    assert!(!config.index.languages.is_empty());
    assert!(config.index.languages.contains(&"rust".to_string()));
}

#[tokio::test]
async fn test_storage_operations() {
    use meridian::storage::{RocksDBStorage, Storage};
    use std::sync::Arc;

    let temp_dir = TempDir::new().unwrap();
    let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

    // Test put and get
    storage.put(b"test_key", b"test_value").await.unwrap();
    let value = storage.get(b"test_key").await.unwrap();
    assert_eq!(value, Some(b"test_value".to_vec()));

    // Test delete
    storage.delete(b"test_key").await.unwrap();
    let value = storage.get(b"test_key").await.unwrap();
    assert_eq!(value, None);
}
