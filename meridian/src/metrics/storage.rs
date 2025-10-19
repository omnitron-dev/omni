use super::types::MetricsSnapshot;
use anyhow::{Context, Result};
use chrono::{DateTime, Duration, Utc};
use rocksdb::{IteratorMode, Options, DB};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Default metrics database path relative to Meridian home (~/.meridian/db/current/metrics/)
pub const DEFAULT_METRICS_DB_PATH: &str = "db/current/metrics";

/// RocksDB key format for metrics snapshots
///
/// Key format: "snapshot:{timestamp_millis}"
/// This allows efficient time-range queries and automatic ordering
fn make_snapshot_key(timestamp: &DateTime<Utc>) -> String {
    format!("snapshot:{}", timestamp.timestamp_millis())
}

/// RocksDB key format for aggregated metrics
///
/// Key format: "agg:{granularity}:{timestamp}"
/// Granularity: "hour", "day", "week"
#[allow(dead_code)]
fn make_aggregation_key(granularity: &str, timestamp: &DateTime<Utc>) -> String {
    format!("agg:{}:{}", granularity, timestamp.timestamp_millis())
}

/// Parse timestamp from snapshot key
fn parse_timestamp_from_key(key: &str) -> Result<DateTime<Utc>> {
    let parts: Vec<&str> = key.split(':').collect();
    if parts.len() < 2 {
        anyhow::bail!("Invalid metrics key format: {}", key);
    }

    let millis: i64 = parts[parts.len() - 1].parse()?;
    DateTime::from_timestamp_millis(millis)
        .ok_or_else(|| anyhow::anyhow!("Invalid timestamp: {}", millis))
}

/// Get default metrics database path
pub fn get_default_metrics_path() -> Result<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| anyhow::anyhow!("Could not determine home directory"))?;
    Ok(home.join(".meridian").join(DEFAULT_METRICS_DB_PATH))
}

/// Metrics storage using dedicated RocksDB instance
///
/// This storage is completely separate from the main Meridian database to:
/// - Prevent metrics bloat from affecting main DB performance
/// - Allow independent tuning for time-series workloads
/// - Enable separate backup/restore strategies
/// - Isolate high-write metrics I/O from main database operations
///
/// Storage schema:
/// - Snapshots: "snapshot:{timestamp_millis}" -> JSON MetricsSnapshot
/// - Aggregations: "agg:{granularity}:{timestamp}" -> JSON aggregated data
///
/// Optimizations:
/// - LSM-tree tuning for sequential time-series writes
/// - Universal compaction for better compression
/// - Reduced write amplification
/// - Efficient range scans with ordered keys
///
/// Retention policy:
/// - Automatically deletes snapshots older than retention period
/// - Default retention: 30 days
/// - Aggregated data has separate retention (90 days)
#[derive(Clone)]
pub struct MetricsStorage {
    db: Arc<DB>,
    retention_days: u32,
    aggregation_retention_days: u32,
}

impl MetricsStorage {
    /// Create a new metrics storage at default path
    ///
    /// # Arguments
    /// * `retention_days` - Number of days to retain raw snapshots (default: 30)
    pub fn new_default(retention_days: Option<u32>) -> Result<Self> {
        let path = get_default_metrics_path()?;
        Self::new(&path, retention_days)
    }

