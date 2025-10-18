use super::types::MetricsSnapshot;
use anyhow::{Context, Result};
use chrono::{DateTime, Duration, Utc};
use rocksdb::{IteratorMode, Options, DB};
use std::path::Path;
use std::sync::Arc;

/// RocksDB key format for metrics snapshots
///
/// Key format: "metrics:{timestamp_millis}"
/// This allows efficient time-range queries and automatic ordering
fn make_snapshot_key(timestamp: &DateTime<Utc>) -> String {
    format!("metrics:{}", timestamp.timestamp_millis())
}

/// Parse timestamp from snapshot key
fn parse_timestamp_from_key(key: &str) -> Result<DateTime<Utc>> {
    let parts: Vec<&str> = key.split(':').collect();
    if parts.len() != 2 || parts[0] != "metrics" {
        anyhow::bail!("Invalid metrics key format: {}", key);
    }

    let millis: i64 = parts[1].parse()?;
    Ok(DateTime::from_timestamp_millis(millis)
        .ok_or_else(|| anyhow::anyhow!("Invalid timestamp: {}", millis))?)
}

/// Metrics storage using RocksDB
///
/// Storage schema:
/// - Key: "metrics:{timestamp_millis}"
/// - Value: bincode-serialized MetricsSnapshot
///
/// Retention policy:
/// - Automatically deletes snapshots older than retention period
/// - Default retention: 30 days
#[derive(Clone)]
pub struct MetricsStorage {
    db: Arc<DB>,
    retention_days: u32,
}

impl MetricsStorage {
    /// Create a new metrics storage
    ///
    /// # Arguments
    /// * `path` - Path to RocksDB directory
    /// * `retention_days` - Number of days to retain metrics (default: 30)
    pub fn new(path: &Path, retention_days: Option<u32>) -> Result<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);

        // Optimize for time-series data
        opts.set_compaction_style(rocksdb::DBCompactionStyle::Level);
        opts.set_max_background_jobs(4);

        let db = DB::open(&opts, path)
            .with_context(|| format!("Failed to open metrics DB at {:?}", path))?;

        Ok(Self {
            db: Arc::new(db),
            retention_days: retention_days.unwrap_or(30),
        })
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
    pub async fn cleanup_old(&self, custom_retention_days: Option<u32>) -> Result<u64> {
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

                // Check if this is a metrics key
                if !key.starts_with(b"metrics:") {
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

    /// Get the total number of snapshots stored
    pub async fn count_snapshots(&self) -> Result<u64> {
        let db = Arc::clone(&self.db);

        tokio::task::spawn_blocking(move || {
            let mut count = 0u64;
            let iter = db.iterator(IteratorMode::Start);

            for item in iter {
                let (key, _) = item.context("Failed to iterate metrics DB")?;
                if key.starts_with(b"metrics:") {
                    count += 1;
                }
            }

            Ok(count)
        })
        .await?
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
                if !key.starts_with(b"metrics:") {
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
                if key.starts_with(b"metrics:") {
                    keys_to_delete.push(key.to_vec());
                }
            }

            for key in keys_to_delete {
                db.delete(&key).context("Failed to delete snapshot")?;
            }

            Ok(())
        })
        .await?
    }
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
        let deleted = storage.cleanup_old(Some(7)).await.unwrap();
        assert_eq!(deleted, 5);

        // Should have 3 left
        let count_after = storage.count_snapshots().await.unwrap();
        assert_eq!(count_after, 3);
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
