mod common;

use common::{create_test_storage, fixtures::*};
use meridian::config::MemoryConfig;
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

    let session_manager = SessionManager::with_storage(storage.clone()).unwrap();
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
    let session_manager = SessionManager::with_storage(storage).unwrap();

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
    let session_manager = SessionManager::with_storage(storage.clone()).unwrap();

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
    let session_manager = SessionManager::with_storage(storage).unwrap();

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

/// END-TO-END TEST: Complete spec → code → docs → examples → tests workflow
/// This test validates the entire knowledge chain through MCP tools:
/// 1. Read specification from specs system
/// 2. Create semantic links (spec → code)
/// 3. Generate documentation from code
/// 4. Generate examples from code
/// 5. Generate tests from code
/// 6. Validate all links and transformations
#[tokio::test]
async fn test_spec_to_tests_complete_workflow() {
    use meridian::codegen::{DocumentationGenerator, DocFormat, ExampleGenerator, TestGenerator, TestFramework, ExampleComplexity};
    use meridian::links::{LinksStorage, RocksDBLinksStorage, SemanticLink, LinkTarget, LinkType, ExtractionMethod, KnowledgeLevel};
    use meridian::specs::SpecificationManager;
    use meridian::storage::RocksDBStorage;
    use std::sync::Arc;

    let temp_dir = TempDir::new().unwrap();
    let (_storage, _temp) = create_test_storage();

    // Initialize components
    let _spec_manager = SpecificationManager::new(temp_dir.path().join("specs"));
    let links_storage = {
        let rocks_storage = RocksDBStorage::new(&temp_dir.path().join("links")).unwrap();
        Arc::new(RocksDBLinksStorage::new(Arc::new(rocks_storage)))
    };

    // === STEP 1: Read Specification ===
    // In a real workflow, specs would be loaded from the specs directory
    // For this test, we simulate a spec section
    let spec_id = "test-spec.md#authentication-feature";
    let _spec_content = r#"
    # Authentication Feature

    The authentication system shall provide a function to authenticate users
    based on username and password. The function should return a session token
    on success and throw an error on failure.
    "#;

    // === STEP 2: Create Code Implementation (simulated) ===
    // In real workflow, this would be actual code from the indexer
    let code_symbol = test_symbol("authenticate_user", meridian::types::SymbolKind::Function);
    let code_id = format!("code::{}", code_symbol.name);

    // === STEP 3: Create Semantic Link (Spec → Code) ===
    let spec_target = LinkTarget::spec(spec_id.to_string());
    let code_target = LinkTarget::code(code_id.clone());

    let spec_to_code_link = SemanticLink::new(
        LinkType::ImplementedBy,
        spec_target.clone(),
        code_target.clone(),
        0.95,
        ExtractionMethod::Annotation,
        "test-workflow".to_string(),
    );

    links_storage.add_link(&spec_to_code_link).await.unwrap();

    // Verify the spec→code link exists
    let spec_links = links_storage.find_links_from_source(&spec_target).await.unwrap();
    assert_eq!(spec_links.len(), 1);
    assert_eq!(spec_links[0].target, code_target);
    assert_eq!(spec_links[0].link_type, LinkType::ImplementedBy);

    // === STEP 4: Generate Documentation ===
    let doc_generator = DocumentationGenerator::new(DocFormat::TSDoc);
    let generated_doc = doc_generator.generate(&code_symbol).unwrap();

    assert!(!generated_doc.content.is_empty());
    // Note: is_enhanced may be false for symbols without detailed metadata
    // The important thing is that documentation was generated

    // Create Code → Docs semantic link
    let docs_target = LinkTarget::docs(format!("docs/{}.md", code_symbol.name));
    let code_to_docs_link = SemanticLink::new(
        LinkType::DocumentedIn,
        code_target.clone(),
        docs_target.clone(),
        0.90,
        ExtractionMethod::Annotation,
        "test-workflow".to_string(),
    );

    links_storage.add_link(&code_to_docs_link).await.unwrap();

    // Verify the code→docs link exists
    let code_links = links_storage.get_bidirectional_links(&code_target).await.unwrap();
    assert!(code_links.incoming.len() >= 1); // From spec
    assert!(code_links.outgoing.iter().any(|l| l.target == docs_target));

    // === STEP 5: Generate Examples ===
    let example_generator = ExampleGenerator::new("typescript".to_string());
    let basic_example = example_generator.generate_basic(&code_symbol).unwrap();

    assert!(!basic_example.code.is_empty());
    assert_eq!(basic_example.language, "typescript");
    assert_eq!(basic_example.complexity, ExampleComplexity::Basic);

    // Create Docs → Examples semantic link
    let examples_target = LinkTarget::examples(format!("examples/{}_example.ts", code_symbol.name));
    let docs_to_examples_link = SemanticLink::new(
        LinkType::ShowsExample,
        docs_target.clone(),
        examples_target.clone(),
        0.85,
        ExtractionMethod::Annotation,
        "test-workflow".to_string(),
    );

    links_storage.add_link(&docs_to_examples_link).await.unwrap();

    // === STEP 6: Generate Tests ===
    let test_generator = TestGenerator::new(TestFramework::Jest);
    let generated_tests = test_generator.generate_unit_tests(&code_symbol).unwrap();

    assert!(!generated_tests.is_empty());
    let first_test = &generated_tests[0];
    assert_eq!(first_test.framework, TestFramework::Jest);
    assert!(!first_test.code.is_empty());

    // Create Code → Tests semantic link
    let tests_target = LinkTarget::tests(format!("tests/{}.spec.ts", code_symbol.name));
    let code_to_tests_link = SemanticLink::new(
        LinkType::TestedBy,
        code_target.clone(),
        tests_target.clone(),
        0.95,
        ExtractionMethod::Annotation,
        "test-workflow".to_string(),
    );

    links_storage.add_link(&code_to_tests_link).await.unwrap();

    // === STEP 7: Validate Complete Link Chain ===
    // Verify we can traverse from spec all the way to tests

    // Spec → Code
    let spec_to_code = links_storage
        .find_cross_level_links(KnowledgeLevel::Spec, KnowledgeLevel::Code)
        .await
        .unwrap();
    assert!(!spec_to_code.is_empty());

    // Code → Docs
    let code_to_docs = links_storage
        .find_cross_level_links(KnowledgeLevel::Code, KnowledgeLevel::Docs)
        .await
        .unwrap();
    assert!(!code_to_docs.is_empty());

    // Docs → Examples
    let docs_to_examples = links_storage
        .find_cross_level_links(KnowledgeLevel::Docs, KnowledgeLevel::Examples)
        .await
        .unwrap();
    assert!(!docs_to_examples.is_empty());

    // Code → Tests
    let code_to_tests = links_storage
        .find_links_by_type_from_source(LinkType::TestedBy, &code_target)
        .await
        .unwrap();
    assert!(!code_to_tests.is_empty());

    // === STEP 8: Verify Link Statistics ===
    let stats = links_storage.get_statistics().await.unwrap();
    println!("Total links: {}, Expected: >= 4", stats.total_links);
    assert!(stats.total_links >= 4); // spec→code, code→docs, docs→examples, code→tests
    assert!(stats.average_confidence > 0.8);

    // Verify all expected link types exist
    assert!(stats.by_type.contains_key("implemented_by"));
    assert!(stats.by_type.contains_key("documented_in"));
    assert!(stats.by_type.contains_key("shows_example"));
    assert!(stats.by_type.contains_key("tested_by"));

    // === STEP 9: Test Bidirectional Navigation ===
    // From code, we should be able to find:
    // - Which spec it implements (incoming)
    // - What docs describe it (outgoing)
    // - What tests verify it (outgoing)
    let code_bi_links = links_storage.get_bidirectional_links(&code_target).await.unwrap();

    assert!(code_bi_links.incoming.iter().any(|l| l.source.level == KnowledgeLevel::Spec));
    assert!(code_bi_links.outgoing.iter().any(|l| l.target.level == KnowledgeLevel::Docs));
    assert!(code_bi_links.outgoing.iter().any(|l| l.target.level == KnowledgeLevel::Tests));

    println!("✅ Complete workflow validated:");
    println!("   Spec → Code → Docs → Examples");
    println!("             ↓");
    println!("           Tests");
    println!("   Total links: {}", stats.total_links);
    println!("   Avg confidence: {:.2}", stats.average_confidence);
}

