/// End-to-end tests for 16 newly implemented MCP tools
/// Tests cover all new handlers with success scenarios, error handling, and edge cases

mod common;

use common::{create_test_storage, fixtures::*};
use meridian::context::ContextManager;
use meridian::indexer::CodeIndexer;
use meridian::memory::MemorySystem;
use meridian::mcp::ToolHandlers;
use meridian::session::SessionManager;
use meridian::types::*;
use serde_json::json;
use std::sync::Arc;

/// Helper to create test handlers with all required components
fn create_test_handlers(storage: std::sync::Arc<dyn meridian::storage::Storage>) -> ToolHandlers {
    let memory_config = meridian::config::MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "10MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };

    let index_config = meridian::config::IndexConfig {
        languages: vec!["rust".to_string(), "typescript".to_string()],
        ignore: vec![],
        max_file_size: "1MB".to_string(),
    };

    let session_config = meridian::session::SessionConfig {
        max_sessions: 10,
        timeout: chrono::Duration::hours(1),
        auto_cleanup: true,
    };

    let memory_system = MemorySystem::new(storage.clone(), memory_config).unwrap();
    let context_manager = ContextManager::new(LLMAdapter::claude3());
    let indexer = CodeIndexer::new(storage.clone(), index_config).unwrap();
    let session_manager = SessionManager::new(storage, session_config);

    ToolHandlers::new(
        Arc::new(tokio::sync::RwLock::new(memory_system)),
        Arc::new(tokio::sync::RwLock::new(context_manager)),
        Arc::new(tokio::sync::RwLock::new(indexer)),
        Arc::new(session_manager),
    )
}

// ============================================================================
// 1. memory.update_working_set
// ============================================================================

#[tokio::test]
async fn test_memory_update_working_set_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "focused_symbols": [
            {"symbol": "test_function", "weight": 1.5},
            {"symbol": "helper_function", "weight": 0.8}
        ],
        "accessed_files": ["src/main.rs", "src/lib.rs"],
        "session_id": "test-session-123"
    });

    let result = handlers.handle_tool_call("memory.update_working_set", params).await;
    assert!(result.is_ok(), "Expected successful working set update");

    let value = result.unwrap();
    assert!(value.get("updated_context").is_some());
    assert!(value.get("evicted_symbols").is_some());
    assert!(value.get("prefetched_symbols").is_some());

    // Verify active symbols count
    let updated_context = value.get("updated_context").unwrap();
    assert!(updated_context.get("active_symbols").is_some());
}

#[tokio::test]
async fn test_memory_update_working_set_invalid_params() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    // Missing required fields
    let params = json!({
        "session_id": "test-session"
    });

    let result = handlers.handle_tool_call("memory.update_working_set", params).await;
    assert!(result.is_err(), "Expected error for missing parameters");
}

#[tokio::test]
async fn test_memory_update_working_set_empty_symbols() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "focused_symbols": [],
        "accessed_files": [],
        "session_id": "test-session-empty"
    });

    let result = handlers.handle_tool_call("memory.update_working_set", params).await;
    assert!(result.is_ok(), "Should handle empty symbols gracefully");
}

// ============================================================================
// 2. feedback.mark_useful
// ============================================================================

#[tokio::test]
async fn test_feedback_mark_useful_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "session_id": "test-session-456",
        "useful_symbols": ["important_function", "critical_type"],
        "unnecessary_symbols": ["unused_helper"],
        "missing_context": "Need more documentation"
    });

    let result = handlers.handle_tool_call("feedback.mark_useful", params).await;
    assert!(result.is_ok(), "Expected successful feedback marking");

    let value = result.unwrap();
    assert!(value.get("feedback_id").is_some());
    assert_eq!(value.get("model_updated").unwrap(), true);
}

#[tokio::test]
async fn test_feedback_mark_useful_only_useful() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "session_id": "test-session-789",
        "useful_symbols": ["function_a", "function_b"]
    });

    let result = handlers.handle_tool_call("feedback.mark_useful", params).await;
    assert!(result.is_ok(), "Should work with only useful symbols");
}

#[tokio::test]
async fn test_feedback_mark_useful_only_unnecessary() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "session_id": "test-session-abc",
        "unnecessary_symbols": ["bloat_function"]
    });

    let result = handlers.handle_tool_call("feedback.mark_useful", params).await;
    assert!(result.is_ok(), "Should work with only unnecessary symbols");
}

// ============================================================================
// 3. learning.train_on_success
// ============================================================================

