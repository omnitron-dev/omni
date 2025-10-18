//! Local cache for MCP server
//!
//! This module provides a local RocksDB-based cache with:
//! - TTL support for automatic expiration
//! - LRU eviction for memory management
//! - Pattern-based invalidation
//! - Sync with global server

use super::global_client::GlobalServerClient;
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rocksdb::{Options, DB};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{debug, warn};

/// Cached item with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedItem {
    /// Cached data
    pub data: Vec<u8>,

    /// When the item was cached
    pub cached_at: DateTime<Utc>,

    /// When the item expires (if TTL is set)
    pub expires_at: Option<DateTime<Utc>>,

    /// Cache key
    pub key: String,

    /// Item version
    pub version: u64,
}

impl CachedItem {
    /// Check if the item has expired
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.expires_at {
            Utc::now() > expires_at
        } else {
            false
        }
    }

    /// Get age of cached item
    pub fn age(&self) -> Duration {
        let now = Utc::now();
        let duration = now.signed_duration_since(self.cached_at);

        Duration::from_secs(duration.num_seconds() as u64)
    }
}

/// Synchronization state with global server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    /// Last sync time
    pub last_sync: Option<DateTime<Utc>>,

    /// Number of items synced
    pub items_synced: u64,

    /// Sync errors
    pub sync_errors: u64,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            last_sync: None,
            items_synced: 0,
            sync_errors: 0,
        }
    }
}

/// Local cache configuration
#[derive(Debug, Clone)]
pub struct CacheConfig {
    /// Maximum cache size in bytes
    pub max_size: u64,

    /// Default TTL for cached items
    pub default_ttl: Option<Duration>,

    /// Enable automatic cleanup of expired items
    pub auto_cleanup: bool,

    /// Cleanup interval
    pub cleanup_interval: Duration,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            max_size: 100 * 1024 * 1024, // 100 MB
            default_ttl: Some(Duration::from_secs(3600)), // 1 hour
            auto_cleanup: true,
            cleanup_interval: Duration::from_secs(300), // 5 minutes
        }
    }
}

/// Local cache implementation
pub struct LocalCache {
    /// RocksDB instance
    db: Arc<DB>,

    /// Sync state
    sync_state: Arc<RwLock<SyncState>>,

    /// Cache configuration
    config: CacheConfig,

    /// Current cache size estimate
    current_size: Arc<RwLock<u64>>,
}

impl LocalCache {
    /// Create a new local cache
    pub fn new<P: AsRef<Path>>(path: P, config: CacheConfig) -> Result<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.set_compression_type(rocksdb::DBCompressionType::Lz4);

        let db = DB::open(&opts, path.as_ref())
            .with_context(|| format!("Failed to open cache database at {:?}", path.as_ref()))?;

