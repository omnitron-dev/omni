mod common;

use common::{create_test_storage, fixtures::*};
use meridian::session::{SessionAction, SessionConfig, SessionManager};
use meridian::types::{Query, TokenCount};
use std::path::PathBuf;

#[tokio::test]
async fn test_session_manager_initialization() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage);

    assert_eq!(manager.list_sessions().await.len(), 0);
}

#[tokio::test]
async fn test_session_begin() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage);

    let session_id = manager
        .begin(
            "Implement feature X".to_string(),
            vec![PathBuf::from("src/")],
            Some("main".to_string()),
        )
        .await
        .unwrap();

    let session = manager.get_session(&session_id).await.unwrap();
    assert_eq!(session.task_description, "Implement feature X");
    assert_eq!(session.scope.len(), 1);
    assert_eq!(session.base_commit, Some("main".to_string()));
}

#[tokio::test]
async fn test_session_update_file() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage);

    let session_id = manager
        .begin("Update module".to_string(), vec![], None)
        .await
        .unwrap();

    let path = PathBuf::from("src/module.rs");
    let content = "fn new_function() {}".to_string();

    let status = manager
        .update(&session_id, path, content, false)
        .await
        .unwrap();

    assert_eq!(status.deltas_count, 1);
}

#[tokio::test]
async fn test_session_update_multiple_files() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage);

    let session_id = manager
        .begin("Multi-file update".to_string(), vec![], None)
        .await
        .unwrap();

    // Update multiple files
    manager
        .update(
            &session_id,
            PathBuf::from("file1.rs"),
            "content1".to_string(),
            false,
        )
        .await
        .unwrap();

    manager
        .update(
            &session_id,
            PathBuf::from("file2.rs"),
            "content2".to_string(),
            false,
        )
        .await
        .unwrap();

    let summary = manager.get_changes_summary(&session_id).await.unwrap();
    assert_eq!(summary.total_deltas, 2);
    assert_eq!(summary.files_modified, 2);
}

#[tokio::test]
async fn test_session_query() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage);

    let session_id = manager
        .begin("Query test".to_string(), vec![], None)
        .await
        .unwrap();

    let query = Query::new("test".to_string());
    let result = manager.query(&session_id, query, true).await.unwrap();

    assert_eq!(result.from_session, 0);
    assert_eq!(result.from_base, 0);
}

#[tokio::test]
async fn test_session_commit() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage.clone());

    let session_id = manager
        .begin("Commit test".to_string(), vec![], None)
        .await
        .unwrap();

    manager
        .update(
            &session_id,
            PathBuf::from("test.rs"),
            "fn test() {}".to_string(),
            false,
        )
        .await
        .unwrap();

    let result = manager
        .complete(&session_id, SessionAction::Commit)
        .await
        .unwrap();

    assert_eq!(result.changes_summary.total_deltas, 1);
    // Session should be removed after commit
    assert!(manager.get_session(&session_id).await.is_none());
}

#[tokio::test]
async fn test_session_discard() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage);

    let session_id = manager
        .begin("Discard test".to_string(), vec![], None)
        .await
        .unwrap();

    manager
        .update(
            &session_id,
            PathBuf::from("test.rs"),
            "fn test() {}".to_string(),
            false,
        )
        .await
        .unwrap();

    let result = manager
        .complete(&session_id, SessionAction::Discard)
        .await
        .unwrap();

    assert_eq!(result.changes_summary.total_deltas, 1);
    assert!(manager.get_session(&session_id).await.is_none());
}

#[tokio::test]
async fn test_session_stash() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage.clone());

    let session_id = manager
        .begin("Stash test".to_string(), vec![], None)
        .await
        .unwrap();

    manager
        .update(
            &session_id,
            PathBuf::from("test.rs"),
            "fn test() {}".to_string(),
            false,
        )
        .await
        .unwrap();

    let result = manager
        .complete(&session_id, SessionAction::Stash)
        .await
        .unwrap();

    assert_eq!(result.changes_summary.total_deltas, 1);

    // Verify stash was saved to storage
    let stash_key = format!("stash:{}", session_id.0);
    let stashed = storage.get(stash_key.as_bytes()).await.unwrap();
    assert!(stashed.is_some());
}

