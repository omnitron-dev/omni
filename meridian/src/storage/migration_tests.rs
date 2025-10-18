// Integration tests for migration system

#[cfg(test)]
mod tests {
    use crate::progress::types::Task;
    use crate::storage::migration::{MigrationManager, SchemaVersion};
    use crate::storage::migrations::register_all_migrations;
    use crate::storage::rocksdb_storage::RocksDBStorage;
    use crate::storage::Storage;
    use std::sync::Arc;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_full_migration_workflow() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap()) as Arc<dyn Storage>;

        // Set initial version to v1
        let manager = MigrationManager::new(storage.clone());
        manager.set_current_version(SchemaVersion::V1).await.unwrap();

        // Create some v1 tasks (without schema_version field explicitly)
        let task1_key = b"task:test-1";
        let task1_data = r#"{
            "id": "test-1",
            "title": "Test Task 1",
            "description": "Test description",
            "status": "pending",
            "priority": "high",
            "spec_ref": null,
            "session_id": null,
            "active_session_id": null,
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "completed_at": null,
            "history": [],
            "tags": ["test"],
            "estimated_hours": 2.0,
            "actual_hours": null,
            "commit_hash": null,
            "episode_id": null
        }"#;

        storage.put(task1_key, task1_data.as_bytes()).await.unwrap();

        // Create migration manager and register migrations
        let mut manager = MigrationManager::new(storage.clone());
        register_all_migrations(&mut manager.registry);

        // Verify we need migration
        assert!(manager.needs_migration().await.unwrap());

        // Run migration
        let results = manager.migrate_to_current().await.unwrap();

        // Verify migration completed
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].from_version, SchemaVersion::V1);
        assert_eq!(results[0].to_version, SchemaVersion::V2);
        assert!(results[0].success);
        assert_eq!(results[0].items_migrated, 1);

        // Verify migrated task has new fields
        let migrated_bytes = storage.get(task1_key).await.unwrap().unwrap();
        let migrated_task: Task = serde_json::from_slice(&migrated_bytes).unwrap();

        assert_eq!(migrated_task.id.0, "test-1");
        assert_eq!(migrated_task.title, "Test Task 1");
        assert_eq!(migrated_task.depends_on.len(), 0);
        assert_eq!(migrated_task.related_tasks.len(), 0);

        // Verify schema version is updated
        let current_version = manager.get_current_version().await.unwrap();
        assert_eq!(current_version, SchemaVersion::V2);

        // Verify no more migrations needed
        assert!(!manager.needs_migration().await.unwrap());
    }

    #[tokio::test]
    async fn test_migration_with_multiple_tasks() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap()) as Arc<dyn Storage>;

        // Set to v1
        let manager = MigrationManager::new(storage.clone());
        manager.set_current_version(SchemaVersion::V1).await.unwrap();

        // Create 10 v1 tasks
        for i in 1..=10 {
            let key = format!("task:test-{}", i);
            let data = format!(
                r#"{{
                    "id": "test-{}",
                    "title": "Task {}",
                    "description": null,
                    "status": "pending",
                    "priority": "medium",
                    "spec_ref": null,
                    "session_id": null,
                    "active_session_id": null,
                    "created_at": "2024-01-01T00:00:00Z",
                    "updated_at": "2024-01-01T00:00:00Z",
                    "completed_at": null,
                    "history": [],
                    "tags": [],
                    "estimated_hours": null,
                    "actual_hours": null,
                    "commit_hash": null,
                    "episode_id": null
                }}"#,
                i, i
            );
            storage.put(key.as_bytes(), data.as_bytes()).await.unwrap();
        }

        // Run migration
        let mut manager = MigrationManager::new(storage.clone());
        register_all_migrations(&mut manager.registry);

        let results = manager.migrate_to_current().await.unwrap();

        // Verify all tasks migrated
        assert_eq!(results[0].items_migrated, 10);

        // Verify all tasks have new fields
        for i in 1..=10 {
            let key = format!("task:test-{}", i);
            let bytes = storage.get(key.as_bytes()).await.unwrap().unwrap();
            let task: Task = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(task.depends_on.len(), 0);
            assert_eq!(task.related_tasks.len(), 0);
        }
    }

    #[tokio::test]
    async fn test_migration_backup_and_rollback() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap()) as Arc<dyn Storage>;

        // Set to v1
        let manager = MigrationManager::new(storage.clone());
        manager.set_current_version(SchemaVersion::V1).await.unwrap();

        // Create a task
        let task_key = b"task:rollback-test";
        let original_data = r#"{
            "id": "rollback-test",
            "title": "Rollback Test",
            "description": null,
            "status": "pending",
            "priority": "low",
            "spec_ref": null,
            "session_id": null,
            "active_session_id": null,
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "completed_at": null,
            "history": [],
            "tags": [],
            "estimated_hours": null,
            "actual_hours": null,
            "commit_hash": null,
            "episode_id": null
        }"#;

        storage.put(task_key, original_data.as_bytes()).await.unwrap();

        // Create backup
        let backup_key = manager.create_backup(b"task:").await.unwrap();
        assert!(!backup_key.is_empty());

        // Modify the task
        storage.put(task_key, b"modified").await.unwrap();

        // Rollback
        manager.rollback_to_backup(&backup_key).await.unwrap();

        // Verify data is restored
        let restored_bytes = storage.get(task_key).await.unwrap().unwrap();
        assert_eq!(restored_bytes, original_data.as_bytes());
    }

    #[tokio::test]
    async fn test_migration_history() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap()) as Arc<dyn Storage>;

        // Set to v1
        let manager = MigrationManager::new(storage.clone());
        manager.set_current_version(SchemaVersion::V1).await.unwrap();

        // Create a task
        let task_data = r#"{
            "id": "history-test",
            "title": "History Test",
            "description": null,
            "status": "pending",
            "priority": "medium",
            "spec_ref": null,
            "session_id": null,
            "active_session_id": null,
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "completed_at": null,
            "history": [],
            "tags": [],
            "estimated_hours": null,
            "actual_hours": null,
            "commit_hash": null,
            "episode_id": null
        }"#;

        storage.put(b"task:history-test", task_data.as_bytes()).await.unwrap();

        // Run migration
        let mut manager = MigrationManager::new(storage.clone());
        register_all_migrations(&mut manager.registry);

        manager.migrate_to_current().await.unwrap();

        // Check history
        let history = manager.get_migration_history().await.unwrap();
        assert_eq!(history.migrations.len(), 1);

        let migration = &history.migrations[0];
        assert_eq!(migration.from_version, SchemaVersion::V1);
        assert_eq!(migration.to_version, SchemaVersion::V2);
        assert!(migration.success);
        assert!(migration.backup_key.is_some());

        // Verify last successful migration
        let last = history.last_successful_migration().unwrap();
        assert_eq!(last.from_version, SchemaVersion::V1);
    }

    #[tokio::test]
    async fn test_no_migration_needed() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap()) as Arc<dyn Storage>;

        // Set to current version
        let manager = MigrationManager::new(storage.clone());
        manager
            .set_current_version(SchemaVersion::current())
            .await
            .unwrap();

        // Should not need migration
        assert!(!manager.needs_migration().await.unwrap());

        // Register migrations
        let mut manager = MigrationManager::new(storage.clone());
        register_all_migrations(&mut manager.registry);

        // Run migration (should be no-op)
        let results = manager.migrate_to_current().await.unwrap();
        assert_eq!(results.len(), 0);
    }

    #[tokio::test]
    async fn test_new_task_has_current_schema_version() {
        // Create a new task
        let task = Task::new("Test Task".to_string());

        // Should have current schema version
        assert_eq!(
            task.schema_version,
            crate::storage::CURRENT_SCHEMA_VERSION
        );
    }

    #[tokio::test]
    async fn test_backward_compatibility() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap()) as Arc<dyn Storage>;

        // Create a task WITHOUT schema_version field (simulating old data)
        let old_task_data = r#"{
            "id": "old-task",
            "title": "Old Task",
            "description": null,
            "status": "pending",
            "priority": "high",
            "spec_ref": null,
            "session_id": null,
            "active_session_id": null,
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "completed_at": null,
            "history": [],
            "tags": [],
            "estimated_hours": null,
            "actual_hours": null,
            "depends_on": [],
            "related_tasks": [],
            "commit_hash": null,
            "episode_id": null
        }"#;

        storage
            .put(b"task:old-task", old_task_data.as_bytes())
            .await
            .unwrap();

        // Should be able to deserialize (serde default kicks in)
        let bytes = storage.get(b"task:old-task").await.unwrap().unwrap();
        let task: Task = serde_json::from_slice(&bytes).unwrap();

        // Schema version should default to current version due to serde default
        assert_eq!(task.schema_version, crate::storage::CURRENT_SCHEMA_VERSION);
        assert_eq!(task.title, "Old Task");
    }
}