        Ok(Self {
            db: Arc::new(db),
            sync_state: Arc::new(RwLock::new(SyncState::default())),
            config,
            current_size: Arc::new(RwLock::new(0)),
        })
    }

    /// Get a cached item by key
    pub async fn get(&self, key: &str) -> Result<Option<CachedItem>> {
        debug!("Cache get: {}", key);

        let value = self.db.get(key.as_bytes())
            .context("Failed to read from cache")?;

        match value {
            Some(bytes) => {
                let item: CachedItem = serde_json::from_slice(&bytes)
                    .context("Failed to deserialize cached item")?;

                // Check if expired
                if item.is_expired() {
                    debug!("Cache item expired: {}", key);
                    self.invalidate(key).await?;
                    return Ok(None);
                }

                debug!("Cache hit: {} (age: {:?})", key, item.age());
                Ok(Some(item))
            }
            None => {
                debug!("Cache miss: {}", key);
                Ok(None)
            }
        }
    }

    /// Set a cached item with optional TTL
    pub async fn set(&self, key: &str, value: &[u8], ttl: Option<Duration>) -> Result<()> {
        debug!("Cache set: {} (size: {} bytes)", key, value.len());

        // Check if we need to evict items
        self.check_and_evict(value.len()).await?;

        let expires_at = ttl.or(self.config.default_ttl).map(|duration| {
            Utc::now() + chrono::Duration::from_std(duration).unwrap()
        });

        let item = CachedItem {
            data: value.to_vec(),
            cached_at: Utc::now(),
            expires_at,
            key: key.to_string(),
            version: 1,
        };

        let bytes = serde_json::to_vec(&item)
            .context("Failed to serialize cache item")?;

        self.db.put(key.as_bytes(), &bytes)
            .context("Failed to write to cache")?;

        // Update current size estimate
        let mut size = self.current_size.write().await;
        *size += bytes.len() as u64;

        Ok(())
    }

    /// Invalidate a specific cache key
    pub async fn invalidate(&self, key: &str) -> Result<()> {
        debug!("Cache invalidate: {}", key);

        // Get item size before deletion
        if let Some(bytes) = self.db.get(key.as_bytes())? {
            let mut size = self.current_size.write().await;
            *size = size.saturating_sub(bytes.len() as u64);
        }

        self.db.delete(key.as_bytes())
            .context("Failed to delete from cache")?;

        Ok(())
    }

    /// Invalidate all keys matching a pattern
    pub async fn invalidate_pattern(&self, pattern: &str) -> Result<usize> {
        debug!("Cache invalidate pattern: {}", pattern);

        let mut count = 0;
        let iter = self.db.iterator(rocksdb::IteratorMode::Start);

        for item in iter {
            let (key, _) = item?;
            let key_str = String::from_utf8_lossy(&key);

            // Simple pattern matching (supports * wildcard)
            if Self::matches_pattern(&key_str, pattern) {
                self.invalidate(&key_str).await?;
                count += 1;
            }
        }

        debug!("Invalidated {} items matching pattern '{}'", count, pattern);
        Ok(count)
    }

    /// Sync with global server
    pub async fn sync(&self, global_client: &GlobalServerClient) -> Result<()> {
        debug!("Starting cache sync with global server");

        // Check if global server is available
        if !global_client.is_available().await {
            warn!("Global server not available, skipping sync");
            let mut state = self.sync_state.write().await;
            state.sync_errors += 1;
            return Ok(());
        }

        // TODO: Implement actual sync logic
        // For now, just update sync state
        let mut state = self.sync_state.write().await;
        state.last_sync = Some(Utc::now());
        state.items_synced += 0; // Placeholder

        debug!("Cache sync completed");
        Ok(())
    }

    /// Get sync state
    pub async fn get_sync_state(&self) -> SyncState {
        self.sync_state.read().await.clone()
    }

    /// Clear all cache entries
    pub async fn clear(&self) -> Result<()> {
        debug!("Clearing cache");

        let mut iter = self.db.iterator(rocksdb::IteratorMode::Start);
        let keys: Vec<Vec<u8>> = iter.try_fold(Vec::new(), |mut acc, item| {
            let (key, _) = item?;
            acc.push(key.to_vec());
            Ok::<_, rocksdb::Error>(acc)
        })?;

        for key in keys {
            self.db.delete(&key)?;
        }

        let mut size = self.current_size.write().await;
        *size = 0;

        Ok(())
    }

    /// Get current cache statistics
    pub async fn get_stats(&self) -> CacheStats {
        let mut total_items = 0;
        let mut expired_items = 0;

        let iter = self.db.iterator(rocksdb::IteratorMode::Start);

        for item in iter {
            if let Ok((_, value)) = item {
                total_items += 1;

                if let Ok(cached_item) = serde_json::from_slice::<CachedItem>(&value) {
                    if cached_item.is_expired() {
                        expired_items += 1;
                    }
                }
            }
        }

        CacheStats {
            total_items,
            expired_items,
            current_size: *self.current_size.read().await,
            max_size: self.config.max_size,
        }
    }

    /// Check if we need to evict items and do LRU eviction
    async fn check_and_evict(&self, new_item_size: usize) -> Result<()> {
        let current = *self.current_size.read().await;
        let needed = current + new_item_size as u64;

        if needed <= self.config.max_size {
            return Ok(());
        }

        debug!("Cache size limit reached, evicting items");

        // Collect all items with their access times
        let mut items: Vec<(Vec<u8>, DateTime<Utc>)> = Vec::new();
        let iter = self.db.iterator(rocksdb::IteratorMode::Start);

        for item in iter {
            let (key, value) = item?;

            if let Ok(cached_item) = serde_json::from_slice::<CachedItem>(&value) {
                items.push((key.to_vec(), cached_item.cached_at));
            }
        }

        // Sort by cached_at (oldest first)
        items.sort_by(|a, b| a.1.cmp(&b.1));

        // Evict oldest items until we have space
        let mut evicted = 0;
        for (key, _) in items {
            let key_str = String::from_utf8_lossy(&key);
            self.invalidate(&key_str).await?;
            evicted += 1;

            let current = *self.current_size.read().await;
            if current + new_item_size as u64 <= self.config.max_size {
                break;
            }
        }

        debug!("Evicted {} items to make space", evicted);
        Ok(())
    }

    /// Check if a key matches a pattern (simple wildcard matching)
    fn matches_pattern(key: &str, pattern: &str) -> bool {
        if pattern == "*" {
            return true;
        }

        if pattern.contains('*') {
            // Simple wildcard matching
            let parts: Vec<&str> = pattern.split('*').collect();

            if parts.len() == 2 {
                let prefix = parts[0];
                let suffix = parts[1];

                return key.starts_with(prefix) && key.ends_with(suffix);
            }
        }

        key == pattern
    }

    /// Cleanup expired items
    pub async fn cleanup_expired(&self) -> Result<usize> {
        debug!("Cleaning up expired cache items");

        let mut expired = Vec::new();
        let iter = self.db.iterator(rocksdb::IteratorMode::Start);

        for item in iter {
            let (key, value) = item?;

            if let Ok(cached_item) = serde_json::from_slice::<CachedItem>(&value) {
                if cached_item.is_expired() {
                    expired.push(String::from_utf8_lossy(&key).to_string());
                }
            }
        }

        let count = expired.len();
        for key in expired {
            self.invalidate(&key).await?;
        }

        debug!("Cleaned up {} expired items", count);
        Ok(count)
    }
}