#[tokio::test]
async fn test_multiple_concurrent_sessions() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage);

    let session1 = manager
        .begin("Task 1".to_string(), vec![], None)
        .await
        .unwrap();

    let session2 = manager
        .begin("Task 2".to_string(), vec![], None)
        .await
        .unwrap();

    let session3 = manager
        .begin("Task 3".to_string(), vec![], None)
        .await
        .unwrap();

    let sessions = manager.list_sessions().await;
    assert_eq!(sessions.len(), 3);

    // Clean up
    manager.complete(&session1, SessionAction::Discard).await.unwrap();
    manager.complete(&session2, SessionAction::Discard).await.unwrap();
    manager.complete(&session3, SessionAction::Discard).await.unwrap();
}

#[tokio::test]
async fn test_session_conflict_detection() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage);

    let session1 = manager
        .begin("Session 1".to_string(), vec![], None)
        .await
        .unwrap();

    let session2 = manager
        .begin("Session 2".to_string(), vec![], None)
        .await
        .unwrap();

    // Both sessions modify the same file
    let path = PathBuf::from("shared.rs");
    manager
        .update(&session1, path.clone(), "version1".to_string(), false)
        .await
        .unwrap();

    manager
        .update(&session2, path.clone(), "version2".to_string(), false)
        .await
        .unwrap();

    let conflicts = manager.detect_conflicts(&session1, &session2).await.unwrap();

    assert!(conflicts.has_conflicts);
    assert_eq!(conflicts.file_conflicts.len(), 1);
    assert_eq!(conflicts.file_conflicts[0], path);

    // Clean up
    manager.complete(&session1, SessionAction::Discard).await.unwrap();
    manager.complete(&session2, SessionAction::Discard).await.unwrap();
}

#[tokio::test]
async fn test_session_no_conflict() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage);

    let session1 = manager
        .begin("Session 1".to_string(), vec![], None)
        .await
        .unwrap();

    let session2 = manager
        .begin("Session 2".to_string(), vec![], None)
        .await
        .unwrap();

    // Different files
    manager
        .update(&session1, PathBuf::from("file1.rs"), "content1".to_string(), false)
        .await
        .unwrap();

    manager
        .update(&session2, PathBuf::from("file2.rs"), "content2".to_string(), false)
        .await
        .unwrap();

    let conflicts = manager.detect_conflicts(&session1, &session2).await.unwrap();

    assert!(!conflicts.has_conflicts);

    // Clean up
    manager.complete(&session1, SessionAction::Discard).await.unwrap();
    manager.complete(&session2, SessionAction::Discard).await.unwrap();
}

#[tokio::test]
async fn test_session_max_sessions_eviction() {
    let (storage, _temp) = create_test_storage();
    let config = SessionConfig {
        max_sessions: 2,
        timeout: chrono::Duration::hours(1),
        auto_cleanup: false,
    };
    let manager = SessionManager::new(storage, config);

    let session1 = manager
        .begin("Task 1".to_string(), vec![], None)
        .await
        .unwrap();

    let session2 = manager
        .begin("Task 2".to_string(), vec![], None)
        .await
        .unwrap();

    // This should trigger eviction of session1
    let session3 = manager
        .begin("Task 3".to_string(), vec![], None)
        .await
        .unwrap();

    // session1 should be evicted
    assert!(manager.get_session(&session1).await.is_none());
    assert!(manager.get_session(&session2).await.is_some());
    assert!(manager.get_session(&session3).await.is_some());

    // Clean up
    manager.complete(&session2, SessionAction::Discard).await.unwrap();
    manager.complete(&session3, SessionAction::Discard).await.unwrap();
}

