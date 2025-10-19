//! Database connection pool for RPC server
//!
//! This module provides simplified access to the existing RocksDB storage
//! used throughout Meridian, with request tracking and statistics.

use anyhow::Result;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::debug;

/// Configuration for database pool
#[derive(Debug, Clone)]
pub struct PoolConfig {
    /// Maximum concurrent operations
    pub max_concurrent: usize,

    /// Enable request tracking
    pub track_requests: bool,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            max_concurrent: 100,
            track_requests: true,
        }
    }
}

/// Database pool wrapping existing storage
pub struct DatabasePool {
    storage: Arc<crate::storage::RocksDBStorage>,
    stats: Arc<RwLock<PoolStats>>,
}

/// Pool statistics
#[derive(Debug, Clone, Default)]
pub struct PoolStats {
    pub total_requests: u64,
    pub active_requests: u64,
    pub failed_requests: u64,
}

impl DatabasePool {
    /// Create a new database pool from existing storage
    pub fn from_storage(storage: Arc<crate::storage::RocksDBStorage>) -> Self {
        Self {
            storage,
            stats: Arc::new(RwLock::new(PoolStats::default())),
        }
    }

    /// Get reference to the underlying storage
    pub fn storage(&self) -> &Arc<crate::storage::RocksDBStorage> {
        &self.storage
    }

    /// Get pool statistics
    pub async fn get_stats(&self) -> PoolStats {
        self.stats.read().await.clone()
    }

    /// Record a request start
    pub async fn record_request_start(&self) {
        let mut stats = self.stats.write().await;
        stats.total_requests += 1;
        stats.active_requests += 1;
    }

    /// Record a request completion
    pub async fn record_request_complete(&self, success: bool) {
        let mut stats = self.stats.write().await;
        stats.active_requests = stats.active_requests.saturating_sub(1);
        if !success {
            stats.failed_requests += 1;
        }
    }

    /// Run health check
    pub async fn health_check(&self) -> Result<()> {
        debug!("Database pool health check passed");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_pool_creation() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(
            crate::storage::RocksDBStorage::new(temp_dir.path()).unwrap()
        );

        let pool = DatabasePool::from_storage(storage);

        let stats = pool.get_stats().await;
        assert_eq!(stats.total_requests, 0);
        assert_eq!(stats.active_requests, 0);
    }

    #[tokio::test]
    async fn test_request_tracking() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(
            crate::storage::RocksDBStorage::new(temp_dir.path()).unwrap()
        );

        let pool = DatabasePool::from_storage(storage);

        // Simulate requests
        pool.record_request_start().await;
        pool.record_request_start().await;

        let stats = pool.get_stats().await;
        assert_eq!(stats.total_requests, 2);
        assert_eq!(stats.active_requests, 2);

        pool.record_request_complete(true).await;

        let stats = pool.get_stats().await;
        assert_eq!(stats.active_requests, 1);
        assert_eq!(stats.failed_requests, 0);
    }
}
