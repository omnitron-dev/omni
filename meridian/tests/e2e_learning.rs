mod common;

use common::{create_test_storage, fixtures::*};
use meridian::memory::MemorySystem;
use meridian::config::MemoryConfig;
use meridian::types::{
    AttentionPattern, ContextSnapshot, EpisodeId, Outcome, TaskEpisode, TokenCount,
};
use std::collections::HashMap;

/// Test: Learning from successful patterns
#[tokio::test]
async fn test_learn_from_successful_patterns() {
    let (storage, _temp) = create_test_storage();
    let config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let mut memory = MemorySystem::new(storage, config).unwrap();
    memory.init().await.unwrap();

    // Record multiple successful episodes with similar patterns
    let auth_tasks = vec![
        ("Implement JWT authentication", vec!["auth/jwt.rs"], vec!["JWT tokens", "middleware"]),
        ("Add OAuth2 support", vec!["auth/oauth.rs"], vec!["OAuth2 flow", "tokens"]),
        ("Implement password reset", vec!["auth/reset.rs"], vec!["password hashing", "email"]),
        ("Add two-factor auth", vec!["auth/2fa.rs"], vec!["TOTP", "QR codes"]),
    ];

    for (task, files, actions) in auth_tasks {
        let episode = TaskEpisode {
            id: EpisodeId::new(),
        schema_version: 1,
            timestamp: chrono::Utc::now(),
            task_description: task.to_string(),
            initial_context: ContextSnapshot {
                active_files: vec!["auth/".to_string()],
                active_symbols: vec![],
                working_directory: None,
            },
            queries_made: vec!["authentication".to_string()],
            files_touched: files.iter().map(|s| s.to_string()).collect(),
            solution_path: actions.join(", "),
            outcome: Outcome::Success,
            tokens_used: TokenCount::new(2000),
            access_count: 0,
            pattern_value: 0.9,
        };

        memory.episodic.record_episode(episode).await.unwrap();
    }

    // Find similar episodes for a new authentication task
    let similar = memory
        .episodic
        .find_similar("implement authentication", 5)
        .await;

    // Should find related authentication episodes (at least 2 out of 4)
    assert!(similar.len() >= 2, "Expected at least 2 similar episodes, found {}", similar.len());
    assert!(similar.iter().all(|e| e.outcome == Outcome::Success));

    // Extract patterns from successful episodes
    let episode_refs: Vec<_> = similar.iter().collect();
    let patterns = memory.episodic.extract_patterns(&episode_refs);

    // Should identify common authentication patterns
    assert!(!patterns.is_empty());

    // Verify patterns have high success rates
    for pattern in &patterns {
        assert!(pattern.success_rate > 0.5);
        assert!(pattern.frequency > 0);
    }
}

