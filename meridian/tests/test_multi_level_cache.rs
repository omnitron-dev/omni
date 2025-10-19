use meridian::cache::{MultiLevelCache, MultiLevelCacheConfig};
use meridian::storage::RocksDBStorage;
use std::sync::Arc;
use tempfile::TempDir;

#[tokio::test]
async fn test_multi_level_cache_basic() {
    let temp_dir = TempDir::new().unwrap();
    let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

    let config = MultiLevelCacheConfig {
        l1_capacity: 2,
        l2_capacity: 3,
        l3_prefix: "test:".to_string(),
        auto_promote: true,
    };

    let cache = MultiLevelCache::<String, String>::new(storage, config).unwrap();

    // Test basic put/get
    cache.put("key1".to_string(), "value1".to_string()).await.unwrap();
    let result = cache.get(&"key1".to_string()).await.unwrap();
    assert_eq!(result, Some("value1".to_string()));

    // Check stats - should be L1 hit
    let stats = cache.stats();
    assert_eq!(stats.l1_hits, 1);
    assert_eq!(stats.total_gets, 1);
    assert_eq!(stats.total_puts, 1);
    assert!(stats.hit_rate() > 0.99); // Should be 100%
}

#[tokio::test]
async fn test_cache_promotion() {
    let temp_dir = TempDir::new().unwrap();
    let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

    let config = MultiLevelCacheConfig {
        l1_capacity: 2,
        l2_capacity: 3,
        l3_prefix: "test:".to_string(),
        auto_promote: true,
    };

    let cache = MultiLevelCache::<String, i32>::new(storage, config).unwrap();

    // Fill L1 (2 entries)
    cache.put("a".to_string(), 1).await.unwrap();
    cache.put("b".to_string(), 2).await.unwrap();

    // This should evict "a" to L2
    cache.put("c".to_string(), 3).await.unwrap();

    // Access "a" - should be L2 hit and promote to L1
    let result = cache.get(&"a".to_string()).await.unwrap();
    assert_eq!(result, Some(1));

    let stats = cache.stats();
    assert_eq!(stats.l2_hits, 1);

    // Access "a" again - should now be L1 hit
    cache.get(&"a".to_string()).await.unwrap();
    let stats = cache.stats();
    assert_eq!(stats.l1_hits, 1);

    // Hit rate should be 100% (2 hits, 0 misses)
    assert!(stats.hit_rate() > 0.99);
}

#[tokio::test]
async fn test_cascade_to_l3() {
    let temp_dir = TempDir::new().unwrap();
    let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

    let config = MultiLevelCacheConfig {
        l1_capacity: 2,
        l2_capacity: 3,
        l3_prefix: "test:".to_string(),
        auto_promote: true,
    };

    let cache = MultiLevelCache::<String, i32>::new(storage, config).unwrap();

    // Fill L1 (2) and L2 (3) completely
    cache.put("a".to_string(), 1).await.unwrap();
    cache.put("b".to_string(), 2).await.unwrap();
    cache.put("c".to_string(), 3).await.unwrap(); // Evicts "a" to L2
    cache.put("d".to_string(), 4).await.unwrap(); // Evicts "b" to L2
    cache.put("e".to_string(), 5).await.unwrap(); // Evicts "c" to L2

    // This should evict oldest from L2 to L3
    cache.put("f".to_string(), 6).await.unwrap();

    // Try to get "a" - should be in L3
    let result = cache.get(&"a".to_string()).await.unwrap();
    assert_eq!(result, Some(1));

    let stats = cache.stats();
    assert_eq!(stats.l3_hits, 1);
    println!("Cache stats: {:?}", stats);
    println!("Hit rate: {:.1}%", stats.hit_rate() * 100.0);
    println!("Avg latency: {:.2}ms", stats.avg_latency_ms());
}

#[tokio::test]
async fn test_cache_invalidation() {
    let temp_dir = TempDir::new().unwrap();
    let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

    let config = MultiLevelCacheConfig::default();
    let cache = MultiLevelCache::<String, String>::new(storage, config).unwrap();

    cache.put("key1".to_string(), "value1".to_string()).await.unwrap();
    assert!(cache.get(&"key1".to_string()).await.unwrap().is_some());

    cache.invalidate(&"key1".to_string()).await.unwrap();
    assert!(cache.get(&"key1".to_string()).await.unwrap().is_none());

    let stats = cache.stats();
    assert_eq!(stats.total_invalidations, 1);
    assert_eq!(stats.misses, 1);
}

#[tokio::test]
async fn test_hit_rate_calculation() {
    let temp_dir = TempDir::new().unwrap();
    let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

    let config = MultiLevelCacheConfig::default();
    let cache = MultiLevelCache::<String, i32>::new(storage, config).unwrap();

    cache.put("a".to_string(), 1).await.unwrap();
    cache.put("b".to_string(), 2).await.unwrap();

    // 2 hits
    cache.get(&"a".to_string()).await.unwrap();
    cache.get(&"b".to_string()).await.unwrap();

    // 1 miss
    cache.get(&"c".to_string()).await.unwrap();

    let stats = cache.stats();
    assert_eq!(stats.total_gets, 3);
    assert_eq!(stats.l1_hits, 2);
    assert_eq!(stats.misses, 1);

    // Hit rate should be 2/3 ≈ 0.666
    let hit_rate = stats.hit_rate();
    assert!((hit_rate - 0.666).abs() < 0.01);

    println!("Hit rate: {:.1}%", hit_rate * 100.0);
    println!("Avg latency: {:.2}ms", stats.avg_latency_ms());
}
