/// RocksDB connection pooling for efficient database reuse
///
/// This module provides a global pool of RocksDB connections to avoid
/// the overhead of repeatedly opening the same database.

use anyhow::{Context, Result};
use rocksdb::{Options, DB};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

/// Global database pool
static DB_POOL: OnceLock<Mutex<HashMap<PathBuf, Arc<DB>>>> = OnceLock::new();

fn get_pool() -> &'static Mutex<HashMap<PathBuf, Arc<DB>>> {
    DB_POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Get or create a RocksDB connection from the pool
///
/// If a connection already exists for the given path, returns the cached instance.
/// Otherwise, creates a new connection with the provided options.
pub fn get_or_create_db(path: &Path, opts: Options) -> Result<Arc<DB>> {
    let path_buf = path.to_path_buf();

    // Try to get from pool first
    {
        let pool = get_pool().lock().unwrap();
        if let Some(db) = pool.get(&path_buf) {
            tracing::debug!("Reusing existing DB connection for {:?}", path);
            return Ok(Arc::clone(db));
        }
    }

    // Create new connection
    tracing::debug!("Creating new DB connection for {:?}", path);
    let db = DB::open(&opts, path)
        .with_context(|| format!("Failed to open DB at {:?}", path))?;
    let db_arc = Arc::new(db);

    // Store in pool
    {
        let mut pool = get_pool().lock().unwrap();
        pool.insert(path_buf, Arc::clone(&db_arc));
    }

    Ok(db_arc)
}

/// Get a database connection from the pool (if it exists)
pub fn get_db(path: &Path) -> Option<Arc<DB>> {
    let pool = get_pool().lock().unwrap();
    pool.get(path).map(Arc::clone)
}

/// Remove a database from the pool
///
/// This should be called when you want to fully close a database.
/// The database will be closed when all Arc references are dropped.
pub fn remove_db(path: &Path) -> Option<Arc<DB>> {
    let mut pool = get_pool().lock().unwrap();
    let removed = pool.remove(path);
    if removed.is_some() {
        tracing::debug!("Removed DB connection for {:?} from pool", path);
    }
    removed
}

/// Get pool statistics
pub fn get_pool_stats() -> PoolStats {
    let pool = get_pool().lock().unwrap();
    PoolStats {
        active_connections: pool.len(),
        paths: pool.keys().cloned().collect(),
    }
}

/// Pool statistics
#[derive(Debug, Clone)]
pub struct PoolStats {
    pub active_connections: usize,
    pub paths: Vec<PathBuf>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_connection_pooling() {
        let temp_dir = tempdir().unwrap();
        let db_path = temp_dir.path().join("test_db");

        let mut opts = Options::default();
        opts.create_if_missing(true);

        // First connection
        let db1 = get_or_create_db(&db_path, opts.clone()).unwrap();

        // Second connection should reuse
        let db2 = get_or_create_db(&db_path, opts).unwrap();

        // Should be same Arc
        assert!(Arc::ptr_eq(&db1, &db2));

        // Check stats
        let stats = get_pool_stats();
        assert_eq!(stats.active_connections, 1);
        assert_eq!(stats.paths.len(), 1);

        // Remove from pool
        let removed = remove_db(&db_path);
        assert!(removed.is_some());

        // Stats should show empty
        let stats = get_pool_stats();
        assert_eq!(stats.active_connections, 0);
    }
}