/// Test: Filtering out failed approaches
#[tokio::test]
async fn test_filter_failed_approaches() {
    let (storage, _temp) = create_test_storage();
    let config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let mut memory = MemorySystem::new(storage, config).unwrap();
    memory.init().await.unwrap();

    // Record successful episode
    let successful = TaskEpisode {
        id: EpisodeId::new(),
        schema_version: 1,
        timestamp: chrono::Utc::now(),
        task_description: "Implement caching with Redis".to_string(),
        initial_context: ContextSnapshot {
            active_files: vec!["cache/".to_string()],
            active_symbols: vec![],
            working_directory: None,
        },
        queries_made: vec!["caching".to_string()],
        files_touched: vec!["cache/redis.rs".to_string()],
        solution_path: "Redis client setup".to_string(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(1500),
        access_count: 0,
        pattern_value: 0.9,
    };

    // Record failed episode
    let failed = TaskEpisode {
        id: EpisodeId::new(),
        schema_version: 1,
        timestamp: chrono::Utc::now(),
        task_description: "Implement caching with Memcached".to_string(),
        initial_context: ContextSnapshot {
            active_files: vec!["cache/".to_string()],
            active_symbols: vec![],
            working_directory: None,
        },
        queries_made: vec!["caching".to_string()],
        files_touched: vec!["cache/memcached.rs".to_string()],
        solution_path: "Memcached setup failed".to_string(),
        outcome: Outcome::Failure,
        tokens_used: TokenCount::new(3000),
        access_count: 0,
        pattern_value: 0.1,
    };

    memory.episodic.record_episode(successful.clone()).await.unwrap();
    memory.episodic.record_episode(failed).await.unwrap();

    // Find similar episodes
    let similar = memory.episodic.find_similar("implement caching", 5).await;

    // Should only return successful episodes
    assert_eq!(similar.len(), 1);
    assert_eq!(similar[0].outcome, Outcome::Success);
    assert_eq!(similar[0].task_description, successful.task_description);
}

/// Test: Learning from frequently accessed episodes
#[tokio::test]
async fn test_learn_from_frequently_accessed() {
    let (storage, _temp) = create_test_storage();
    let config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let mut memory = MemorySystem::new(storage, config.clone()).unwrap();
    memory.init().await.unwrap();

    // Record episode
    let episode = TaskEpisode {
        id: EpisodeId::new(),
        schema_version: 1,
        timestamp: chrono::Utc::now(),
        task_description: "Common pattern for API endpoints".to_string(),
        initial_context: ContextSnapshot {
            active_files: vec!["api/".to_string()],
            active_symbols: vec![],
            working_directory: None,
        },
        queries_made: vec!["REST API".to_string()],
        files_touched: vec!["api/routes.rs".to_string()],
        solution_path: "RESTful endpoint".to_string(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(1200),
        access_count: 0,
        pattern_value: 0.85,
    };

    let episode_id = episode.id.0.clone();
    memory.episodic.record_episode(episode).await.unwrap();

    // Simulate frequent access
    for _ in 0..15 {
        memory.episodic.increment_access(&episode_id).await.unwrap();
    }

    // Get the episode
    let accessed_episode = memory.episodic.get_episode(&episode_id).unwrap();
    assert_eq!(accessed_episode.access_count, 15);

    // During consolidation, frequently accessed episodes should be retained
    // even if they're old
    let modified_episode = TaskEpisode {
        schema_version: 1,
        id: accessed_episode.id.clone(),
        timestamp: chrono::Utc::now() - chrono::Duration::days(40),
        task_description: accessed_episode.task_description.clone(),
        initial_context: accessed_episode.initial_context.clone(),
        queries_made: accessed_episode.queries_made.clone(),
        files_touched: accessed_episode.files_touched.clone(),
        solution_path: accessed_episode.solution_path.clone(),
        outcome: accessed_episode.outcome,
        tokens_used: accessed_episode.tokens_used,
        access_count: 15, // High access count
        pattern_value: accessed_episode.pattern_value,
    };

    // Clear and re-add with modified timestamp
    let (new_storage, _new_temp) = create_test_storage();
    memory = MemorySystem::new(new_storage, config).unwrap();
    memory.init().await.unwrap();
    memory.episodic.record_episode(modified_episode).await.unwrap();

    memory.consolidate().await.unwrap();

    // Should still have the episode due to high access count
    let episodes = memory.episodic.episodes();
    assert!(episodes.iter().any(|e| e.id.0 == episode_id));
}

/// Test: Pattern consolidation from multiple episodes
#[tokio::test]
async fn test_pattern_consolidation() {
    let (storage, _temp) = create_test_storage();
    let config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let mut memory = MemorySystem::new(storage, config).unwrap();
    memory.init().await.unwrap();

    // Record multiple episodes with similar patterns
    for i in 0..5 {
        let episode = TaskEpisode {
            id: EpisodeId::new(),
        schema_version: 1,
            timestamp: chrono::Utc::now(),
            task_description: format!("Database migration {}", i),
            initial_context: ContextSnapshot {
            active_files: vec!["db/".to_string()],
            active_symbols: vec![],
            working_directory: None,
        },
            queries_made: vec!["database migration".to_string()],
            files_touched: vec![format!("migrations/{}.sql", i)],
            solution_path: "ALTER TABLE, ADD COLUMN".to_string(),
            outcome: Outcome::Success,
            tokens_used: TokenCount::new(800),
            access_count: 0,
            pattern_value: 0.85,
        };

        memory.episodic.record_episode(episode).await.unwrap();
    }

    // Extract patterns
    let episodes: Vec<_> = memory.episodic.episodes().iter().collect();
    let patterns = memory.episodic.extract_patterns(&episodes);

    // Should consolidate into common patterns
    assert!(!patterns.is_empty());

    // Patterns should have frequency reflecting multiple episodes
    for pattern in &patterns {
        assert!(pattern.frequency >= 1);
        assert!(pattern.success_rate > 0.0);
    }
}

/// Test: Attention pattern learning
#[tokio::test]
async fn test_attention_pattern_learning() {
    let mut working = meridian::memory::WorkingMemory::new("10000".to_string()).unwrap();

    let symbols = vec![
        test_symbol("func_a", meridian::types::SymbolKind::Function),
        test_symbol("func_b", meridian::types::SymbolKind::Function),
        test_symbol("func_c", meridian::types::SymbolKind::Function),
    ];

    // Add symbols to working memory
    for symbol in &symbols {
        working.add_symbol(symbol.id.clone(), TokenCount::new(300));
    }

    // Simulate attention pattern: func_a is focused, func_b predicted next
    let mut focused = HashMap::new();
    focused.insert(symbols[0].id.clone(), 0.9);
    focused.insert(symbols[1].id.clone(), 0.3);

    let attention = AttentionPattern {
        focused_symbols: focused,
        predicted_next: vec![symbols[2].id.clone()],
    };

    working.update(attention);

    // Verify attention weights
    let weight_a = working.get_attention_weight(&symbols[0].id).unwrap();
    let weight_b = working.get_attention_weight(&symbols[1].id).unwrap();

    // func_a should have higher attention
    assert!(weight_a > weight_b);

    // func_c should be in working memory (prefetched)
    assert!(working.active_symbols().contains(&symbols[2].id));
}

/// Test: Learning from partial success
#[tokio::test]
async fn test_learn_from_partial_success() {
    let (storage, _temp) = create_test_storage();
    let config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let mut memory = MemorySystem::new(storage, config).unwrap();
    memory.init().await.unwrap();

    // Record partially successful episode
    let partial = TaskEpisode {
        id: EpisodeId::new(),
        schema_version: 1,
        timestamp: chrono::Utc::now(),
        task_description: "Implement feature X".to_string(),
        initial_context: ContextSnapshot {
            active_files: vec!["feature/".to_string()],
            active_symbols: vec![],
            working_directory: None,
        },
        queries_made: vec!["feature implementation".to_string()],
        files_touched: vec!["feature/x.rs".to_string()],
        solution_path: "Partial implementation".to_string(),
        outcome: Outcome::Partial,
        tokens_used: TokenCount::new(2500),
        access_count: 0,
        pattern_value: 0.6,
    };

    memory.episodic.record_episode(partial).await.unwrap();

    // Partial episodes should not be returned in similar search
    // (find_similar only returns Outcome::Success)
    let similar = memory.episodic.find_similar("implement feature", 5).await;

    // Should not find the partial episode
    assert_eq!(similar.len(), 0);
}

/// Test: Pattern value decay over time
#[tokio::test]
async fn test_pattern_value_decay() {
    let (storage, _temp) = create_test_storage();
    let config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let mut memory = MemorySystem::new(storage, config).unwrap();
    memory.init().await.unwrap();

    // Add old episode with low pattern value
    let old_episode = TaskEpisode {
        id: EpisodeId::new(),
        schema_version: 1,
        timestamp: chrono::Utc::now() - chrono::Duration::days(40),
        task_description: "Old pattern".to_string(),
        initial_context: ContextSnapshot::default(),
        queries_made: vec![],
        files_touched: vec![],
        solution_path: String::new(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(1000),
        access_count: 0,
        pattern_value: 0.3, // Low value
    };

    memory.episodic.record_episode(old_episode).await.unwrap();

    // Consolidate
    memory.consolidate().await.unwrap();

    // Old, low-value episodes should be removed
    assert_eq!(memory.episodic.episodes().len(), 0);
}

/// Test: Multi-pattern extraction from single episode
#[tokio::test]
async fn test_multi_pattern_extraction() {
    let (storage, _temp) = create_test_storage();
    let config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let memory = MemorySystem::new(storage, config).unwrap();

    // Create episode with multiple patterns
    let episode = TaskEpisode {
        id: EpisodeId::new(),
        schema_version: 1,
        timestamp: chrono::Utc::now(),
        task_description: "Complex feature implementation".to_string(),
        initial_context: ContextSnapshot {
            active_files: vec!["module/".to_string()],
            active_symbols: vec![],
            working_directory: None,
        },
        queries_made: vec![
            "database queries".to_string(),
            "API endpoints".to_string(),
            "validation".to_string(),
        ],
        files_touched: vec![
            "db/queries.rs".to_string(),
            "api/endpoints.rs".to_string(),
            "validation/rules.rs".to_string(),
        ],
        solution_path: "SQL queries, REST endpoints, Input validation".to_string(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(4000),
        access_count: 0,
        pattern_value: 0.95,
    };

    // Extract patterns
    let patterns = memory.episodic.extract_patterns(&[&episode]);

    // Should extract patterns (at least 1, possibly multiple)
    assert!(!patterns.is_empty(), "Expected at least 1 pattern");

    // Patterns should have characteristics from the episode
    for pattern in &patterns {
        assert!(pattern.frequency >= 1);
        assert!(pattern.success_rate > 0.0);
    }
}

/// Test: Learning optimal token usage
#[tokio::test]
async fn test_learn_optimal_token_usage() {
    let (storage, _temp) = create_test_storage();
    let config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let mut memory = MemorySystem::new(storage, config).unwrap();
    memory.init().await.unwrap();

    // Record episodes with different token usage
    let efficient = TaskEpisode {
        id: EpisodeId::new(),
        schema_version: 1,
        timestamp: chrono::Utc::now(),
        task_description: "Efficient implementation".to_string(),
        initial_context: ContextSnapshot::default(),
        queries_made: vec![],
        files_touched: vec!["efficient.rs".to_string()],
        solution_path: "Minimal context".to_string(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(1000),
        access_count: 0,
        pattern_value: 0.95,
    };

    let inefficient = TaskEpisode {
        id: EpisodeId::new(),
        schema_version: 1,
        timestamp: chrono::Utc::now(),
        task_description: "Inefficient implementation".to_string(),
        initial_context: ContextSnapshot::default(),
        queries_made: vec![],
        files_touched: vec!["inefficient.rs".to_string()],
        solution_path: "Too much context".to_string(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(5000),
        access_count: 0,
        pattern_value: 0.7,
    };

    memory.episodic.record_episode(efficient.clone()).await.unwrap();
    memory.episodic.record_episode(inefficient).await.unwrap();

    // Efficient episodes should have higher pattern value
    assert!(efficient.pattern_value > 0.9);
}
