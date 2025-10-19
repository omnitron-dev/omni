//! Connection pool manager for database connections
//!
//! This module provides a thread-safe connection pool with health checks,
//! connection recycling, and statistics tracking for optimal resource utilization.

use anyhow::{Context, Result};
use parking_lot::RwLock;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;
use tracing::{debug, error};

/// Configuration for connection pool
#[derive(Debug, Clone)]
pub struct ConnectionPoolConfig {
    /// Minimum number of connections to maintain
    pub min_size: usize,

    /// Maximum number of connections
    pub max_size: usize,

    /// Connection timeout in milliseconds
    pub connection_timeout_ms: u64,

    /// Connection idle timeout in milliseconds (connections idle longer are recycled)
    pub idle_timeout_ms: u64,

    /// Health check interval in seconds
    pub health_check_interval_secs: u64,

    /// Maximum time to wait for a connection from pool
    pub acquire_timeout_ms: u64,
}

impl Default for ConnectionPoolConfig {
    fn default() -> Self {
        Self {
            min_size: 4,
            max_size: num_cpus::get() * 4,
            connection_timeout_ms: 5000,
            idle_timeout_ms: 300_000, // 5 minutes
            health_check_interval_secs: 60,
            acquire_timeout_ms: 10_000,
        }
    }
}

/// A pooled database connection
pub struct PooledConnection {
    storage: Arc<dyn crate::storage::Storage>,
    created_at: Instant,
    last_used: Arc<RwLock<Instant>>,
    id: usize,
}

impl PooledConnection {
    fn new(storage: Arc<dyn crate::storage::Storage>, id: usize) -> Self {
        let now = Instant::now();
        Self {
            storage,
            created_at: now,
            last_used: Arc::new(RwLock::new(now)),
            id,
        }
    }

    /// Get reference to underlying storage
    pub fn storage(&self) -> &Arc<dyn crate::storage::Storage> {
        &self.storage
    }

    /// Update last used timestamp
    fn touch(&self) {
        *self.last_used.write() = Instant::now();
    }

    /// Check if connection is idle for too long
    fn is_idle(&self, idle_timeout: Duration) -> bool {
        self.last_used.read().elapsed() > idle_timeout
    }

    /// Get connection age
    fn age(&self) -> Duration {
        self.created_at.elapsed()
    }
}

/// Connection pool statistics
#[derive(Debug, Clone, Default)]
pub struct PoolStatistics {
    /// Total connections in pool
    pub total_connections: usize,

    /// Active (checked out) connections
    pub active_connections: usize,

    /// Idle (available) connections
    pub idle_connections: usize,

    /// Total connections created
    pub total_created: u64,

    /// Total connections recycled
    pub total_recycled: u64,

    /// Total failed health checks
    pub failed_health_checks: u64,

    /// Total acquire timeouts
    pub acquire_timeouts: u64,

    /// Average wait time for connection (ms)
    pub avg_wait_time_ms: u64,
}

/// Thread-safe connection pool manager
pub struct ConnectionPoolManager {
    storage: Arc<dyn crate::storage::Storage>,
    config: ConnectionPoolConfig,
    available: Arc<RwLock<Vec<PooledConnection>>>,
    stats: Arc<RwLock<PoolStatistics>>,
    semaphore: Arc<Semaphore>,
    next_id: Arc<RwLock<usize>>,
}

impl ConnectionPoolManager {
    /// Create a new connection pool manager
    pub fn new(
        storage: Arc<dyn crate::storage::Storage>,
        config: ConnectionPoolConfig,
    ) -> Result<Self> {
        let mut available = Vec::with_capacity(config.min_size);

        // Pre-create minimum connections
        for i in 0..config.min_size {
            available.push(PooledConnection::new(Arc::clone(&storage), i));
        }

        debug!(
            "Created connection pool with {} initial connections (max: {})",
            config.min_size, config.max_size
        );

        let stats = PoolStatistics {
            total_connections: config.min_size,
            idle_connections: config.min_size,
            total_created: config.min_size as u64,
            ..Default::default()
        };

        Ok(Self {
            storage,
            config: config.clone(),
            available: Arc::new(RwLock::new(available)),
            stats: Arc::new(RwLock::new(stats)),
            semaphore: Arc::new(Semaphore::new(config.max_size)),
            next_id: Arc::new(RwLock::new(config.min_size)),
        })
    }

    /// Acquire a connection from the pool
    pub async fn acquire(&self) -> Result<PooledConnectionGuard<'_>> {
        let start = Instant::now();

        // Acquire semaphore permit (enforces max connections)
        let permit = tokio::time::timeout(
            Duration::from_millis(self.config.acquire_timeout_ms),
            self.semaphore.acquire(),
        )
        .await
        .context("Connection acquire timeout")?
        .context("Semaphore closed")?;

        // Try to get existing connection
        let conn = {
            let mut available = self.available.write();
            available.pop()
        };

        let conn = match conn {
            Some(conn) => {
                // Reuse existing connection
                conn.touch();
                debug!("Reused connection {} from pool", conn.id);
                conn
            }
            None => {
                // Create new connection
                let id = {
                    let mut next_id = self.next_id.write();
                    let id = *next_id;
                    *next_id += 1;
                    id
                };

                let conn = PooledConnection::new(Arc::clone(&self.storage), id);

                // Update stats
                {
                    let mut stats = self.stats.write();
                    stats.total_connections += 1;
                    stats.total_created += 1;
                }

                debug!("Created new connection {} (total: {})", id, id + 1);
                conn
            }
        };