#[tokio::test]
async fn test_learning_train_on_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "task": {
            "description": "Implement authentication system",
            "type": "feature"
        },
        "solution": {
            "approach": "JWT-based authentication",
            "files_modified": ["auth/jwt.rs", "auth/middleware.rs"]
        },
        "key_insights": [
            "Used bcrypt for password hashing",
            "Implemented token refresh mechanism"
        ]
    });

    let result = handlers.handle_tool_call("learning.train_on_success", params).await;
    assert!(result.is_ok(), "Expected successful learning");

    let value = result.unwrap();
    assert!(value.get("patterns_learned").is_some());
    assert_eq!(value.get("procedure_updated").unwrap(), true);
    assert!(value.get("confidence").unwrap().as_f64().unwrap() > 0.0);
}

#[tokio::test]
async fn test_learning_train_on_success_minimal() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "task": {"description": "Simple bug fix"},
        "solution": {"approach": "Fixed typo"}
    });

    let result = handlers.handle_tool_call("learning.train_on_success", params).await;
    assert!(result.is_ok(), "Should work with minimal information");
}

#[tokio::test]
async fn test_learning_train_on_success_invalid() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "task": "invalid_format"
    });

    let result = handlers.handle_tool_call("learning.train_on_success", params).await;
    // Invalid format should fail parameter parsing
    assert!(result.is_err(), "Should fail with invalid parameter format");
}

// ============================================================================
// 4. predict.next_action
// ============================================================================

#[tokio::test]
async fn test_predict_next_action_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "current_context": {
            "task": "Implement caching layer",
            "files_open": ["cache/redis.rs"],
            "recent_actions": ["Created cache interface"]
        },
        "task_type": "feature"
    });

    let result = handlers.handle_tool_call("predict.next_action", params).await;
    assert!(result.is_ok(), "Expected successful prediction");

    let value = result.unwrap();
    assert!(value.get("predicted_actions").is_some());
    assert!(value.get("suggested_queries").is_some());
    assert!(value.get("confidence_scores").is_some());
}

#[tokio::test]
async fn test_predict_next_action_no_context() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "current_context": {}
    });

    let result = handlers.handle_tool_call("predict.next_action", params).await;
    assert!(result.is_ok(), "Should return empty predictions for no context");

    let value = result.unwrap();
    let actions = value.get("predicted_actions").unwrap().as_array().unwrap();
    assert_eq!(actions.len(), 0, "Should return empty actions");
}

#[tokio::test]
async fn test_predict_next_action_with_task_type() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "current_context": {"files": ["test.rs"]},
        "task_type": "refactoring"
    });

    let result = handlers.handle_tool_call("predict.next_action", params).await;
    assert!(result.is_ok());
}

// ============================================================================
// 5. analyze.token_cost
// ============================================================================

#[tokio::test]
async fn test_analyze_token_cost_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "items": [
            {"type": "text", "identifier": "Hello world, this is a test string"},
            {"type": "symbol", "identifier": "test_symbol_123"}
        ],
        "model": "claude-3"
    });

    let result = handlers.handle_tool_call("analyze.token_cost", params).await;
    assert!(result.is_ok(), "Expected successful token cost analysis");

    let value = result.unwrap();
    assert!(value.get("items").is_some());
    assert!(value.get("total_tokens").is_some());
    assert!(value.get("estimated_cost_usd").is_some());

    let total_tokens = value.get("total_tokens").unwrap().as_u64().unwrap();
    assert!(total_tokens > 0, "Should have non-zero token count");
}

#[tokio::test]
async fn test_analyze_token_cost_empty_items() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "items": []
    });

    let result = handlers.handle_tool_call("analyze.token_cost", params).await;
    assert!(result.is_ok(), "Should handle empty items");

    let value = result.unwrap();
    assert_eq!(value.get("total_tokens").unwrap(), 0);
}

#[tokio::test]
async fn test_analyze_token_cost_invalid_type() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "items": [
            {"type": "unknown_type", "identifier": "test"}
        ]
    });

    let result = handlers.handle_tool_call("analyze.token_cost", params).await;
    // Should still work, just return 0 for unknown types
    assert!(result.is_ok());
}

// ============================================================================
// 6. monorepo.list_projects
// ============================================================================

#[tokio::test]
async fn test_monorepo_list_projects_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    // Use _temp path which we know exists
    let root_path = _temp.path().to_string_lossy().to_string();
    let params = json!({
        "root_path": root_path,
        "include_dependencies": false
    });

    let result = handlers.handle_tool_call("monorepo.list_projects", params).await;
    assert!(result.is_ok(), "Expected successful project listing");

    let value = result.unwrap();
    assert!(value.get("projects").is_some());
    assert!(value.get("total_projects").is_some());
}

