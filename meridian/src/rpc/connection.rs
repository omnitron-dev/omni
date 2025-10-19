//! Connection management and pooling

use anyhow::Result;
use std::sync::Arc;
use tokio::sync::Semaphore;

/// Connection pool for managing multiple RPC connections
pub struct ConnectionPool {
    /// Maximum concurrent connections
    max_connections: usize,

    /// Semaphore for limiting connections
    semaphore: Arc<Semaphore>,
}

impl ConnectionPool {
    /// Create new connection pool
    pub fn new(max_connections: usize) -> Self {
        Self {
            max_connections,
            semaphore: Arc::new(Semaphore::new(max_connections)),
        }
    }

    /// Acquire connection permit
    pub async fn acquire(&self) -> Result<ConnectionPermit> {
        let permit = self.semaphore.clone().acquire_owned().await?;
        Ok(ConnectionPermit { _permit: permit })
    }

    /// Get current pool size
    pub fn size(&self) -> usize {
        self.max_connections - self.semaphore.available_permits()
    }

    /// Get available connections
    pub fn available(&self) -> usize {
        self.semaphore.available_permits()
    }
}

/// Connection permit (RAII guard)
pub struct ConnectionPermit {
    _permit: tokio::sync::OwnedSemaphorePermit,
}

/// Connection statistics
pub struct Connection {
    /// Connection ID
    pub id: String,

    /// Connected at
    pub connected_at: chrono::DateTime<chrono::Utc>,

    /// Last activity
    pub last_activity: chrono::DateTime<chrono::Utc>,

    /// Request count
    pub request_count: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_connection_pool() {
        let pool = ConnectionPool::new(5);

        assert_eq!(pool.size(), 0);
        assert_eq!(pool.available(), 5);

        // Acquire permits
        let _p1 = pool.acquire().await.unwrap();
        let _p2 = pool.acquire().await.unwrap();

        assert_eq!(pool.size(), 2);
        assert_eq!(pool.available(), 3);

        // Release permits by dropping
        drop(_p1);
        assert_eq!(pool.size(), 1);
        assert_eq!(pool.available(), 4);
    }
}