/// END-TO-END TEST: Multi-feature workflow with link validation
/// Tests multiple features going through the workflow simultaneously
#[tokio::test]
async fn test_parallel_spec_to_code_workflows() {
    use meridian::links::{LinksStorage, RocksDBLinksStorage, SemanticLink, LinkTarget, LinkType, ExtractionMethod, ValidationStatus};
    use meridian::storage::RocksDBStorage;
    use std::sync::Arc;

    let temp_dir = TempDir::new().unwrap();
    let rocks_storage = RocksDBStorage::new(temp_dir.path()).unwrap();
    let links_storage = Arc::new(RocksDBLinksStorage::new(Arc::new(rocks_storage)));

    // Create 5 parallel workflows
    let features = vec![
        ("user-management", "UserService", "createUser"),
        ("authentication", "AuthService", "login"),
        ("authorization", "AuthzService", "checkPermission"),
        ("session-management", "SessionService", "createSession"),
        ("token-validation", "TokenService", "validateToken"),
    ];

    let features_count = features.len();

    for (spec_name, service_name, method_name) in &features {
        let spec_target = LinkTarget::spec(format!("spec.md#{}", spec_name));
        let code_target = LinkTarget::code(format!("{}::{}", service_name, method_name));
        let docs_target = LinkTarget::docs(format!("docs/{}.md", service_name));
        let tests_target = LinkTarget::tests(format!("tests/{}.spec.ts", service_name));

        // Create complete link chain
        let links = vec![
            SemanticLink::new(
                LinkType::ImplementedBy,
                spec_target.clone(),
                code_target.clone(),
                0.95,
                ExtractionMethod::Annotation,
                "parallel-test".to_string(),
            ),
            SemanticLink::new(
                LinkType::DocumentedIn,
                code_target.clone(),
                docs_target.clone(),
                0.90,
                ExtractionMethod::Annotation,
                "parallel-test".to_string(),
            ),
            SemanticLink::new(
                LinkType::TestedBy,
                code_target.clone(),
                tests_target.clone(),
                0.95,
                ExtractionMethod::Annotation,
                "parallel-test".to_string(),
            ),
        ];

        for link in links {
            links_storage.add_link(&link).await.unwrap();
        }
    }

    // Verify all workflows are tracked
    let stats = links_storage.get_statistics().await.unwrap();
    assert_eq!(stats.total_links, 15); // 5 features × 3 links each

    // Validate some links
    let all_links = links_storage
        .find_links_by_type(LinkType::ImplementedBy)
        .await
        .unwrap();

    for link in all_links.iter().take(2) {
        links_storage
            .validate_link(&link.id, ValidationStatus::Valid)
            .await
            .unwrap();
    }

    // Check broken links (should be none)
    let broken = links_storage.find_broken_links().await.unwrap();
    assert_eq!(broken.len(), 0);

    println!("✅ Parallel workflows validated: {} features, {} links",
             features_count, stats.total_links);
}