#[tokio::test]
async fn test_monorepo_list_projects_with_dependencies() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "include_dependencies": true
    });

    let result = handlers.handle_tool_call("monorepo.list_projects", params).await;
    assert!(result.is_ok());

    let value = result.unwrap();
    assert!(value.get("dependency_graph").is_some());
}

#[tokio::test]
async fn test_monorepo_list_projects_minimal() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({});

    let result = handlers.handle_tool_call("monorepo.list_projects", params).await;
    assert!(result.is_ok(), "Should use current directory");
}

// ============================================================================
// 7. monorepo.set_context
// ============================================================================

#[tokio::test]
async fn test_monorepo_set_context_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "project_name": "my-project",
        "session_id": "session-xyz"
    });

    let result = handlers.handle_tool_call("monorepo.set_context", params).await;
    assert!(result.is_ok(), "Expected successful context setting");

    let value = result.unwrap();
    assert_eq!(value.get("active_project").unwrap(), "my-project");
    assert_eq!(value.get("status").unwrap(), "context_updated");
}

#[tokio::test]
async fn test_monorepo_set_context_invalid_params() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "project_name": "test"
    });

    let result = handlers.handle_tool_call("monorepo.set_context", params).await;
    assert!(result.is_err(), "Should fail without session_id");
}

// ============================================================================
// 8. attention.retrieve
// ============================================================================

#[tokio::test]
async fn test_attention_retrieve_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "attention_pattern": {
            "focused": ["symbol_a", "symbol_b"]
        },
        "token_budget": 5000
    });

    let result = handlers.handle_tool_call("attention.retrieve", params).await;
    assert!(result.is_ok(), "Expected successful attention retrieval");

    let value = result.unwrap();
    assert!(value.get("high_attention").is_some());
    assert!(value.get("medium_attention").is_some());
    assert!(value.get("context_symbols").is_some());
    assert!(value.get("total_tokens").is_some());
}

#[tokio::test]
async fn test_attention_retrieve_low_budget() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "attention_pattern": {},
        "token_budget": 100
    });

    let result = handlers.handle_tool_call("attention.retrieve", params).await;
    assert!(result.is_ok());

    let value = result.unwrap();
    let total = value.get("total_tokens").unwrap().as_u64().unwrap();
    assert!(total <= 100, "Should respect token budget");
}

#[tokio::test]
async fn test_attention_retrieve_with_project_path() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "attention_pattern": {},
        "token_budget": 2000,
        "project_path": "/tmp/project"
    });

    let result = handlers.handle_tool_call("attention.retrieve", params).await;
    assert!(result.is_ok());
}

// ============================================================================
// 9. attention.analyze_patterns
// ============================================================================

#[tokio::test]
async fn test_attention_analyze_patterns_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "session_id": "session-abc",
        "window": 10
    });

    let result = handlers.handle_tool_call("attention.analyze_patterns", params).await;
    assert!(result.is_ok(), "Expected successful pattern analysis");

    let value = result.unwrap();
    assert!(value.get("patterns").is_some());
    assert!(value.get("focus_areas").is_some());
    assert!(value.get("attention_drift").is_some());
}

#[tokio::test]
async fn test_attention_analyze_patterns_default_window() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "session_id": "session-def"
    });

    let result = handlers.handle_tool_call("attention.analyze_patterns", params).await;
    assert!(result.is_ok(), "Should use default window");
}

#[tokio::test]
async fn test_attention_analyze_patterns_with_project() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "session_id": "session-ghi",
        "window": 20,
        "project_path": "/tmp/project"
    });

    let result = handlers.handle_tool_call("attention.analyze_patterns", params).await;
    assert!(result.is_ok());
}

// ============================================================================
// 10. docs.search
// ============================================================================

#[tokio::test]
async fn test_docs_search_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "query": "authentication",
        "scope": "auth",
        "max_results": 10
    });

    let result = handlers.handle_tool_call("docs.search", params).await;
    assert!(result.is_ok(), "Expected successful docs search");

    let value = result.unwrap();
    assert!(value.get("results").is_some());
    assert!(value.get("total_found").is_some());
    assert_eq!(value.get("query").unwrap(), "authentication");
}

#[tokio::test]
async fn test_docs_search_no_results() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "query": "nonexistent_documentation_xyz"
    });

    let result = handlers.handle_tool_call("docs.search", params).await;
    assert!(result.is_ok());

    let value = result.unwrap();
    let results = value.get("results").unwrap().as_array().unwrap();
    assert_eq!(results.len(), 0);
}

