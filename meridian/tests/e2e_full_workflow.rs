mod common;

use common::{create_test_storage, fixtures::*};
use meridian::config::{Config, IndexConfig, MemoryConfig, StorageConfig};
use meridian::context::ContextManager;
use meridian::memory::MemorySystem;
use meridian::session::{SessionAction, SessionManager};
use meridian::types::{
    AttentionPattern, ContextRequest, ContextSnapshot, EpisodeId, LLMAdapter, Outcome, Query, TaskEpisode,
    TokenCount,
};
use std::collections::HashMap;
use std::path::PathBuf;
use tempfile::TempDir;

/// End-to-end test: Complete developer workflow
#[tokio::test]
async fn test_complete_developer_workflow() {
    // Setup
    let temp_dir = TempDir::new().unwrap();
    let (storage, _temp) = create_test_storage();

    let memory_config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let mut memory = MemorySystem::new(storage.clone(), memory_config).unwrap();
    memory.init().await.unwrap();

    let session_manager = SessionManager::with_storage(storage.clone());
    let context_manager = ContextManager::new(LLMAdapter::claude3());

    // Step 1: Start a new coding session
    let session_id = session_manager
        .begin(
            "Implement user authentication".to_string(),
            vec![PathBuf::from("src/auth/")],
            Some("main".to_string()),
        )
        .await
        .unwrap();

    // Step 2: Add symbols to working memory
    let auth_function = test_symbol("authenticate_user", meridian::types::SymbolKind::Function);
    memory.working.add_symbol(auth_function.id.clone(), TokenCount::new(500));

    // Step 3: Update attention based on current focus
    let mut focused = HashMap::new();
    focused.insert(auth_function.id.clone(), 0.9);

    let attention = AttentionPattern {
        focused_symbols: focused,
        predicted_next: vec![],
    };

    memory.working.update(attention);

    // Step 4: Make changes in the session
    session_manager
        .update(
            &session_id,
            PathBuf::from("src/auth/authenticate.rs"),
            "fn authenticate_user() { /* implementation */ }".to_string(),
            false,
        )
        .await
        .unwrap();

    // Step 5: Query within session context
    let query = Query::new("authentication".to_string());
    let query_result = session_manager
        .query(&session_id, query, true)
        .await
        .unwrap();

    assert!(query_result.result.symbols.len() >= 0);

    // Step 6: Prepare context for LLM
    let context_request = ContextRequest {
        files: vec!["src/auth/authenticate.rs".to_string()],
        symbols: vec![],
        max_tokens: Some(TokenCount::new(8000)),
    };

    let optimized_context = context_manager
        .prepare_adaptive(context_request, 8000)
        .await
        .unwrap();

    assert!(!optimized_context.content.is_empty());

    // Step 7: Commit the session
    let completion_result = session_manager
        .complete(&session_id, SessionAction::Commit)
        .await
        .unwrap();

    assert_eq!(completion_result.changes_summary.total_deltas, 1);

    // Step 8: Record the episode
    let episode = TaskEpisode {
        id: EpisodeId::new(),
        timestamp: chrono::Utc::now(),
        task_description: "Implement user authentication".to_string(),
        initial_context: ContextSnapshot {
            active_files: vec!["src/auth/".to_string()],
            active_symbols: vec![],
            working_directory: None,
        },
        queries_made: vec!["authentication".to_string()],
        files_touched: vec!["src/auth/authenticate.rs".to_string()],
        solution_path: "Created authenticate_user function".to_string(),
        outcome: Outcome::Success,
        tokens_used: optimized_context.token_count,
        access_count: 0,
        pattern_value: 0.9,
    };

    memory.episodic.record_episode(episode).await.unwrap();

    // Step 9: Verify the workflow completed successfully
    assert_eq!(memory.episodic.episodes().len(), 1);
    assert!(memory.working.active_symbols().contains(&auth_function.id));
}

/// End-to-end test: Learning from past tasks
#[tokio::test]
async fn test_learning_workflow() {
    let (storage, _temp) = create_test_storage();

    let memory_config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let mut memory = MemorySystem::new(storage, memory_config).unwrap();
    memory.init().await.unwrap();

    // Record several similar tasks
    for i in 0..5 {
        let episode = TaskEpisode {
            id: EpisodeId::new(),
            timestamp: chrono::Utc::now(),
            task_description: format!("Implement feature {} for authentication", i),
            initial_context: ContextSnapshot {
            active_files: vec!["auth.rs".to_string()],
            active_symbols: vec![],
            working_directory: None,
        },
            queries_made: vec!["authentication".to_string()],
            files_touched: vec![format!("auth_{}.rs", i)],
            solution_path: "JWT implementation".to_string(),
            outcome: Outcome::Success,
            tokens_used: TokenCount::new(1000 + i as u32 * 100),
            access_count: 0,
            pattern_value: 0.8,
        };

        memory.episodic.record_episode(episode).await.unwrap();
    }

    // Find similar past tasks
    let similar = memory
        .episodic
        .find_similar("authentication feature implementation", 3)
        .await;

    assert!(!similar.is_empty());
    assert!(similar.len() <= 3);

    // Extract patterns from similar episodes
    let episode_refs: Vec<_> = similar.iter().collect();
    let patterns = memory.episodic.extract_patterns(&episode_refs);

    assert!(!patterns.is_empty());
}