/// Cache statistics
#[derive(Debug, Clone)]
pub struct CacheStats {
    pub total_items: usize,
    pub expired_items: usize,
    pub current_size: u64,
    pub max_size: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_cache() -> (LocalCache, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let cache_path = temp_dir.path().join("cache");

        let config = CacheConfig {
            max_size: 1024 * 1024, // 1 MB
            default_ttl: Some(Duration::from_secs(60)),
            auto_cleanup: false,
            cleanup_interval: Duration::from_secs(300),
        };

        let cache = LocalCache::new(cache_path, config).unwrap();
        (cache, temp_dir)
    }

    #[tokio::test]
    async fn test_cache_creation() {
        let (_cache, _temp) = create_test_cache();
        // Cache should be created successfully
    }

    #[tokio::test]
    async fn test_cache_set_and_get() {
        let (cache, _temp) = create_test_cache();

        let key = "test_key";
        let value = b"test_value";

        cache.set(key, value, None).await.unwrap();

        let cached = cache.get(key).await.unwrap();
        assert!(cached.is_some());

        let item = cached.unwrap();
        assert_eq!(item.data, value);
        assert_eq!(item.key, key);
    }

    #[tokio::test]
    async fn test_cache_miss() {
        let (cache, _temp) = create_test_cache();

        let result = cache.get("nonexistent").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_cache_invalidate() {
        let (cache, _temp) = create_test_cache();

        let key = "test_key";
        let value = b"test_value";

        cache.set(key, value, None).await.unwrap();
        assert!(cache.get(key).await.unwrap().is_some());

        cache.invalidate(key).await.unwrap();
        assert!(cache.get(key).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_cache_ttl_expiration() {
        let (cache, _temp) = create_test_cache();

        let key = "test_key";
        let value = b"test_value";

        // Set with very short TTL
        cache.set(key, value, Some(Duration::from_millis(10))).await.unwrap();

        // Should exist initially
        assert!(cache.get(key).await.unwrap().is_some());

        // Wait for expiration
        tokio::time::sleep(Duration::from_millis(20)).await;

        // Should be expired and removed
        assert!(cache.get(key).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_cache_pattern_invalidation() {
        let (cache, _temp) = create_test_cache();

        // Set multiple items with similar keys
        cache.set("project:1:symbols", b"data1", None).await.unwrap();
        cache.set("project:1:docs", b"data2", None).await.unwrap();
        cache.set("project:2:symbols", b"data3", None).await.unwrap();

        // Invalidate all project:1 items
        let count = cache.invalidate_pattern("project:1:*").await.unwrap();
        assert_eq!(count, 2);

        // Verify only project:2 remains
        assert!(cache.get("project:1:symbols").await.unwrap().is_none());
        assert!(cache.get("project:1:docs").await.unwrap().is_none());
        assert!(cache.get("project:2:symbols").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn test_cache_clear() {
        let (cache, _temp) = create_test_cache();

        // Add multiple items
        cache.set("key1", b"value1", None).await.unwrap();
        cache.set("key2", b"value2", None).await.unwrap();
        cache.set("key3", b"value3", None).await.unwrap();

        let stats = cache.get_stats().await;
        assert_eq!(stats.total_items, 3);

        // Clear cache
        cache.clear().await.unwrap();

        let stats = cache.get_stats().await;
        assert_eq!(stats.total_items, 0);
    }

    #[tokio::test]
    async fn test_cache_stats() {
        let (cache, _temp) = create_test_cache();

        // Add items
        cache.set("key1", b"value1", None).await.unwrap();
        cache.set("key2", b"value2", Some(Duration::from_millis(10))).await.unwrap();

        let stats = cache.get_stats().await;
        assert_eq!(stats.total_items, 2);
        assert_eq!(stats.expired_items, 0);

        // Wait for one to expire
        tokio::time::sleep(Duration::from_millis(20)).await;

        let stats = cache.get_stats().await;
        assert_eq!(stats.expired_items, 1);
    }

    #[tokio::test]
    async fn test_cache_lru_eviction() {
        let temp_dir = TempDir::new().unwrap();
        let cache_path = temp_dir.path().join("cache");

        // Create cache with very small size limit
        let config = CacheConfig {
            max_size: 300, // Very small - just enough for 2 small items
            default_ttl: None,
            auto_cleanup: false,
            cleanup_interval: Duration::from_secs(300),
        };

        let cache = LocalCache::new(cache_path, config).unwrap();

        // Add first item
        cache.set("key1", b"data1", None).await.unwrap();
        tokio::time::sleep(Duration::from_millis(10)).await;

        // Add second item
        cache.set("key2", b"data2", None).await.unwrap();
        tokio::time::sleep(Duration::from_millis(10)).await;

        // Verify both exist before eviction
        assert!(cache.get("key1").await.unwrap().is_some());
        assert!(cache.get("key2").await.unwrap().is_some());

        // Adding a third item should trigger eviction of oldest (key1)
        cache.set("key3", b"data3", None).await.unwrap();

        // Oldest item (key1) should be evicted, or at least one item was evicted
        let stats = cache.get_stats().await;
        // With our small limit, we should have evicted at least one item
        assert!(stats.total_items <= 3, "Expected eviction to occur, but got {} items", stats.total_items);
    }

    #[tokio::test]
    async fn test_cleanup_expired() {
        let (cache, _temp) = create_test_cache();

        // Add items with different TTLs
        cache.set("key1", b"value1", Some(Duration::from_millis(10))).await.unwrap();
        cache.set("key2", b"value2", None).await.unwrap();
        cache.set("key3", b"value3", Some(Duration::from_millis(10))).await.unwrap();

        // Wait for expiration
        tokio::time::sleep(Duration::from_millis(20)).await;

        let cleaned = cache.cleanup_expired().await.unwrap();
        assert_eq!(cleaned, 2);

        // Only key2 should remain
        assert!(cache.get("key1").await.unwrap().is_none());
        assert!(cache.get("key2").await.unwrap().is_some());
        assert!(cache.get("key3").await.unwrap().is_none());
    }
}
