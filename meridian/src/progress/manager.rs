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
        use std::collections::HashMap;
        use super::types::{SpecProgress, PriorityProgress};

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

        // Group by spec
        let mut spec_map: HashMap<String, (usize, usize)> = HashMap::new();
        for task in &tasks {
            if let Some(ref spec_ref) = task.spec_ref {
                let entry = spec_map.entry(spec_ref.spec_name.clone()).or_insert((0, 0));
                entry.0 += 1; // total
                if task.status == TaskStatus::Done {
                    entry.1 += 1; // done
                }
            }
        }

        let by_spec: Vec<SpecProgress> = spec_map
            .into_iter()
            .map(|(spec_name, (total, done))| {
                let percentage = if total > 0 {
                    (done as f32 / total as f32) * 100.0
                } else {
                    0.0
                };
                SpecProgress {
                    spec_name,
                    total,
                    done,
                    percentage,
                }
            })
            .collect();

        // Group by priority
        let mut priority_map: HashMap<Priority, (usize, usize)> = HashMap::new();
        for task in &tasks {
            let entry = priority_map.entry(task.priority).or_insert((0, 0));
            entry.0 += 1; // total
            if task.status == TaskStatus::Done {
                entry.1 += 1; // done
            }
        }

        let by_priority: Vec<PriorityProgress> = priority_map
            .into_iter()
            .map(|(priority, (total, done))| PriorityProgress {
                priority,
                total,
                done,
            })
            .collect();

        Ok(ProgressStats {
            total_tasks: total,
            pending,
            in_progress,
            blocked,
            done,
            cancelled,
            completion_percentage,
            by_spec,
            by_priority,
        })
    }

    /// Mark task as complete with memory integration (auto-episode recording)
    pub async fn mark_complete(
        &self,
        task_id: &TaskId,
        actual_hours: Option<f32>,
        commit_hash: Option<String>,
        solution_summary: Option<String>,
        files_touched: Vec<String>,
        queries_made: Vec<String>,
        memory_system: Arc<tokio::sync::RwLock<crate::memory::MemorySystem>>,
    ) -> Result<Option<String>> {
        use crate::types::{EpisodeId, Outcome, TaskEpisode, TokenCount, ContextSnapshot};

        // 1. Load task
        let mut task = self.get_task(task_id).await?;

        // 2. Update to Done status
        task.update_status(TaskStatus::Done, Some("Task completed".to_string()))
            .map_err(|e| anyhow!(e))?;
        task.actual_hours = actual_hours;
        task.commit_hash = commit_hash.clone();
        task.updated_at = chrono::Utc::now();

        // 3. Build episode data
        let episode = TaskEpisode {
            id: EpisodeId::new(),
            timestamp: chrono::Utc::now(),
            task_description: format!("{}: {}", task.title, task.description.clone().unwrap_or_default()),
            initial_context: ContextSnapshot::default(),
            queries_made,
            files_touched,
            solution_path: solution_summary.unwrap_or_else(|| task.title.clone()),
            outcome: Outcome::Success,
            tokens_used: TokenCount::zero(),
            access_count: 0,
            pattern_value: 0.0,
        };

        let episode_id = episode.id.0.clone();

        // 4. Record episode in memory system
        let mut mem_system = memory_system.write().await;
        mem_system.episodic.record_episode(episode).await?;
        drop(mem_system);

        tracing::info!("Recorded episode {} for task {}", episode_id, task_id);

        // 5. Store episode_id in task
        task.episode_id = Some(episode_id.clone());

        // 6. Save task
        self.storage.save_task(&task).await?;

        // Update status index
        self.storage.update_status_index(task_id, TaskStatus::InProgress, TaskStatus::Done).await?;

        // Update cache
        self.cache.write().await.put(task_id.clone(), task);

        tracing::info!("Marked task {} as complete with episode {}", task_id, episode_id);

        // 7. Return episode_id
        Ok(Some(episode_id))
    }

    /// Search tasks by title or description (full-text search)
    pub async fn search_tasks(&self, query: &str, limit: Option<usize>) -> Result<Vec<TaskSummary>> {
        let all_tasks = self.storage.list_all().await?;

        let query_lower = query.to_lowercase();
        let mut matching_tasks: Vec<Task> = all_tasks
            .into_iter()
            .filter(|t| {
                t.title.to_lowercase().contains(&query_lower)
                    || t.description
                        .as_ref()
                        .map(|d| d.to_lowercase().contains(&query_lower))
                        .unwrap_or(false)
                    || t.id.to_string().to_lowercase().contains(&query_lower)
            })
            .collect();

        // Sort by relevance (title matches first, then updated_at)
        matching_tasks.sort_by(|a, b| {
            let a_title_match = a.title.to_lowercase().contains(&query_lower);
            let b_title_match = b.title.to_lowercase().contains(&query_lower);

            match (a_title_match, b_title_match) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => b.updated_at.cmp(&a.updated_at),
            }
        });

        // Apply limit
        if let Some(limit) = limit {
            matching_tasks.truncate(limit);
        }

        tracing::info!("Found {} tasks matching query: {}", matching_tasks.len(), query);

        Ok(matching_tasks.iter().map(TaskSummary::from).collect())
    }

    /// Link task to a specification section with validation
    pub async fn link_to_spec(
        &self,
        task_id: &TaskId,
        spec_name: String,
        section: String,
        validate: bool,
        spec_manager: Arc<tokio::sync::RwLock<crate::specs::SpecificationManager>>,
    ) -> Result<()> {
        // 1. Load task
        let mut task = self.get_task(task_id).await?;

        // 2. Validate spec and section if requested
        if validate {
            let mut spec_mgr = spec_manager.write().await;

            // Check if spec exists
            spec_mgr.get_spec(&spec_name)
                .map_err(|e| anyhow!("Spec '{}' not found: {}", spec_name, e))?;

            // Check if section exists
            let sections = spec_mgr.list_sections(&spec_name)?;
            let section_exists = sections.iter().any(|s| {
                s.to_lowercase().contains(&section.to_lowercase())
                    || section.to_lowercase().contains(&s.to_lowercase())
            });

            if !section_exists {
                return Err(anyhow!(
                    "Section '{}' not found in spec '{}'. Available sections: {}",
                    section,
                    spec_name,
                    sections.join(", ")
                ));
            }

            tracing::info!("Validated spec reference: {} - {}", spec_name, section);
        }

        // 3. Set task.spec_ref
        task.spec_ref = Some(SpecReference {
            spec_name: spec_name.clone(),
            section: section.clone(),
        });
        task.updated_at = chrono::Utc::now();

        // 4. Save task
        self.storage.save_task(&task).await?;

        // Update cache
        self.cache.write().await.put(task_id.clone(), task);

        tracing::info!("Linked task {} to spec {} - {}", task_id, spec_name, section);

        Ok(())
    }

    /// Get status transition history for a task
    pub async fn get_history(&self, task_id: &TaskId) -> Result<Vec<crate::progress::types::StatusTransition>> {
        let task = self.get_task(task_id).await?;
        Ok(task.history)
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
    async fn test_get_progress_with_spec_grouping() {
        use crate::progress::SpecReference;

        let (manager, _temp_dir) = create_test_manager().await;

        // Create tasks for different specs
        let spec1_ref = Some(SpecReference {
            spec_name: "spec1".to_string(),
            section: "Phase 1".to_string(),
        });
        let spec2_ref = Some(SpecReference {
            spec_name: "spec2".to_string(),
            section: "Phase 1".to_string(),
        });

        // Spec1: 3 tasks (2 done)
        for i in 0..3 {
            let id = manager.create_task(format!("Spec1 Task {}", i), None, None, spec1_ref.clone(), vec![], None).await.unwrap();
            if i < 2 {
                manager.update_task(&id, None, None, None, Some(TaskStatus::Done), None, None, None, None, None).await.unwrap();
            }
        }

        // Spec2: 2 tasks (1 done)
        for i in 0..2 {
            let id = manager.create_task(format!("Spec2 Task {}", i), None, None, spec2_ref.clone(), vec![], None).await.unwrap();
            if i == 0 {
                manager.update_task(&id, None, None, None, Some(TaskStatus::Done), None, None, None, None, None).await.unwrap();
            }
        }

        let stats = manager.get_progress(None).await.unwrap();
        assert_eq!(stats.total_tasks, 5);
        assert_eq!(stats.by_spec.len(), 2);

        // Find spec1 stats
        let spec1_stats = stats.by_spec.iter().find(|s| s.spec_name == "spec1").unwrap();
        assert_eq!(spec1_stats.total, 3);
        assert_eq!(spec1_stats.done, 2);
        assert!((spec1_stats.percentage - 66.666).abs() < 0.1);

        // Find spec2 stats
        let spec2_stats = stats.by_spec.iter().find(|s| s.spec_name == "spec2").unwrap();
        assert_eq!(spec2_stats.total, 2);
        assert_eq!(spec2_stats.done, 1);
        assert_eq!(spec2_stats.percentage, 50.0);
    }

    #[tokio::test]
    async fn test_get_progress_with_priority_grouping() {
        let (manager, _temp_dir) = create_test_manager().await;

        // Create tasks with different priorities
        for i in 0..6 {
            let priority = match i % 3 {
                0 => Priority::High,
                1 => Priority::Medium,
                _ => Priority::Low,
            };
            let id = manager.create_task(format!("Task {}", i), None, Some(priority), None, vec![], None).await.unwrap();
            if i < 3 {
                manager.update_task(&id, None, None, None, Some(TaskStatus::Done), None, None, None, None, None).await.unwrap();
            }
        }

        let stats = manager.get_progress(None).await.unwrap();
        assert_eq!(stats.total_tasks, 6);
        assert_eq!(stats.by_priority.len(), 3);

        // Check that all priorities are represented
        let high_count = stats.by_priority.iter().filter(|p| p.priority == Priority::High).count();
        let medium_count = stats.by_priority.iter().filter(|p| p.priority == Priority::Medium).count();
        let low_count = stats.by_priority.iter().filter(|p| p.priority == Priority::Low).count();

        assert_eq!(high_count, 1);
        assert_eq!(medium_count, 1);
        assert_eq!(low_count, 1);
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

    #[tokio::test]
    async fn test_search_tasks() {
        let (manager, _temp_dir) = create_test_manager().await;

        // Create tasks with different titles and descriptions
        manager.create_task(
            "Implement search feature".to_string(),
            Some("Add full-text search to the API".to_string()),
            None,
            None,
            vec![],
            None,
        ).await.unwrap();

        manager.create_task(
            "Fix bug in search".to_string(),
            Some("The search is returning wrong results".to_string()),
            None,
            None,
            vec![],
            None,
        ).await.unwrap();

        manager.create_task(
            "Add pagination".to_string(),
            Some("Implement pagination for lists".to_string()),
            None,
            None,
            vec![],
            None,
        ).await.unwrap();

        // Search by title
        let results = manager.search_tasks("search", None).await.unwrap();
        assert_eq!(results.len(), 2);

        // Search by description
        let results = manager.search_tasks("pagination", None).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Add pagination");

        // Search with limit
        let results = manager.search_tasks("search", Some(1)).await.unwrap();
        assert_eq!(results.len(), 1);
    }

    #[tokio::test]
    async fn test_get_history() {
        let (manager, _temp_dir) = create_test_manager().await;

        let task_id = manager.create_task("Test task".to_string(), None, None, None, vec![], None).await.unwrap();

        // Update status a few times
        manager.update_task(&task_id, None, None, None, Some(TaskStatus::InProgress), Some("Starting".to_string()), None, None, None, None).await.unwrap();
        manager.update_task(&task_id, None, None, None, Some(TaskStatus::Blocked), Some("Waiting for review".to_string()), None, None, None, None).await.unwrap();
        manager.update_task(&task_id, None, None, None, Some(TaskStatus::InProgress), Some("Resuming".to_string()), None, None, None, None).await.unwrap();

        let history = manager.get_history(&task_id).await.unwrap();
        assert_eq!(history.len(), 4); // Created + 3 updates
        assert_eq!(history[0].to, TaskStatus::Pending);
        assert_eq!(history[1].to, TaskStatus::InProgress);
        assert_eq!(history[2].to, TaskStatus::Blocked);
        assert_eq!(history[3].to, TaskStatus::InProgress);
    }

    #[tokio::test]
    async fn test_mark_complete_with_memory() {
        use crate::config::MemoryConfig;
        use crate::memory::MemorySystem;
        use crate::storage::rocksdb_storage::RocksDBStorage;

        let temp_dir = TempDir::new().unwrap();
        let db = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

        // Create memory system
        let memory_config = MemoryConfig {
            working_memory_size: "10MB".to_string(),
            episodic_retention_days: 90,
            consolidation_interval: "1h".to_string(),
        };
        let mut memory_system = MemorySystem::new(db.clone(), memory_config).unwrap();
        memory_system.init().await.unwrap();
        let memory_system = Arc::new(tokio::sync::RwLock::new(memory_system));

        // Create progress manager
        let storage = Arc::new(ProgressStorage::new(db));
        let manager = ProgressManager::new(storage);

        // Create and complete a task
        let task_id = manager.create_task(
            "Implement feature X".to_string(),
            Some("Add feature X to the system".to_string()),
            None,
            None,
            vec![],
            None,
        ).await.unwrap();

        // Mark as in progress first
        manager.update_task(&task_id, None, None, None, Some(TaskStatus::InProgress), None, None, None, None, None).await.unwrap();

        // Mark complete with episode data
        let episode_id = manager.mark_complete(
            &task_id,
            Some(2.5),
            Some("abc123".to_string()),
            Some("Implemented feature X using approach Y".to_string()),
            vec!["src/feature.rs".to_string(), "src/tests.rs".to_string()],
            vec!["code.search feature".to_string(), "code.get_definition FeatureX".to_string()],
            memory_system.clone(),
        ).await.unwrap();

        // Verify task is marked as done
        let task = manager.get_task(&task_id).await.unwrap();
        assert_eq!(task.status, TaskStatus::Done);
        assert_eq!(task.actual_hours, Some(2.5));
        assert_eq!(task.commit_hash, Some("abc123".to_string()));
        assert!(task.completed_at.is_some());
        assert!(task.episode_id.is_some());
        assert_eq!(task.episode_id, episode_id);

        // Verify episode was recorded in memory system
        let mem = memory_system.read().await;
        let similar = mem.episodic.find_similar("feature X", 5).await;
        assert_eq!(similar.len(), 1);
        assert_eq!(similar[0].id.0, episode_id.unwrap());
    }
}