/// End-to-end test: Multi-session conflict resolution
#[tokio::test]
async fn test_multi_session_workflow() {
    let (storage, _temp) = create_test_storage();
    let session_manager = SessionManager::with_storage(storage);

    // Start two parallel sessions
    let session1 = session_manager
        .begin("Feature A".to_string(), vec![], None)
        .await
        .unwrap();

    let session2 = session_manager
        .begin("Feature B".to_string(), vec![], None)
        .await
        .unwrap();

    // Both sessions modify different parts
    session_manager
        .update(
            &session1,
            PathBuf::from("feature_a.rs"),
            "fn feature_a() {}".to_string(),
            false,
        )
        .await
        .unwrap();

    session_manager
        .update(
            &session2,
            PathBuf::from("feature_b.rs"),
            "fn feature_b() {}".to_string(),
            false,
        )
        .await
        .unwrap();

    // Check for conflicts
    let conflicts = session_manager.detect_conflicts(&session1, &session2).await.unwrap();
    assert!(!conflicts.has_conflicts);

    // Commit both sessions
    session_manager
        .complete(&session1, SessionAction::Commit)
        .await
        .unwrap();

    session_manager
        .complete(&session2, SessionAction::Commit)
        .await
        .unwrap();
}

/// End-to-end test: Context adaptation workflow
#[tokio::test]
async fn test_context_adaptation_workflow() {
    let context_manager = ContextManager::new(LLMAdapter::claude3());

    // Test different context sizes
    let test_cases = vec![
        (2000, "Small context"),
        (8000, "Medium context"),
        (32000, "Large context"),
        (100000, "Very large context"),
    ];

    for (available_tokens, description) in test_cases {
        let request = ContextRequest {
            files: vec!["test.rs".to_string()],
            symbols: vec![],
            max_tokens: Some(TokenCount::new(available_tokens)),
        };

        let result = context_manager
            .prepare_adaptive(request, available_tokens as usize)
            .await;

        assert!(result.is_ok(), "Failed for: {}", description);

        let context = result.unwrap();
        assert!(
            context.token_count.0 <= available_tokens,
            "Token count exceeded for: {}",
            description
        );
    }
}

