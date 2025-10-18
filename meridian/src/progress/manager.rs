// Progress Manager - high-level task management operations

use super::storage::ProgressStorage;
use super::types::{Priority, ProgressStats, SpecReference, Task, TaskId, TaskStatus, TaskSummary};
use anyhow::{anyhow, Result};
use lru::LruCache;
use std::num::NonZeroUsize;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Progress Manager - manages tasks with caching and filtering
pub struct ProgressManager {
    storage: Arc<ProgressStorage>,
    cache: Arc<RwLock<LruCache<TaskId, Task>>>,
}

impl ProgressManager {
    /// Create a new ProgressManager
    pub fn new(storage: Arc<ProgressStorage>) -> Self {
        let cache_size = NonZeroUsize::new(100).unwrap();
        Self {
            storage,
            cache: Arc::new(RwLock::new(LruCache::new(cache_size))),
        }
    }

    /// Create a new task
    pub async fn create_task(
        &self,
        title: String,
        description: Option<String>,
        priority: Option<Priority>,
        spec_ref: Option<SpecReference>,
        tags: Vec<String>,
        estimated_hours: Option<f32>,
    ) -> Result<TaskId> {
        let mut task = Task::new(title);

        task.description = description;
        task.priority = priority.unwrap_or(Priority::Medium);
        task.spec_ref = spec_ref;
        task.tags = tags;
        task.estimated_hours = estimated_hours;

        // Save to storage
        self.storage.save_task(&task).await?;

        // Cache the task
        self.cache.write().await.put(task.id.clone(), task.clone());

        Ok(task.id)
    }

    /// Get a task by ID
    pub async fn get_task(&self, task_id: &TaskId) -> Result<Task> {
        // Check cache first
        {
            let mut cache = self.cache.write().await;
            if let Some(task) = cache.get(task_id) {
                return Ok(task.clone());
            }
        }

        // Load from storage
        let task = self.storage.load_task(task_id).await?
            .ok_or_else(|| anyhow!("Task not found: {}", task_id))?;

        // Cache for next time
        self.cache.write().await.put(task_id.clone(), task.clone());

        Ok(task)
    }

    /// Update a task
    pub async fn update_task(
        &self,
        task_id: &TaskId,
        title: Option<String>,
        description: Option<String>,
        priority: Option<Priority>,
        status: Option<TaskStatus>,
        status_note: Option<String>,
        tags: Option<Vec<String>>,
        estimated_hours: Option<f32>,
        actual_hours: Option<f32>,
        commit_hash: Option<String>,
    ) -> Result<()> {
        let mut task = self.get_task(task_id).await?;
        let old_status = task.status;

        // Update fields
        if let Some(t) = title {
            task.title = t;
        }
        if let Some(d) = description {
            task.description = Some(d);
        }
        if let Some(p) = priority {
            task.priority = p;
        }
        if let Some(s) = status {
            task.update_status(s, status_note)
                .map_err(|e| anyhow!(e))?;
        }
        if let Some(t) = tags {
            task.tags = t;
        }
        if let Some(e) = estimated_hours {
            task.estimated_hours = Some(e);
        }
        if let Some(a) = actual_hours {
            task.actual_hours = Some(a);
        }
        if let Some(c) = commit_hash {
            task.commit_hash = Some(c);
        }

        task.updated_at = chrono::Utc::now();

        // Save to storage
        self.storage.save_task(&task).await?;

        // Update status index if status changed
        if let Some(new_status) = status {
            if new_status != old_status {
                self.storage.update_status_index(task_id, old_status, new_status).await?;
            }
        }

        // Update cache
        self.cache.write().await.put(task_id.clone(), task);

        Ok(())
    }

    /// Delete a task
    pub async fn delete_task(&self, task_id: &TaskId) -> Result<()> {
        // Remove from storage
        self.storage.delete_task(task_id).await?;

        // Remove from cache
        self.cache.write().await.pop(task_id);

        Ok(())
    }

    /// List tasks with optional filters
    pub async fn list_tasks(
        &self,
        status: Option<TaskStatus>,
        spec_name: Option<String>,
        limit: Option<usize>,
    ) -> Result<Vec<TaskSummary>> {
        let mut tasks = if let Some(s) = status {
            self.storage.list_by_status(s).await?
        } else if let Some(spec) = spec_name {
            self.storage.list_by_spec(&spec).await?
        } else {
            self.storage.list_all().await?
        };

        // Sort by updated_at (most recent first)
        tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        // Apply limit
        if let Some(limit) = limit {
            tasks.truncate(limit);
        }

        // Convert to summaries (token efficiency)
        Ok(tasks.iter().map(TaskSummary::from).collect())
    }