    /// Create a new metrics storage at custom path
    ///
    /// # Arguments
    /// * `path` - Path to RocksDB directory (separate from main DB)
    /// * `retention_days` - Number of days to retain raw snapshots (default: 30)
    pub fn new(path: &Path, retention_days: Option<u32>) -> Result<Self> {
        // Create directory if it doesn't exist
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create metrics DB directory: {:?}", parent))?;
        }

        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);

        // Optimize for time-series data (high write volume, sequential reads)
        // Use Universal compaction for better compression and less write amplification
        opts.set_compaction_style(rocksdb::DBCompactionStyle::Universal);

        // Reduce memory usage while maintaining good performance
        opts.set_write_buffer_size(64 * 1024 * 1024); // 64MB write buffer
        opts.set_max_write_buffer_number(3);
        opts.set_target_file_size_base(128 * 1024 * 1024); // 128MB

        // Background jobs for compaction and flushing
        opts.set_max_background_jobs(2);

        // Enable compression for older data
        opts.set_compression_type(rocksdb::DBCompressionType::Lz4);

        // Optimize for sequential writes (time-series pattern)
        opts.set_level_zero_file_num_compaction_trigger(4);
        opts.set_level_zero_slowdown_writes_trigger(20);
        opts.set_level_zero_stop_writes_trigger(30);

        let db = DB::open(&opts, path)
            .with_context(|| format!("Failed to open metrics DB at {:?}", path))?;

        Ok(Self {
            db: Arc::new(db),
            retention_days: retention_days.unwrap_or(30),
            aggregation_retention_days: 90, // Keep aggregations longer
        })
    }

    /// Get retention days for snapshots
    pub fn retention_days(&self) -> u32 {
        self.retention_days
    }

    /// Get retention days for aggregations
    pub fn aggregation_retention_days(&self) -> u32 {
        self.aggregation_retention_days
    }

    /// Save a metrics snapshot to storage
    pub async fn save_snapshot(&self, snapshot: &MetricsSnapshot) -> Result<()> {
        let key = make_snapshot_key(&snapshot.timestamp);
        let value = serde_json::to_vec(snapshot)
            .context("Failed to serialize snapshot")?;

        let db = Arc::clone(&self.db);
        let key_bytes = key.into_bytes();

        tokio::task::spawn_blocking(move || {
            db.put(&key_bytes, &value)
                .context("Failed to write snapshot to DB")
        })
        .await??;

        Ok(())
    }

    /// Load a single snapshot by timestamp
    pub async fn load_snapshot(&self, timestamp: &DateTime<Utc>) -> Result<Option<MetricsSnapshot>> {
        let key = make_snapshot_key(timestamp);
        let db = Arc::clone(&self.db);
        let key_bytes = key.into_bytes();

        let value = tokio::task::spawn_blocking(move || db.get(&key_bytes))
            .await?
            .context("Failed to read snapshot from DB")?;

        match value {
            Some(bytes) => {
                let snapshot = serde_json::from_slice(&bytes)
                    .context("Failed to deserialize snapshot")?;
                Ok(Some(snapshot))
            }
            None => Ok(None),
        }
    }

    /// Load all snapshots within a time range
    ///
    /// # Arguments
    /// * `start` - Start of time range (inclusive)
    /// * `end` - End of time range (inclusive)
    pub async fn load_range(
        &self,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<MetricsSnapshot>> {
        let start_key = make_snapshot_key(&start);
        let end_key = make_snapshot_key(&end);

        let db = Arc::clone(&self.db);
        let start_bytes = start_key.into_bytes();
        let end_bytes = end_key.into_bytes();

        tokio::task::spawn_blocking(move || {
            let mut snapshots = Vec::new();
            let iter = db.iterator(IteratorMode::Start);

            for item in iter {
                let (key, value) = item.context("Failed to iterate metrics DB")?;

                // Check if key is in range
                if key.as_ref() < start_bytes.as_slice() {
                    continue;
                }
                if key.as_ref() > end_bytes.as_slice() {
                    break;
                }

                // Deserialize snapshot
                let snapshot: MetricsSnapshot = serde_json::from_slice(&value)
                    .context("Failed to deserialize snapshot")?;
                snapshots.push(snapshot);
            }

            Ok(snapshots)
        })
        .await?
    }

    /// Delete snapshots older than retention period
    ///
    /// Returns the number of snapshots deleted
    pub async fn cleanup_old_snapshots(&self, custom_retention_days: Option<u32>) -> Result<u64> {
        let retention = custom_retention_days.unwrap_or(self.retention_days);
        let cutoff = Utc::now() - Duration::days(retention as i64);
        let cutoff_key = make_snapshot_key(&cutoff);

        let db = Arc::clone(&self.db);
        let cutoff_bytes = cutoff_key.into_bytes();

        tokio::task::spawn_blocking(move || {
            let mut deleted = 0u64;
            let mut keys_to_delete = Vec::new();

            // Collect keys to delete
            let iter = db.iterator(IteratorMode::Start);
            for item in iter {
                let (key, _) = item.context("Failed to iterate metrics DB")?;

                // Check if this is a snapshot key
                if !key.starts_with(b"snapshot:") {
                    continue;
                }

                // Check if older than cutoff
                if key.as_ref() < cutoff_bytes.as_slice() {
                    keys_to_delete.push(key.to_vec());
                } else {
                    // Since keys are ordered, we can stop here
                    break;
                }
            }

            // Delete collected keys
            for key in keys_to_delete {
                db.delete(&key).context("Failed to delete old snapshot")?;
                deleted += 1;
            }

            Ok(deleted)
        })
        .await?
    }

    /// Delete aggregations older than their retention period
    ///
    /// Returns the number of aggregations deleted
    pub async fn cleanup_old_aggregations(&self) -> Result<u64> {
        let cutoff = Utc::now() - Duration::days(self.aggregation_retention_days as i64);

        let db = Arc::clone(&self.db);

        tokio::task::spawn_blocking(move || {
            let mut deleted = 0u64;
            let mut keys_to_delete = Vec::new();

            // Collect aggregation keys to delete
            let iter = db.iterator(IteratorMode::Start);
            for item in iter {
                let (key, _) = item.context("Failed to iterate metrics DB")?;

                // Check if this is an aggregation key
                if !key.starts_with(b"agg:") {
                    continue;
                }

                // Parse timestamp from key and check age
                if let Ok(key_str) = std::str::from_utf8(&key) {
                    if let Ok(timestamp) = parse_timestamp_from_key(key_str) {
                        if timestamp < cutoff {
                            keys_to_delete.push(key.to_vec());
                        }
                    }
                }
            }

            // Delete collected keys
            for key in keys_to_delete {
                db.delete(&key).context("Failed to delete old aggregation")?;
                deleted += 1;
            }

            Ok(deleted)
        })
        .await?
    }

    /// Cleanup all old data (snapshots and aggregations)
    ///
    /// Returns tuple of (snapshots_deleted, aggregations_deleted)
    pub async fn cleanup_all(&self) -> Result<(u64, u64)> {
        let snapshots_deleted = self.cleanup_old_snapshots(None).await?;
        let aggregations_deleted = self.cleanup_old_aggregations().await?;
        Ok((snapshots_deleted, aggregations_deleted))
    }

    /// Get the total number of snapshots stored
    pub async fn count_snapshots(&self) -> Result<u64> {
        let db = Arc::clone(&self.db);

        tokio::task::spawn_blocking(move || {
            let mut count = 0u64;
            let iter = db.iterator(IteratorMode::Start);

            for item in iter {
                let (key, _) = item.context("Failed to iterate metrics DB")?;
                if key.starts_with(b"snapshot:") {
                    count += 1;
                }
            }

            Ok(count)
        })
        .await?
    }

    /// Get the total number of aggregations stored
    pub async fn count_aggregations(&self) -> Result<u64> {
        let db = Arc::clone(&self.db);

        tokio::task::spawn_blocking(move || {
            let mut count = 0u64;
            let iter = db.iterator(IteratorMode::Start);

            for item in iter {
                let (key, _) = item.context("Failed to iterate metrics DB")?;
                if key.starts_with(b"agg:") {
                    count += 1;
                }
            }

            Ok(count)
        })
        .await?
    }

    /// Get database statistics
    pub async fn get_stats(&self) -> Result<MetricsStorageStats> {
        let snapshot_count = self.count_snapshots().await?;
        let aggregation_count = self.count_aggregations().await?;
        let time_range = self.get_time_range().await?;

        Ok(MetricsStorageStats {
            snapshot_count,
            aggregation_count,
            retention_days: self.retention_days,
            aggregation_retention_days: self.aggregation_retention_days,
            oldest_snapshot: time_range.map(|(first, _)| first),
            newest_snapshot: time_range.map(|(_, last)| last),
        })
    }

    /// Get the oldest and newest snapshot timestamps
    pub async fn get_time_range(&self) -> Result<Option<(DateTime<Utc>, DateTime<Utc>)>> {
        let db = Arc::clone(&self.db);

        tokio::task::spawn_blocking(move || {
            let mut first: Option<DateTime<Utc>> = None;
            let mut last: Option<DateTime<Utc>> = None;

            let iter = db.iterator(IteratorMode::Start);
            for item in iter {
                let (key, _) = item.context("Failed to iterate metrics DB")?;
                if !key.starts_with(b"snapshot:") {
                    continue;
                }

                let key_str = String::from_utf8_lossy(&key);
                let timestamp = parse_timestamp_from_key(&key_str)?;

                if first.is_none() {
                    first = Some(timestamp);
                }
                last = Some(timestamp);
            }

            Ok(match (first, last) {
                (Some(f), Some(l)) => Some((f, l)),
                _ => None,
            })
        })
        .await?
    }

    /// Delete all snapshots (useful for testing)
    #[cfg(test)]
    pub async fn clear_all(&self) -> Result<()> {
        let db = Arc::clone(&self.db);

        tokio::task::spawn_blocking(move || {
            let mut keys_to_delete = Vec::new();

            let iter = db.iterator(IteratorMode::Start);
            for item in iter {
                let (key, _) = item.context("Failed to iterate metrics DB")?;
                if key.starts_with(b"snapshot:") || key.starts_with(b"agg:") {
                    keys_to_delete.push(key.to_vec());
                }
            }

            for key in keys_to_delete {
                db.delete(&key).context("Failed to delete entry")?;
            }

            Ok(())
        })
        .await?
    }
}

