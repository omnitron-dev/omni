mod common;

use common::{create_test_storage, fixtures::*};
use meridian::config::MemoryConfig;
use meridian::memory::{EpisodicMemory, MemorySystem, WorkingMemory};
use meridian::types::{AttentionPattern, ContextSnapshot, EpisodeId, Outcome, TaskEpisode, TokenCount};
use std::collections::HashMap;

#[tokio::test]
async fn test_memory_system_initialization() {
    let (storage, _temp) = create_test_storage();
    let config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let result = MemorySystem::new(storage, config);
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_memory_system_init_and_load() {
    let (storage, _temp) = create_test_storage();
    let config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let mut memory = MemorySystem::new(storage.clone(), config).unwrap();

    // Initialize memory system
    memory.init().await.unwrap();

    // Verify all components are initialized
    assert_eq!(memory.working.active_symbols().len(), 0);
    assert_eq!(memory.episodic.episodes().len(), 0);
}

#[tokio::test]
async fn test_episodic_memory_recording() {
    let (storage, _temp) = create_test_storage();
    let mut episodic = EpisodicMemory::new(storage, 30).unwrap();

    let episode = TaskEpisode {
        id: EpisodeId::new(),
        timestamp: chrono::Utc::now(),
        task_description: "Implement authentication system".to_string(),
        initial_context: ContextSnapshot {
            active_files: vec!["auth.rs".to_string()],
            active_symbols: vec![],
            working_directory: None,
        },
        queries_made: vec!["find auth middleware".to_string()],
        files_touched: vec!["src/auth.rs".to_string(), "src/middleware/auth.rs".to_string()],
        solution_path: "Create JWT middleware".to_string(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(5000),
        access_count: 0,
        pattern_value: 0.9,
    };

    episodic.record_episode(episode.clone()).await.unwrap();

    // Verify episode was recorded
    assert_eq!(episodic.episodes().len(), 1);
    assert_eq!(episodic.episodes()[0].task_description, episode.task_description);
}

#[tokio::test]
async fn test_episodic_memory_find_similar() {
    let (storage, _temp) = create_test_storage();
    let mut episodic = EpisodicMemory::new(storage, 30).unwrap();

    // Add multiple related episodes
    let episode1 = TaskEpisode {
        id: EpisodeId::new(),
        timestamp: chrono::Utc::now(),
        task_description: "Add user authentication".to_string(),
        initial_context: ContextSnapshot::default(),
        queries_made: vec!["find auth".to_string()],
        files_touched: vec!["auth.rs".to_string()],
        solution_path: "JWT token".to_string(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(1000),
        access_count: 0,
        pattern_value: 0.8,
    };

    let episode2 = TaskEpisode {
        id: EpisodeId::new(),
        timestamp: chrono::Utc::now(),
        task_description: "Fix authentication bug in JWT".to_string(),
        initial_context: ContextSnapshot::default(),
        queries_made: vec!["auth error".to_string()],
        files_touched: vec!["auth.rs".to_string()],
        solution_path: "Fixed expiry check".to_string(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(800),
        access_count: 0,
        pattern_value: 0.7,
    };

    let episode3 = TaskEpisode {
        id: EpisodeId::new(),
        timestamp: chrono::Utc::now(),
        task_description: "Add database connection".to_string(),
        initial_context: ContextSnapshot::default(),
        queries_made: vec!["database".to_string()],
        files_touched: vec!["db.rs".to_string()],
        solution_path: "Setup connection pool".to_string(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(1200),
        access_count: 0,
        pattern_value: 0.6,
    };

    episodic.record_episode(episode1).await.unwrap();
    episodic.record_episode(episode2).await.unwrap();
    episodic.record_episode(episode3).await.unwrap();

    // Find similar episodes
    let similar = episodic.find_similar("authentication jwt token", 5).await;

    // Should find the auth-related episodes
    assert!(!similar.is_empty());
    assert!(similar.iter().any(|e| e.task_description.contains("authentication")));
}

#[tokio::test]
async fn test_episodic_memory_pattern_extraction() {
    let (storage, _temp) = create_test_storage();
    let episodic = EpisodicMemory::new(storage, 30).unwrap();

    let episode = TaskEpisode {
        id: EpisodeId::new(),
        timestamp: chrono::Utc::now(),
        task_description: "Implement API endpoint".to_string(),
        initial_context: ContextSnapshot::default(),
        queries_made: vec!["find router".to_string()],
        files_touched: vec!["routes.rs".to_string()],
        solution_path: "Added POST /api/users".to_string(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(1500),
        access_count: 0,
        pattern_value: 0.85,
    };

    let patterns = episodic.extract_patterns(&[&episode]);

    // Should extract patterns from the episode
    assert!(!patterns.is_empty());
    assert!(patterns.iter().any(|p| p.name.contains("Pattern")));
}

#[tokio::test]
async fn test_episodic_memory_consolidation() {
    let (storage, _temp) = create_test_storage();
    let mut episodic = EpisodicMemory::new(storage, 30).unwrap();

    // Add old, low-value episode
    let old_episode = TaskEpisode {
        id: EpisodeId::new(),
        timestamp: chrono::Utc::now() - chrono::Duration::days(40),
        task_description: "Old low value task".to_string(),
        initial_context: ContextSnapshot::default(),
        queries_made: vec![],
        files_touched: vec![],
        solution_path: String::new(),
        outcome: Outcome::Partial,
        tokens_used: TokenCount::new(500),
        access_count: 0,
        pattern_value: 0.1,
    };

    // Add recent, high-value episode
    let recent_episode = TaskEpisode {
        id: EpisodeId::new(),
        timestamp: chrono::Utc::now(),
        task_description: "Recent high value task".to_string(),
        initial_context: ContextSnapshot::default(),
        queries_made: vec![],
        files_touched: vec![],
        solution_path: String::new(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(2000),
        access_count: 0,
        pattern_value: 0.9,
    };

    episodic.record_episode(old_episode).await.unwrap();
    episodic.record_episode(recent_episode.clone()).await.unwrap();

    assert_eq!(episodic.episodes().len(), 2);

    // Consolidate - should remove old episode
    episodic.consolidate().await.unwrap();

    // Should only keep the recent episode
    assert_eq!(episodic.episodes().len(), 1);
    assert_eq!(episodic.episodes()[0].task_description, recent_episode.task_description);
}

#[tokio::test]
async fn test_working_memory_symbol_management() {
    let mut working = WorkingMemory::new("10000".to_string()).unwrap();

    let symbol1 = test_symbol("function1", meridian::types::SymbolKind::Function);
    let symbol2 = test_symbol("function2", meridian::types::SymbolKind::Function);
    let symbol3 = test_symbol("function3", meridian::types::SymbolKind::Function);

    // Add symbols
    working.add_symbol(symbol1.id.clone(), TokenCount::new(500));
    working.add_symbol(symbol2.id.clone(), TokenCount::new(700));
    working.add_symbol(symbol3.id.clone(), TokenCount::new(300));

    assert_eq!(working.active_symbols().len(), 3);
    assert_eq!(working.current_usage().0, 1500);
}

#[tokio::test]
async fn test_working_memory_eviction_on_capacity() {
    let mut working = WorkingMemory::new("1000".to_string()).unwrap();

    let symbol1 = test_symbol("function1", meridian::types::SymbolKind::Function);
    let symbol2 = test_symbol("function2", meridian::types::SymbolKind::Function);
    let symbol3 = test_symbol("function3", meridian::types::SymbolKind::Function);
    let symbol4 = test_symbol("function4", meridian::types::SymbolKind::Function);

    // Fill to capacity
    working.add_symbol(symbol1.id.clone(), TokenCount::new(300));
    working.add_symbol(symbol2.id.clone(), TokenCount::new(300));
    working.add_symbol(symbol3.id.clone(), TokenCount::new(300));

    assert_eq!(working.active_symbols().len(), 3);

    // This should trigger eviction
    working.add_symbol(symbol4.id.clone(), TokenCount::new(300));

    // Should still have 3 symbols (one was evicted)
    assert_eq!(working.active_symbols().len(), 3);
    assert!(working.active_symbols().contains(&symbol4.id));
}

#[tokio::test]
async fn test_working_memory_attention_patterns() {
    let mut working = WorkingMemory::new("5000".to_string()).unwrap();

    let symbol1 = test_symbol("important_function", meridian::types::SymbolKind::Function);
    let symbol2 = test_symbol("less_important", meridian::types::SymbolKind::Function);

    working.add_symbol(symbol1.id.clone(), TokenCount::new(200));
    working.add_symbol(symbol2.id.clone(), TokenCount::new(200));

    // Create attention pattern
    let mut focused = HashMap::new();
    focused.insert(symbol1.id.clone(), 0.9);
    focused.insert(symbol2.id.clone(), 0.1);

    let attention = AttentionPattern {
        focused_symbols: focused,
        predicted_next: vec![],
    };

    working.update(attention);

    // Important function should have higher attention weight
    let weight1 = working.get_attention_weight(&symbol1.id).unwrap();
    let weight2 = working.get_attention_weight(&symbol2.id).unwrap();

    assert!(weight1 > weight2);
}

#[tokio::test]
async fn test_working_memory_prefetch() {
    let mut working = WorkingMemory::new("5000".to_string()).unwrap();

    let current_symbol = test_symbol("current", meridian::types::SymbolKind::Function);
    let predicted_symbol = test_symbol("predicted", meridian::types::SymbolKind::Function);

    working.add_symbol(current_symbol.id.clone(), TokenCount::new(200));

    // Create attention pattern with predicted next symbol
    let attention = AttentionPattern {
        focused_symbols: HashMap::new(),
        predicted_next: vec![predicted_symbol.id.clone()],
    };

    working.update(attention);

    // Predicted symbol should be prefetched if there's capacity
    assert!(working.active_symbols().contains(&predicted_symbol.id) ||
            working.eviction_history().contains(&predicted_symbol.id));
}

#[tokio::test]
async fn test_memory_system_consolidation() {
    let (storage, _temp) = create_test_storage();
    let config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let mut memory = MemorySystem::new(storage, config).unwrap();
    memory.init().await.unwrap();

    // Consolidation should work without errors
    let result = memory.consolidate().await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_episodic_memory_increment_access() {
    let (storage, _temp) = create_test_storage();
    let mut episodic = EpisodicMemory::new(storage, 30).unwrap();

    let episode = TaskEpisode {
        id: EpisodeId::new(),
        timestamp: chrono::Utc::now(),
        task_description: "Test episode".to_string(),
        initial_context: ContextSnapshot::default(),
        queries_made: vec![],
        files_touched: vec![],
        solution_path: String::new(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(1000),
        access_count: 0,
        pattern_value: 0.8,
    };

    let episode_id = episode.id.0.clone();
    episodic.record_episode(episode).await.unwrap();

    // Increment access count
    episodic.increment_access(&episode_id).await.unwrap();
    episodic.increment_access(&episode_id).await.unwrap();

    // Verify access count increased
    let stored_episode = episodic.get_episode(&episode_id).unwrap();
    assert_eq!(stored_episode.access_count, 2);
}

#[tokio::test]
async fn test_working_memory_clear() {
    let mut working = WorkingMemory::new("5000".to_string()).unwrap();

    let symbol1 = test_symbol("func1", meridian::types::SymbolKind::Function);
    let symbol2 = test_symbol("func2", meridian::types::SymbolKind::Function);

    working.add_symbol(symbol1.id.clone(), TokenCount::new(500));
    working.add_symbol(symbol2.id.clone(), TokenCount::new(500));

    assert_eq!(working.active_symbols().len(), 2);

    working.clear();

    assert_eq!(working.active_symbols().len(), 0);
    assert_eq!(working.current_usage().0, 0);
}

#[tokio::test]
async fn test_working_memory_stats() {
    let mut working = WorkingMemory::new("10000".to_string()).unwrap();

    let symbol = test_symbol("test_function", meridian::types::SymbolKind::Function);
    working.add_symbol(symbol.id.clone(), TokenCount::new(2000));

    let stats = working.stats();

    assert_eq!(stats.active_symbols, 1);
    assert_eq!(stats.current_usage.0, 2000);
    assert_eq!(stats.capacity.0, 10000);
    assert_eq!(stats.utilization, 0.2);
}

#[tokio::test]
async fn test_episodic_memory_persistence() {
    let (storage, _temp) = create_test_storage();

    let episode_id = EpisodeId::new();
    let task = "Test persistent episode";

    // Create and record episode
    {
        let mut episodic = EpisodicMemory::new(storage.clone(), 30).unwrap();
        let episode = TaskEpisode {
            id: episode_id.clone(),
            timestamp: chrono::Utc::now(),
            task_description: task.to_string(),
            initial_context: ContextSnapshot::default(),
            queries_made: vec![],
            files_touched: vec![],
            solution_path: String::new(),
            outcome: Outcome::Success,
            tokens_used: TokenCount::new(1000),
            access_count: 0,
            pattern_value: 0.8,
        };
        episodic.record_episode(episode).await.unwrap();
    }

    // Load in new instance
    {
        let mut episodic = EpisodicMemory::new(storage, 30).unwrap();
        episodic.load().await.unwrap();

        assert_eq!(episodic.episodes().len(), 1);
        let loaded = episodic.get_episode(&episode_id.0).unwrap();
        assert_eq!(loaded.task_description, task);
    }
}
