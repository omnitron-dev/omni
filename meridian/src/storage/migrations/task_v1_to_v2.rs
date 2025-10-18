// Migration: Task v1 to v2 - adds depends_on and related_tasks fields

use crate::progress::types::{Task, TaskId};
use crate::storage::migration::{Migration, SchemaVersion};
use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Task structure as it existed in v1 (before depends_on field)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TaskV1 {
    pub id: TaskId,
    pub title: String,
    pub description: Option<String>,
    pub status: crate::progress::types::TaskStatus,
    pub priority: crate::progress::types::Priority,
    pub spec_ref: Option<crate::progress::types::SpecReference>,
    pub session_id: Option<String>,
    pub active_session_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub history: Vec<crate::progress::types::StatusTransition>,
    pub tags: Vec<String>,
    pub estimated_hours: Option<f32>,
    pub actual_hours: Option<f32>,
    pub commit_hash: Option<String>,
    pub episode_id: Option<String>,
}

/// Migration from Task v1 to v2
pub struct TaskV1ToV2Migration;

#[async_trait]
impl Migration for TaskV1ToV2Migration {
    fn from_version(&self) -> SchemaVersion {
        SchemaVersion::V1
    }

    fn to_version(&self) -> SchemaVersion {
        SchemaVersion::V2
    }

    fn name(&self) -> &str {
        "Task v1 → v2: Add depends_on and related_tasks fields"
    }

    fn key_prefix(&self) -> &[u8] {
        b"task:"
    }

    async fn migrate_item(&self, _key: &[u8], value: &[u8]) -> Result<Vec<u8>> {
        // Deserialize as v1
        let task_v1: TaskV1 = serde_json::from_slice(value)
            .context("Failed to deserialize Task v1")?;

        // Convert to v2 (current Task struct with new fields)
        let task_v2 = Task {
            schema_version: 2,
            id: task_v1.id,
            title: task_v1.title,
            description: task_v1.description,
            status: task_v1.status,
            priority: task_v1.priority,
            spec_ref: task_v1.spec_ref,
            session_id: task_v1.session_id,
            active_session_id: task_v1.active_session_id,
            created_at: task_v1.created_at,
            updated_at: task_v1.updated_at,
            completed_at: task_v1.completed_at,
            history: task_v1.history,
            tags: task_v1.tags,
            estimated_hours: task_v1.estimated_hours,
            actual_hours: task_v1.actual_hours,
            // New fields in v2 - initialize as empty
            depends_on: Vec::new(),
            related_tasks: Vec::new(),
            commit_hash: task_v1.commit_hash,
            episode_id: task_v1.episode_id,
        };

        // Serialize as v2
        let serialized = serde_json::to_vec(&task_v2)
            .context("Failed to serialize Task v2")?;

        tracing::debug!(
            "Migrated task: {} ({})",
            task_v2.id,
            task_v2.title
        );

        Ok(serialized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::types::{Priority, TaskStatus};
    use chrono::Utc;

    #[tokio::test]
    async fn test_task_v1_to_v2_migration() {
        let migration = TaskV1ToV2Migration;

        // Create a v1 task
        let task_v1 = TaskV1 {
            id: TaskId::from_str("test-task-1"),
            title: "Test Task".to_string(),
            description: Some("Test description".to_string()),
            status: TaskStatus::Pending,
            priority: Priority::High,
            spec_ref: None,
            session_id: None,
            active_session_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            completed_at: None,
            history: Vec::new(),
            tags: vec!["test".to_string()],
            estimated_hours: Some(2.0),
            actual_hours: None,
            commit_hash: None,
            episode_id: None,
        };

        // Serialize v1
        let v1_bytes = serde_json::to_vec(&task_v1).unwrap();

        // Migrate
        let v2_bytes = migration
            .migrate_item(b"task:test-task-1", &v1_bytes)
            .await
            .unwrap();

        // Deserialize as v2
        let task_v2: Task = serde_json::from_slice(&v2_bytes).unwrap();

        // Verify fields
        assert_eq!(task_v2.id.0, "test-task-1");
        assert_eq!(task_v2.title, "Test Task");
        assert_eq!(task_v2.status, TaskStatus::Pending);
        assert_eq!(task_v2.priority, Priority::High);

        // Verify new fields are initialized as empty
        assert_eq!(task_v2.depends_on.len(), 0);
        assert_eq!(task_v2.related_tasks.len(), 0);
    }
}