/// Statistics about the metrics storage
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MetricsStorageStats {
    pub snapshot_count: u64,
    pub aggregation_count: u64,
    pub retention_days: u32,
    pub aggregation_retention_days: u32,
    pub oldest_snapshot: Option<DateTime<Utc>>,
    pub newest_snapshot: Option<DateTime<Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::types::*;
    use std::collections::HashMap;
    use tempfile::TempDir;

    fn create_test_snapshot(timestamp: DateTime<Utc>) -> MetricsSnapshot {
        MetricsSnapshot {
            timestamp,
            tools: HashMap::new(),
            memory: MemoryMetricsSnapshot {
                total_episodes: 10,
                episodes_last_24h: 5,
                avg_episode_usefulness: 0.8,
                cache_hit_rate: 0.75,
                cache_size_mb: 100.0,
                prefetch_accuracy: 0.9,
                total_patterns: 20,
                knowledge_graph_nodes: 50,
                total_procedures: 15,
                procedure_success_rate: 0.95,
            },
            search: SearchMetricsSnapshot {
                total_queries: 100,
                semantic_queries: 60,
                text_queries: 40,
                avg_query_latency_ms: 15.5,
                avg_results_returned: 10.0,
                rerank_calls: 30,
                avg_rerank_latency_ms: 5.2,
            },
            sessions: SessionMetricsSnapshot {
                total_sessions: 5,
                active_sessions: 2,
                avg_session_duration_minutes: 45.0,
                queries_per_session: 20.0,
            },
            tokens: TokenEfficiencyMetricsSnapshot {
                total_input_tokens: 10000,
                total_output_tokens: 5000,
                tokens_saved_compression: 2000,
                tokens_saved_deduplication: 500,
                avg_compression_ratio: 0.7,
            },
            system: SystemMetricsSnapshot {
                cpu_usage_percent: 45.0,
                memory_usage_mb: 512.0,
                disk_usage_mb: 1024.0,
                uptime_seconds: 3600,
            },
        }
    }

    #[tokio::test]
    async fn test_save_and_load_snapshot() {
        let temp_dir = TempDir::new().unwrap();
        let storage = MetricsStorage::new(temp_dir.path(), Some(30)).unwrap();

        let snapshot = create_test_snapshot(Utc::now());
        storage.save_snapshot(&snapshot).await.unwrap();

        let loaded = storage
            .load_snapshot(&snapshot.timestamp)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(loaded.memory.total_episodes, 10);
        assert_eq!(loaded.search.total_queries, 100);
    }

    #[tokio::test]
    async fn test_load_range() {
        let temp_dir = TempDir::new().unwrap();
        let storage = MetricsStorage::new(temp_dir.path(), Some(30)).unwrap();

        let now = Utc::now();
        let mut timestamps = Vec::new();

        // Create snapshots at different times
        for i in 0..5 {
            let ts = now - Duration::hours(i);
            timestamps.push(ts);
            let snapshot = create_test_snapshot(ts);
            storage.save_snapshot(&snapshot).await.unwrap();
        }

        // Load range covering middle 3 snapshots
        let start = now - Duration::hours(3);
        let end = now - Duration::hours(1);
        let range = storage.load_range(start, end).await.unwrap();

        assert_eq!(range.len(), 3);
    }

    #[tokio::test]
    async fn test_cleanup_old() {
        let temp_dir = TempDir::new().unwrap();
        let storage = MetricsStorage::new(temp_dir.path(), Some(7)).unwrap();

        let now = Utc::now();

        // Create old snapshots
        for i in 0..5 {
            let ts = now - Duration::days(10 + i);
            let snapshot = create_test_snapshot(ts);
            storage.save_snapshot(&snapshot).await.unwrap();
        }

        // Create recent snapshots
        for i in 0..3 {
            let ts = now - Duration::days(i);
            let snapshot = create_test_snapshot(ts);
            storage.save_snapshot(&snapshot).await.unwrap();
        }

        // Should have 8 total
        let count_before = storage.count_snapshots().await.unwrap();
        assert_eq!(count_before, 8);

        // Cleanup with 7 day retention
        let deleted = storage.cleanup_old_snapshots(Some(7)).await.unwrap();
        assert_eq!(deleted, 5);

        // Should have 3 left
        let count_after = storage.count_snapshots().await.unwrap();
        assert_eq!(count_after, 3);
    }

    #[tokio::test]
    async fn test_storage_stats() {
        let temp_dir = TempDir::new().unwrap();
        let storage = MetricsStorage::new(temp_dir.path(), Some(30)).unwrap();

        let now = Utc::now();
        for i in 0..5 {
            let ts = now - Duration::hours(i);
            storage.save_snapshot(&create_test_snapshot(ts)).await.unwrap();
        }

        let stats = storage.get_stats().await.unwrap();
        assert_eq!(stats.snapshot_count, 5);
        assert_eq!(stats.retention_days, 30);
        assert_eq!(stats.aggregation_retention_days, 90);
        assert!(stats.oldest_snapshot.is_some());
        assert!(stats.newest_snapshot.is_some());
    }

    #[tokio::test]
    async fn test_get_time_range() {
        let temp_dir = TempDir::new().unwrap();
        let storage = MetricsStorage::new(temp_dir.path(), Some(30)).unwrap();

        let now = Utc::now();
        let oldest = now - Duration::hours(10);
        let newest = now;

        // Create snapshots
        storage.save_snapshot(&create_test_snapshot(oldest)).await.unwrap();
        storage.save_snapshot(&create_test_snapshot(now - Duration::hours(5))).await.unwrap();
        storage.save_snapshot(&create_test_snapshot(newest)).await.unwrap();

        let (first, last) = storage.get_time_range().await.unwrap().unwrap();

        // Allow small timing differences (within 1 second)
        assert!((first.timestamp() - oldest.timestamp()).abs() < 1);
        assert!((last.timestamp() - newest.timestamp()).abs() < 1);
    }

    #[tokio::test]
    async fn test_count_snapshots() {
        let temp_dir = TempDir::new().unwrap();
        let storage = MetricsStorage::new(temp_dir.path(), Some(30)).unwrap();

        assert_eq!(storage.count_snapshots().await.unwrap(), 0);

        for i in 0..10 {
            let ts = Utc::now() - Duration::hours(i);
            storage.save_snapshot(&create_test_snapshot(ts)).await.unwrap();
        }

        assert_eq!(storage.count_snapshots().await.unwrap(), 10);
    }
}