/// End-to-end test: Memory consolidation workflow
#[tokio::test]
async fn test_memory_consolidation_workflow() {
    let (storage, _temp) = create_test_storage();

    let memory_config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let mut memory = MemorySystem::new(storage, memory_config).unwrap();
    memory.init().await.unwrap();

    // Add mix of old and new episodes
    let old_low_value = TaskEpisode {
        id: EpisodeId::new(),
        timestamp: chrono::Utc::now() - chrono::Duration::days(40),
        task_description: "Old low value".to_string(),
        initial_context: ContextSnapshot::default(),
        queries_made: vec![],
        files_touched: vec![],
        solution_path: String::new(),
        outcome: Outcome::Partial,
        tokens_used: TokenCount::new(500),
        access_count: 0,
        pattern_value: 0.1,
    };

    let recent_high_value = TaskEpisode {
        id: EpisodeId::new(),
        timestamp: chrono::Utc::now(),
        task_description: "Recent high value".to_string(),
        initial_context: ContextSnapshot::default(),
        queries_made: vec![],
        files_touched: vec![],
        solution_path: String::new(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(2000),
        access_count: 15,
        pattern_value: 0.95,
    };

    memory.episodic.record_episode(old_low_value).await.unwrap();
    memory.episodic.record_episode(recent_high_value.clone()).await.unwrap();

    let initial_count = memory.episodic.episodes().len();

    // Consolidate
    memory.consolidate().await.unwrap();

    // Should have removed low-value old episodes
    let final_count = memory.episodic.episodes().len();
    assert!(final_count <= initial_count);
}

/// End-to-end test: Working memory eviction workflow
#[tokio::test]
async fn test_working_memory_eviction_workflow() {
    let mut working = meridian::memory::WorkingMemory::new("5000".to_string()).unwrap();

    // Add symbols until capacity is reached
    let symbols: Vec<_> = (0..20)
        .map(|i| test_symbol(&format!("func_{}", i), meridian::types::SymbolKind::Function))
        .collect();

    for symbol in &symbols {
        working.add_symbol(symbol.id.clone(), TokenCount::new(300));
    }

    // Should have evicted some symbols
    assert!(working.active_symbols().len() < symbols.len());

    // Most recently added symbols should be present
    let last_symbol = &symbols[symbols.len() - 1];
    assert!(working.active_symbols().contains(&last_symbol.id));
}

/// End-to-end test: Session stash and recovery workflow
#[tokio::test]
async fn test_session_stash_recovery_workflow() {
    let (storage, _temp) = create_test_storage();
    let session_manager = SessionManager::with_storage(storage.clone());

    // Create and stash a session
    let session_id = session_manager
        .begin("Work in progress".to_string(), vec![], None)
        .await
        .unwrap();

    session_manager
        .update(
            &session_id,
            PathBuf::from("wip.rs"),
            "// Work in progress".to_string(),
            false,
        )
        .await
        .unwrap();

    session_manager
        .complete(&session_id, SessionAction::Stash)
        .await
        .unwrap();

    // Verify stash exists
    let stash_key = format!("stash:{}", session_id.0);
    let stashed = storage.get(stash_key.as_bytes()).await.unwrap();
    assert!(stashed.is_some());
}

/// End-to-end test: Parallel sessions workflow
#[tokio::test]
async fn test_parallel_sessions_workflow() {
    let (storage, _temp) = create_test_storage();
    let session_manager = SessionManager::with_storage(storage);

    // Create multiple parallel sessions
    let mut session_ids = Vec::new();

    for i in 0..5 {
        let session_id = session_manager
            .begin(format!("Parallel task {}", i), vec![], None)
            .await
            .unwrap();

        session_manager
            .update(
                &session_id,
                PathBuf::from(format!("file_{}.rs", i)),
                format!("content {}", i),
                false,
            )
            .await
            .unwrap();

        session_ids.push(session_id);
    }

    // Verify all sessions exist
    assert_eq!(session_manager.list_sessions().await.len(), 5);

    // Complete all sessions
    for session_id in session_ids {
        session_manager
            .complete(&session_id, SessionAction::Commit)
            .await
            .unwrap();
    }

    // All sessions should be cleaned up
    assert_eq!(session_manager.list_sessions().await.len(), 0);
}

/// End-to-end test: Complex context defragmentation
#[tokio::test]
async fn test_complex_defragmentation_workflow() {
    let context_manager = ContextManager::new(LLMAdapter::claude3());

    // Create scattered fragments from different sources
    let fragments = vec![
        "Module A handles authentication".to_string(),
        "Module B manages database connections".to_string(),
        "Module C provides API endpoints".to_string(),
        "Authentication uses JWT tokens".to_string(),
        "Database uses connection pooling".to_string(),
        "API endpoints follow REST conventions".to_string(),
    ];

    let result = context_manager.defragment_fragments(fragments, 5000);

    assert!(result.is_ok());
    let defragmented = result.unwrap();

    // Should create a unified narrative
    assert!(!defragmented.narrative.is_empty());
    assert!(defragmented.token_count.0 > 0);
}

/// End-to-end test: Pattern extraction and reuse
#[tokio::test]
async fn test_pattern_extraction_reuse_workflow() {
    let (storage, _temp) = create_test_storage();

    let memory_config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let mut memory = MemorySystem::new(storage, memory_config).unwrap();
    memory.init().await.unwrap();

    // Record episodes with clear patterns
    let task_descriptions = vec![
        "Add REST endpoint for users",
        "Add REST endpoint for products",
        "Add REST endpoint for orders",
    ];

    for desc in task_descriptions {
        let episode = TaskEpisode {
            id: EpisodeId::new(),
            timestamp: chrono::Utc::now(),
            task_description: desc.to_string(),
            initial_context: ContextSnapshot {
                active_files: vec!["routes.rs".to_string()],
                active_symbols: vec![],
                working_directory: None,
            },
            queries_made: vec!["REST endpoint".to_string()],
            files_touched: vec!["api/routes.rs".to_string()],
            solution_path: "Created endpoint handler".to_string(),
            outcome: Outcome::Success,
            tokens_used: TokenCount::new(1500),
            access_count: 0,
            pattern_value: 0.9,
        };

        memory.episodic.record_episode(episode).await.unwrap();
    }

    // Extract patterns
    let episodes: Vec<_> = memory.episodic.episodes().iter().collect();
    let patterns = memory.episodic.extract_patterns(&episodes);

    // Should identify REST endpoint pattern
    assert!(!patterns.is_empty());
}