#[tokio::test]
async fn test_session_timeout_cleanup() {
    let (storage, _temp) = create_test_storage();
    let config = SessionConfig {
        max_sessions: 10,
        timeout: chrono::Duration::milliseconds(100),
        auto_cleanup: true,
    };
    let manager = SessionManager::new(storage, config);

    let session_id = manager
        .begin("Timeout test".to_string(), vec![], None)
        .await
        .unwrap();

    // Wait for timeout
    tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

    // Trigger cleanup
    let cleaned = manager.cleanup_timed_out_sessions().await.unwrap();

    assert_eq!(cleaned, 1);
    assert!(manager.get_session(&session_id).await.is_none());
}

#[tokio::test]
async fn test_session_changes_summary() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage);

    let session_id = manager
        .begin("Summary test".to_string(), vec![], None)
        .await
        .unwrap();

    // Make multiple changes
    for i in 0..5 {
        manager
            .update(
                &session_id,
                PathBuf::from(format!("file{}.rs", i)),
                format!("content{}", i),
                false,
            )
            .await
            .unwrap();
    }

    let summary = manager.get_changes_summary(&session_id).await.unwrap();

    assert_eq!(summary.total_deltas, 5);
    assert_eq!(summary.files_modified, 5);

    // Clean up
    manager.complete(&session_id, SessionAction::Discard).await.unwrap();
}

#[tokio::test]
async fn test_session_scope_filtering() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage);

    let session_id = manager
        .begin(
            "Scoped session".to_string(),
            vec![PathBuf::from("src/modules/")],
            None,
        )
        .await
        .unwrap();

    let session = manager.get_session(&session_id).await.unwrap();

    assert_eq!(session.scope.len(), 1);
    assert_eq!(session.scope[0], PathBuf::from("src/modules/"));

    // Clean up
    manager.complete(&session_id, SessionAction::Discard).await.unwrap();
}

#[tokio::test]
async fn test_session_updated_timestamp() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage);

    let session_id = manager
        .begin("Timestamp test".to_string(), vec![], None)
        .await
        .unwrap();

    let session1 = manager.get_session(&session_id).await.unwrap();
    let initial_updated = session1.updated_at;

    // Small delay
    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

    // Update session
    manager
        .update(
            &session_id,
            PathBuf::from("test.rs"),
            "content".to_string(),
            false,
        )
        .await
        .unwrap();

    let session2 = manager.get_session(&session_id).await.unwrap();
    let new_updated = session2.updated_at;

    // Updated timestamp should be newer
    assert!(new_updated > initial_updated);

    // Clean up
    manager.complete(&session_id, SessionAction::Discard).await.unwrap();
}

#[tokio::test]
async fn test_session_query_prefer_session() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage);

    let session_id = manager
        .begin("Query preference test".to_string(), vec![], None)
        .await
        .unwrap();

    // Query with prefer_session = true
    let query = Query::new("test".to_string());
    let result1 = manager.query(&session_id, query.clone(), true).await.unwrap();

    // Query with prefer_session = false
    let result2 = manager.query(&session_id, query, false).await.unwrap();

    // Both should succeed (even if empty)
    assert_eq!(result1.result.truncated, false);
    assert_eq!(result2.result.truncated, false);

    // Clean up
    manager.complete(&session_id, SessionAction::Discard).await.unwrap();
}

#[tokio::test]
async fn test_session_persistence_after_commit() {
    let (storage, _temp) = create_test_storage();
    let manager = SessionManager::with_storage(storage.clone());

    let session_id = manager
        .begin("Persistence test".to_string(), vec![], None)
        .await
        .unwrap();

    let file_path = PathBuf::from("persist.rs");
    let content = "fn persist() {}".to_string();

    manager
        .update(&session_id, file_path.clone(), content.clone(), false)
        .await
        .unwrap();

    // Commit the session
    manager
        .complete(&session_id, SessionAction::Commit)
        .await
        .unwrap();

    // Verify the file was persisted to storage
    let file_key = format!("file:{}", file_path.to_string_lossy());
    let stored_content = storage.get(file_key.as_bytes()).await.unwrap();

    assert!(stored_content.is_some());
    assert_eq!(stored_content.unwrap(), content.as_bytes());
}