        // Update stats
        {
            let mut stats = self.stats.write();
            stats.active_connections += 1;
            stats.idle_connections = stats.idle_connections.saturating_sub(1);

            let wait_time_ms = start.elapsed().as_millis() as u64;
            stats.avg_wait_time_ms =
                (stats.avg_wait_time_ms * (stats.total_created - 1) + wait_time_ms)
                / stats.total_created;
        }

        Ok(PooledConnectionGuard {
            conn: Some(conn),
            pool: self.available.clone(),
            stats: self.stats.clone(),
            _permit: permit,
        })
    }

    /// Get pool statistics
    pub fn get_stats(&self) -> PoolStatistics {
        self.stats.read().clone()
    }

    /// Run health check on all idle connections
    pub async fn health_check(&self) -> Result<()> {
        let idle_timeout = Duration::from_millis(self.config.idle_timeout_ms);

        let mut available = self.available.write();
        let before = available.len();

        // Remove stale connections
        available.retain(|conn| !conn.is_idle(idle_timeout));

        let recycled = before - available.len();

        if recycled > 0 {
            let mut stats = self.stats.write();
            stats.total_recycled += recycled as u64;
            stats.total_connections = stats.total_connections.saturating_sub(recycled);
            stats.idle_connections = available.len();

            debug!(
                "Recycled {} idle connections (pool size: {})",
                recycled, stats.total_connections
            );
        }

        // Ensure minimum connections
        while available.len() < self.config.min_size {
            let id = {
                let mut next_id = self.next_id.write();
                let id = *next_id;
                *next_id += 1;
                id
            };

            available.push(PooledConnection::new(Arc::clone(&self.storage), id));

            let mut stats = self.stats.write();
            stats.total_connections += 1;
            stats.total_created += 1;
            stats.idle_connections = available.len();
        }

        Ok(())
    }

    /// Spawn background health check task
    pub fn spawn_health_check_task(self: Arc<Self>) {
        let interval = Duration::from_secs(self.config.health_check_interval_secs);

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(interval);

            loop {
                interval.tick().await;

                if let Err(e) = self.health_check().await {
                    error!("Health check failed: {}", e);
                }
            }
        });
    }
}

/// RAII guard for pooled connection
pub struct PooledConnectionGuard<'a> {
    conn: Option<PooledConnection>,
    pool: Arc<RwLock<Vec<PooledConnection>>>,
    stats: Arc<RwLock<PoolStatistics>>,
    _permit: tokio::sync::SemaphorePermit<'a>,
}

impl<'a> PooledConnectionGuard<'a> {
    /// Get reference to underlying storage
    pub fn storage(&self) -> &Arc<dyn crate::storage::Storage> {
        self.conn.as_ref().unwrap().storage()
    }
}

impl<'a> Drop for PooledConnectionGuard<'a> {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take() {
            // Return connection to pool
            self.pool.write().push(conn);

            // Update stats
            let mut stats = self.stats.write();
            stats.active_connections = stats.active_connections.saturating_sub(1);
            stats.idle_connections += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_pool() -> (TempDir, Arc<ConnectionPoolManager>) {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(crate::storage::MemoryStorage::new()) as Arc<dyn crate::storage::Storage>;

        let config = ConnectionPoolConfig {
            min_size: 2,
            max_size: 4,
            ..Default::default()
        };

        let pool = Arc::new(ConnectionPoolManager::new(storage, config).unwrap());
        (temp_dir, pool)
    }

    #[tokio::test]
    async fn test_pool_creation() {
        let (_temp, pool) = create_test_pool();

        let stats = pool.get_stats();
        assert_eq!(stats.total_connections, 2);
        assert_eq!(stats.idle_connections, 2);
        assert_eq!(stats.active_connections, 0);
    }

    #[tokio::test]
    async fn test_acquire_and_release() {
        let (_temp, pool) = create_test_pool();

        {
            let _conn = pool.acquire().await.unwrap();
            let stats = pool.get_stats();
            assert_eq!(stats.active_connections, 1);
            assert_eq!(stats.idle_connections, 1);
        }

        // Connection should be returned to pool
        tokio::time::sleep(Duration::from_millis(10)).await;
        let stats = pool.get_stats();
        assert_eq!(stats.active_connections, 0);
        assert_eq!(stats.idle_connections, 2);
    }

    #[tokio::test]
    async fn test_max_connections() {
        let (_temp, pool) = create_test_pool();

        // Acquire all connections
        let _c1 = pool.acquire().await.unwrap();
        let _c2 = pool.acquire().await.unwrap();
        let _c3 = pool.acquire().await.unwrap();
        let _c4 = pool.acquire().await.unwrap();

        let stats = pool.get_stats();
        assert_eq!(stats.active_connections, 4);

        // Next acquire should timeout
        let result = pool.acquire().await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_concurrent_access() {
        let (_temp, pool) = create_test_pool();

        let mut handles = vec![];

        for i in 0..10 {
            let pool = Arc::clone(&pool);
            handles.push(tokio::spawn(async move {
                let _conn = pool.acquire().await.unwrap();
                tokio::time::sleep(Duration::from_millis(10)).await;
                i
            }));
        }

        for handle in handles {
            handle.await.unwrap();
        }

        // All connections should be returned
        tokio::time::sleep(Duration::from_millis(50)).await;
        let stats = pool.get_stats();
        assert_eq!(stats.active_connections, 0);
    }
}