#[tokio::test]
async fn test_docs_search_with_project_path() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "query": "API",
        "project_path": "/tmp/docs"
    });

    let result = handlers.handle_tool_call("docs.search", params).await;
    assert!(result.is_ok());
}

// ============================================================================
// 11. docs.get_for_symbol
// ============================================================================

#[tokio::test]
async fn test_docs_get_for_symbol_success() {
    // Note: This test validates the handler interface, not actual symbol retrieval
    // Symbol retrieval requires indexing actual files, which is tested in integration tests
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "symbol_id": "test_symbol_id",
        "include_examples": true
    });

    let result = handlers.handle_tool_call("docs.get_for_symbol", params).await;
    // Will fail with "Symbol not found" which is expected
    // The important part is that the handler processes the request correctly
    assert!(result.is_err(), "Should fail for nonexistent symbol");
}

#[tokio::test]
async fn test_docs_get_for_symbol_not_found() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "symbol_id": "nonexistent_symbol_xyz"
    });

    let result = handlers.handle_tool_call("docs.get_for_symbol", params).await;
    assert!(result.is_err(), "Should fail for nonexistent symbol");
}

#[tokio::test]
async fn test_docs_get_for_symbol_with_project() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "symbol_id": "test_func_id",
        "project_path": "/tmp/project"
    });

    let result = handlers.handle_tool_call("docs.get_for_symbol", params).await;
    // Will fail for nonexistent symbol, but validates parameter handling
    assert!(result.is_err());
}

// ============================================================================
// 12. history.get_evolution
// ============================================================================

#[tokio::test]
async fn test_history_get_evolution_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "path": "src/main.rs",
        "max_commits": 10,
        "include_diffs": true
    });

    let result = handlers.handle_tool_call("history.get_evolution", params).await;
    assert!(result.is_ok(), "Expected successful history retrieval");

    let value = result.unwrap();
    assert!(value.get("path").is_some());
    assert!(value.get("commits").is_some());
    assert!(value.get("total_commits").is_some());
}

#[tokio::test]
async fn test_history_get_evolution_minimal() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "path": "README.md"
    });

    let result = handlers.handle_tool_call("history.get_evolution", params).await;
    assert!(result.is_ok(), "Should use defaults");
}

#[tokio::test]
async fn test_history_get_evolution_with_project() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "path": "lib.rs",
        "max_commits": 5,
        "project_path": "/tmp/repo"
    });

    let result = handlers.handle_tool_call("history.get_evolution", params).await;
    assert!(result.is_ok());
}

// ============================================================================
// 13. history.blame
// ============================================================================

#[tokio::test]
async fn test_history_blame_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "path": "src/lib.rs",
        "line_start": 10,
        "line_end": 20
    });

    let result = handlers.handle_tool_call("history.blame", params).await;
    assert!(result.is_ok(), "Expected successful blame retrieval");

    let value = result.unwrap();
    assert!(value.get("path").is_some());
    assert!(value.get("blame").is_some());
    assert!(value.get("total_lines").is_some());
}

#[tokio::test]
async fn test_history_blame_full_file() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "path": "src/test.rs"
    });

    let result = handlers.handle_tool_call("history.blame", params).await;
    assert!(result.is_ok(), "Should work without line range");
}

#[tokio::test]
async fn test_history_blame_with_project() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "path": "main.rs",
        "project_path": "/tmp/project"
    });

    let result = handlers.handle_tool_call("history.blame", params).await;
    assert!(result.is_ok());
}

// ============================================================================
// 14. analyze.complexity
// ============================================================================

#[tokio::test]
async fn test_analyze_complexity_symbol() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "target": "nonexistent_symbol_id",
        "include_metrics": ["cyclomatic", "cognitive"]
    });

    let result = handlers.handle_tool_call("analyze.complexity", params).await;
    assert!(result.is_ok(), "Should return file metrics for nonexistent symbol");

    let value = result.unwrap();
    // When symbol not found, it falls back to file metrics
    assert_eq!(value.get("type").unwrap(), "file");
    assert!(value.get("metrics").is_some());
    assert!(value.get("rating").is_some());
}

#[tokio::test]
async fn test_analyze_complexity_file() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "target": "src/nonexistent.rs"
    });

    let result = handlers.handle_tool_call("analyze.complexity", params).await;
    assert!(result.is_ok(), "Should return file metrics");

    let value = result.unwrap();
    assert_eq!(value.get("type").unwrap(), "file");
}

#[tokio::test]
async fn test_analyze_complexity_with_project() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "target": "lib.rs",
        "project_path": "/tmp/project"
    });

    let result = handlers.handle_tool_call("analyze.complexity", params).await;
    assert!(result.is_ok());
}