    /// Get progress statistics
    pub async fn get_progress(&self, spec_name: Option<String>) -> Result<ProgressStats> {
        let tasks = if let Some(spec) = spec_name {
            self.storage.list_by_spec(&spec).await?
        } else {
            self.storage.list_all().await?
        };

        let total = tasks.len();
        let pending = tasks.iter().filter(|t| t.status == TaskStatus::Pending).count();
        let in_progress = tasks.iter().filter(|t| t.status == TaskStatus::InProgress).count();
        let blocked = tasks.iter().filter(|t| t.status == TaskStatus::Blocked).count();
        let done = tasks.iter().filter(|t| t.status == TaskStatus::Done).count();
        let cancelled = tasks.iter().filter(|t| t.status == TaskStatus::Cancelled).count();

        let completion_percentage = if total > 0 {
            (done as f32 / total as f32) * 100.0
        } else {
            0.0
        };

        Ok(ProgressStats {
            total_tasks: total,
            pending,
            in_progress,
            blocked,
            done,
            cancelled,
            completion_percentage,
            by_spec: Vec::new(), // TODO: Implement in Phase 3
            by_priority: Vec::new(), // TODO: Implement in Phase 3
        })
    }

    /// Clear cache (useful for testing)
    pub async fn clear_cache(&self) {
        self.cache.write().await.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::rocksdb_storage::RocksDBStorage;
    use tempfile::TempDir;

    async fn create_test_manager() -> (ProgressManager, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db = RocksDBStorage::new(temp_dir.path()).unwrap();
        let storage = Arc::new(ProgressStorage::new(Arc::new(db)));
        let manager = ProgressManager::new(storage);
        (manager, temp_dir)
    }

    #[tokio::test]
    async fn test_create_and_get_task() {
        let (manager, _temp_dir) = create_test_manager().await;

        let task_id = manager.create_task(
            "Test task".to_string(),
            Some("Description".to_string()),
            Some(Priority::High),
            None,
            vec!["test".to_string()],
            Some(2.0),
        ).await.unwrap();

        let task = manager.get_task(&task_id).await.unwrap();
        assert_eq!(task.title, "Test task");
        assert_eq!(task.priority, Priority::High);
        assert_eq!(task.tags, vec!["test"]);
    }

    #[tokio::test]
    async fn test_update_task_status() {
        let (manager, _temp_dir) = create_test_manager().await;

        let task_id = manager.create_task(
            "Test".to_string(),
            None,
            None,
            None,
            vec![],
            None,
        ).await.unwrap();

        // Update status
        manager.update_task(
            &task_id,
            None,
            None,
            None,
            Some(TaskStatus::InProgress),
            Some("Starting work".to_string()),
            None,
            None,
            None,
            None,
        ).await.unwrap();

        let task = manager.get_task(&task_id).await.unwrap();
        assert_eq!(task.status, TaskStatus::InProgress);
        assert_eq!(task.history.len(), 2); // Created + Updated
    }

    #[tokio::test]
    async fn test_list_tasks_by_status() {
        let (manager, _temp_dir) = create_test_manager().await;

        // Create tasks
        let id1 = manager.create_task("Task 1".to_string(), None, None, None, vec![], None).await.unwrap();
        let id2 = manager.create_task("Task 2".to_string(), None, None, None, vec![], None).await.unwrap();

        // Update one to InProgress
        manager.update_task(&id1, None, None, None, Some(TaskStatus::InProgress), None, None, None, None, None).await.unwrap();

        // List in-progress
        let in_progress = manager.list_tasks(Some(TaskStatus::InProgress), None, None).await.unwrap();
        assert_eq!(in_progress.len(), 1);
        assert_eq!(in_progress[0].id, id1);

        // List pending
        let pending = manager.list_tasks(Some(TaskStatus::Pending), None, None).await.unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, id2);
    }

    #[tokio::test]
    async fn test_get_progress() {
        let (manager, _temp_dir) = create_test_manager().await;

        // Create 5 tasks
        for i in 0..5 {
            let id = manager.create_task(format!("Task {}", i), None, None, None, vec![], None).await.unwrap();
            if i < 2 {
                // Mark first 2 as done
                manager.update_task(&id, None, None, None, Some(TaskStatus::Done), None, None, None, None, None).await.unwrap();
            }
        }

        let stats = manager.get_progress(None).await.unwrap();
        assert_eq!(stats.total_tasks, 5);
        assert_eq!(stats.done, 2);
        assert_eq!(stats.pending, 3);
        assert_eq!(stats.completion_percentage, 40.0);
    }

    #[tokio::test]
    async fn test_cache() {
        let (manager, _temp_dir) = create_test_manager().await;

        let task_id = manager.create_task("Cached".to_string(), None, None, None, vec![], None).await.unwrap();

        // First get (from storage)
        let _task1 = manager.get_task(&task_id).await.unwrap();

        // Clear storage to test cache
        manager.clear_cache().await;

        // Second get (should still work from cache before clear)
        let task_id2 = manager.create_task("Test2".to_string(), None, None, None, vec![], None).await.unwrap();
        let _task2 = manager.get_task(&task_id2).await.unwrap();
    }
}