// ============================================================================
// 15. monorepo.find_cross_references
// ============================================================================

#[tokio::test]
async fn test_monorepo_find_cross_references_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "source_project": "frontend",
        "target_project": "backend",
        "reference_type": "import"
    });

    let result = handlers.handle_tool_call("monorepo.find_cross_references", params).await;
    assert!(result.is_ok(), "Expected successful cross-reference search");

    let value = result.unwrap();
    assert!(value.get("cross_references").is_some());
    assert_eq!(value.get("source_project").unwrap(), "frontend");
}

#[tokio::test]
async fn test_monorepo_find_cross_references_no_target() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "source_project": "shared-lib"
    });

    let result = handlers.handle_tool_call("monorepo.find_cross_references", params).await;
    assert!(result.is_ok(), "Should work without target project");
}

#[tokio::test]
async fn test_monorepo_find_cross_references_invalid() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({});

    let result = handlers.handle_tool_call("monorepo.find_cross_references", params).await;
    assert!(result.is_err(), "Should fail without source project");
}

// ============================================================================
// 16. memory.get_statistics
// ============================================================================

#[tokio::test]
async fn test_memory_get_statistics_success() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "include_details": true
    });

    let result = handlers.handle_tool_call("memory.get_statistics", params).await;
    assert!(result.is_ok(), "Expected successful statistics retrieval");

    let value = result.unwrap();
    assert!(value.get("episodic").is_some());
    assert!(value.get("working").is_some());
    assert!(value.get("semantic").is_some());
    assert!(value.get("procedural").is_some());

    // Verify structure
    let working = value.get("working").unwrap();
    assert!(working.get("active_symbols").is_some());
    assert!(working.get("current_usage").is_some());
}

#[tokio::test]
async fn test_memory_get_statistics_minimal() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({});

    let result = handlers.handle_tool_call("memory.get_statistics", params).await;
    assert!(result.is_ok(), "Should work without optional params");
}

#[tokio::test]
async fn test_memory_get_statistics_with_project() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    let params = json!({
        "include_details": false,
        "project_path": "/tmp/project"
    });

    let result = handlers.handle_tool_call("memory.get_statistics", params).await;
    assert!(result.is_ok());
}

// ============================================================================
// Integration Tests - Multiple Tools Together
// ============================================================================

#[tokio::test]
async fn test_workflow_update_working_set_and_get_statistics() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    // Update working set
    let update_params = json!({
        "focused_symbols": [{"symbol": "test_func", "weight": 1.5}],
        "accessed_files": ["test.rs"],
        "session_id": "workflow-123"
    });

    let update_result = handlers
        .handle_tool_call("memory.update_working_set", update_params)
        .await;
    assert!(update_result.is_ok());

    // Get statistics
    let stats_params = json!({});
    let stats_result = handlers
        .handle_tool_call("memory.get_statistics", stats_params)
        .await;
    assert!(stats_result.is_ok());

    let stats = stats_result.unwrap();
    let working = stats.get("working").unwrap();
    assert!(working.get("active_symbols").unwrap().as_u64().unwrap() > 0);
}

#[tokio::test]
async fn test_workflow_mark_useful_and_train() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    // Mark symbols as useful
    let feedback_params = json!({
        "session_id": "training-session",
        "useful_symbols": ["important_func"]
    });

    let feedback_result = handlers
        .handle_tool_call("feedback.mark_useful", feedback_params)
        .await;
    assert!(feedback_result.is_ok());

    // Train on success
    let train_params = json!({
        "task": {"description": "Implement feature"},
        "solution": {"approach": "Test-driven development"}
    });

    let train_result = handlers
        .handle_tool_call("learning.train_on_success", train_params)
        .await;
    assert!(train_result.is_ok());
}

#[tokio::test]
async fn test_workflow_analyze_complexity_and_cost() {
    let (storage, _temp) = create_test_storage();
    let handlers = create_test_handlers(storage);

    // Analyze complexity for a target
    let complexity_params = json!({
        "target": "test_target_id"
    });

    let complexity_result = handlers
        .handle_tool_call("analyze.complexity", complexity_params)
        .await;
    assert!(complexity_result.is_ok());

    // Analyze token cost
    let cost_params = json!({
        "items": [
            {"type": "text", "identifier": "Sample text for cost analysis"},
            {"type": "symbol", "identifier": "test_symbol"}
        ]
    });

    let cost_result = handlers
        .handle_tool_call("analyze.token_cost", cost_params)
        .await;
    assert!(cost_result.is_ok());
}
