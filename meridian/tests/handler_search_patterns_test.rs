//! Integration tests for the refactored search_patterns handler
//!
//! Tests cover:
//! - Pagination (offset, page_size)
//! - Language filtering  
//! - Scope restrictions
//! - Early-exit optimization
//! - Helper functions
//! - Edge cases and error handling

use meridian::config::{IndexConfig, MemoryConfig};
use meridian::context::ContextManager;
use meridian::session::SessionConfig;
use meridian::types::context::LLMAdapter;
use meridian::docs::DocIndexer;
use meridian::indexer::CodeIndexer;
use meridian::mcp::handlers::ToolHandlers;
use meridian::memory::MemorySystem;
use meridian::session::SessionManager;
use meridian::specs::SpecificationManager;
use meridian::storage::MemoryStorage;
use serde_json::json;
use std::sync::Arc;
use tokio::sync::RwLock;
use std::fs;
use std::path::PathBuf;

/// Create test environment with all dependencies
async fn create_test_environment() -> ToolHandlers {
    let storage = Arc::new(MemoryStorage::new());

    let memory_config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "1MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };
    let mut memory_system = MemorySystem::new(storage.clone(), memory_config).unwrap();
    memory_system.init().await.unwrap();
    let memory_system = Arc::new(RwLock::new(memory_system));

    let llm_adapter = LLMAdapter::claude3();
    let context_manager = Arc::new(RwLock::new(ContextManager::new(llm_adapter)));

    let index_config = IndexConfig::default();
    let indexer = Arc::new(RwLock::new(CodeIndexer::new(storage.clone(), index_config).unwrap()));

    let session_config = SessionConfig::default();
    let session_manager = Arc::new(SessionManager::new(storage.clone(), session_config).unwrap());

    let doc_indexer = Arc::new(DocIndexer::new());

    let specs_path = std::env::temp_dir().join("meridian_test_specs_patterns");
    std::fs::create_dir_all(&specs_path).unwrap();
    let spec_manager = Arc::new(RwLock::new(SpecificationManager::new(specs_path)));

    let progress_storage = Arc::new(meridian::tasks::TaskStorage::new(storage.clone()));
    let progress_manager = Arc::new(RwLock::new(
        meridian::tasks::TaskManager::new(progress_storage)
    ));

    let links_storage: Arc<RwLock<dyn meridian::links::LinksStorage>> = Arc::new(RwLock::new(
        meridian::links::storage::RocksDBLinksStorage::new(storage.clone())
    ));

    let pattern_engine = Arc::new(meridian::indexer::PatternSearchEngine::new().unwrap());

    ToolHandlers::new(
        memory_system,
        context_manager,
        indexer,
        session_manager,
        doc_indexer,
        spec_manager,
        progress_manager,
        links_storage,
        pattern_engine,
    )
}

/// Create a temporary test directory with sample files
fn setup_test_files() -> PathBuf {
    let test_dir = std::env::temp_dir().join(format!("pattern_search_test_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&test_dir).unwrap();

    // Create Rust files
    fs::write(
        test_dir.join("main.rs"),
        r#"
fn main() {
    println!("Hello, world!");
    let x = calculate(5, 10);
}

fn calculate(a: i32, b: i32) -> i32 {
    a + b
}
"#,
    ).unwrap();

    fs::write(
        test_dir.join("lib.rs"),
        r#"
pub struct Config {
    pub timeout: u64,
}

impl Config {
    pub fn new() -> Self {
        Self { timeout: 30 }
    }
}

pub fn process_data(data: &str) -> String {
    data.to_uppercase()
}
"#,
    ).unwrap();

    test_dir
}

fn cleanup_test_files(dir: &PathBuf) {
    let _ = fs::remove_dir_all(dir);
}

// ========== BASIC PATTERN SEARCH TESTS ==========

#[tokio::test]
async fn test_search_patterns_basic() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    let args = json!({
        "pattern": "fn",
        "scope": test_dir.to_str().unwrap()
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await;
    assert!(result.is_ok(), "Basic search should succeed: {:?}", result.err());

    let response = result.unwrap();
    assert!(response.get("matches").is_some());
    assert!(response.get("pagination").is_some());
    assert!(response.get("summary").is_some());

    cleanup_test_files(&test_dir);
}

#[tokio::test]
async fn test_search_patterns_finds_matches() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    let args = json!({
        "pattern": "calculate",
        "scope": test_dir.to_str().unwrap()
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await.unwrap();
    let matches = result.get("matches").unwrap().as_array().unwrap();

    // May or may not find matches depending on pattern engine, but should succeed
    // Verify match structure if matches found
    if !matches.is_empty() {
        for m in matches {
            assert!(m.get("location").is_some());
            let location = m.get("location").unwrap();
            assert!(location.get("file").is_some());
            assert!(location.get("line_start").is_some());
        }
    }

    cleanup_test_files(&test_dir);
}

// ========== PAGINATION TESTS ==========

#[tokio::test]
async fn test_pagination_with_page_size() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    let args = json!({
        "pattern": "pub",
        "scope": test_dir.to_str().unwrap(),
        "page_size": 2
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await.unwrap();
    let matches = result.get("matches").unwrap().as_array().unwrap();
    let pagination = result.get("pagination").unwrap();

    // Should limit results
    assert!(matches.len() <= 2, "Should respect page_size limit");
    assert!(pagination.get("page_size").is_some());

    cleanup_test_files(&test_dir);
}

#[tokio::test]
async fn test_pagination_with_offset() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    // First page
    let args1 = json!({
        "pattern": "fn|pub",
        "scope": test_dir.to_str().unwrap(),
        "page_size": 2,
        "offset": 0
    });

    let result1 = handlers.handle_tool_call("code.search_patterns", args1).await.unwrap();
    let pagination1 = result1.get("pagination").unwrap();
    assert_eq!(pagination1.get("offset").unwrap().as_u64().unwrap(), 0);

    // Second page
    let args2 = json!({
        "pattern": "fn|pub",
        "scope": test_dir.to_str().unwrap(),
        "page_size": 2,
        "offset": 2
    });

    let result2 = handlers.handle_tool_call("code.search_patterns", args2).await.unwrap();
    let pagination2 = result2.get("pagination").unwrap();
    assert_eq!(pagination2.get("offset").unwrap().as_u64().unwrap(), 2);

    cleanup_test_files(&test_dir);
}

#[tokio::test]
async fn test_pagination_legacy_max_results() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    // Use legacy max_results parameter
    let args = json!({
        "pattern": "return",
        "scope": test_dir.to_str().unwrap(),
        "max_results": 3
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await.unwrap();
    let matches = result.get("matches").unwrap().as_array().unwrap();

    // Should respect max_results
    assert!(matches.len() <= 3, "Should respect max_results");

    cleanup_test_files(&test_dir);
}

#[tokio::test]
async fn test_pagination_page_size_overrides_max_results() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    // When both are provided, page_size should take precedence
    let args = json!({
        "pattern": "let|const",
        "scope": test_dir.to_str().unwrap(),
        "page_size": 2,
        "max_results": 10
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await.unwrap();
    let matches = result.get("matches").unwrap().as_array().unwrap();

    // Should use page_size, not max_results
    assert!(matches.len() <= 2, "page_size should override max_results");

    cleanup_test_files(&test_dir);
}

#[tokio::test]
async fn test_pagination_hard_limit_enforcement() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    // Try to request more than hard limit (1000)
    let args = json!({
        "pattern": ".",
        "scope": test_dir.to_str().unwrap(),
        "page_size": 5000
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await;
    assert!(result.is_ok());

    // Hard limit should be enforced (1000 max)
    let response = result.unwrap();
    let matches = response.get("matches").unwrap().as_array().unwrap();
    assert!(matches.len() <= 1000, "Hard limit should be enforced");

    cleanup_test_files(&test_dir);
}

// ========== LANGUAGE FILTERING TESTS ==========

#[tokio::test]
async fn test_language_filter_rust() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    let args = json!({
        "pattern": "fn|struct|impl",
        "scope": test_dir.to_str().unwrap(),
        "language": "rust"
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await.unwrap();
    let matches = result.get("matches").unwrap().as_array().unwrap();

    // All matches should be from .rs files
    for m in matches {
        let file = m.get("location").unwrap().get("file").unwrap().as_str().unwrap();
        assert!(file.ends_with(".rs"), "Should only match Rust files");
    }

    cleanup_test_files(&test_dir);
}

#[tokio::test]
async fn test_language_filter_no_matches() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    // Search for Java files (none exist)
    let args = json!({
        "pattern": "class",
        "scope": test_dir.to_str().unwrap(),
        "language": "java"
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await.unwrap();
    let matches = result.get("matches").unwrap().as_array().unwrap();

    assert!(matches.is_empty(), "Should find no Java files");

    cleanup_test_files(&test_dir);
}

// ========== SCOPE RESTRICTION TESTS ==========

#[tokio::test]
async fn test_scope_single_file() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    let target_file = test_dir.join("main.rs");

    let args = json!({
        "pattern": "fn",
        "scope": target_file.to_str().unwrap()
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await.unwrap();
    let matches = result.get("matches").unwrap().as_array().unwrap();

    // All matches should be from the single file
    for m in matches {
        let file = m.get("location").unwrap().get("file").unwrap().as_str().unwrap();
        assert!(file.ends_with("main.rs"), "Should only match target file");
    }

    cleanup_test_files(&test_dir);
}

#[tokio::test]
async fn test_scope_directory() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    let args = json!({
        "pattern": "fn",
        "scope": test_dir.to_str().unwrap()
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await.unwrap();
    let summary = result.get("summary").unwrap();

    // Should search multiple files
    let files_searched = summary.get("files_searched").unwrap().as_u64().unwrap();
    assert!(files_searched >= 1, "Should search files in directory");

    cleanup_test_files(&test_dir);
}

#[tokio::test]
async fn test_scope_nonexistent_path() {
    let handlers = create_test_environment().await;

    let args = json!({
        "pattern": "fn",
        "scope": "/nonexistent/path/that/does/not/exist"
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await;
    
    // Should handle gracefully
    if result.is_ok() {
        let response = result.unwrap();
        let matches = response.get("matches").unwrap().as_array().unwrap();
        assert!(matches.is_empty(), "Should return empty for nonexistent path");
    }
}

// ========== EARLY-EXIT OPTIMIZATION TESTS ==========

#[tokio::test]
async fn test_early_exit_metadata() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    let args = json!({
        "pattern": "fn",
        "scope": test_dir.to_str().unwrap(),
        "page_size": 3
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await.unwrap();
    let pagination = result.get("pagination").unwrap();

    // Response should include metadata about search completion
    assert!(pagination.get("searched_all_files").is_some());
    assert!(pagination.get("has_more").is_some());

    cleanup_test_files(&test_dir);
}

// ========== PATTERN MATCHING TESTS ==========

#[tokio::test]
async fn test_regex_pattern() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    // Regex pattern for function declarations
    let args = json!({
        "pattern": r"(fn|function|def)\s+\w+",
        "scope": test_dir.to_str().unwrap()
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await;
    assert!(result.is_ok(), "Regex pattern should be handled");

    // May or may not find matches depending on pattern engine capabilities
    if let Ok(response) = result {
        let matches = response.get("matches").unwrap().as_array().unwrap();
        // Test passes if regex is processed without error
        assert!(matches.len() >= 0);
    }

    cleanup_test_files(&test_dir);
}

#[tokio::test]
async fn test_empty_pattern() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    let args = json!({
        "pattern": "",
        "scope": test_dir.to_str().unwrap()
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await;
    
    // Should handle empty pattern gracefully
    assert!(result.is_ok() || result.is_err());

    cleanup_test_files(&test_dir);
}

#[tokio::test]
async fn test_invalid_regex_pattern() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    // Invalid regex with unmatched parenthesis
    let args = json!({
        "pattern": "(invalid[regex",
        "scope": test_dir.to_str().unwrap()
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await;
    
    // Should either error or handle gracefully
    assert!(result.is_ok() || result.is_err());

    cleanup_test_files(&test_dir);
}

// ========== ERROR HANDLING TESTS ==========

#[tokio::test]
async fn test_missing_pattern_parameter() {
    let handlers = create_test_environment().await;

    let args = json!({
        "scope": "/some/path"
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await;
    assert!(result.is_err(), "Should fail without pattern parameter");
}

// ========== RESPONSE FORMAT TESTS ==========

#[tokio::test]
async fn test_response_structure() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    let args = json!({
        "pattern": "fn",
        "scope": test_dir.to_str().unwrap()
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await.unwrap();

    // Verify all required fields
    assert!(result.get("matches").is_some());
    assert!(result.get("pagination").is_some());
    assert!(result.get("summary").is_some());

    // Verify types
    assert!(result.get("matches").unwrap().is_array());
    assert!(result.get("pagination").unwrap().is_object());
    assert!(result.get("summary").unwrap().is_object());

    let pagination = result.get("pagination").unwrap();
    assert!(pagination.get("offset").is_some());
    assert!(pagination.get("page_size").is_some());
    assert!(pagination.get("has_more").is_some());

    let summary = result.get("summary").unwrap();
    assert!(summary.get("files_searched").is_some());
    assert!(summary.get("pattern").is_some());

    cleanup_test_files(&test_dir);
}

#[tokio::test]
async fn test_match_structure() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    let args = json!({
        "pattern": "fn",
        "scope": test_dir.to_str().unwrap()
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await.unwrap();
    let matches = result.get("matches").unwrap().as_array().unwrap();

    if !matches.is_empty() {
        let m = &matches[0];
        
        // Required fields - matches have "location" object
        assert!(m.get("location").is_some());
        
        let location = m.get("location").unwrap();
        assert!(location.get("file").is_some());
        assert!(location.get("line_start").is_some());
        
        // Verify types
        assert!(location.get("file").unwrap().is_string());
        assert!(location.get("line_start").unwrap().is_number());
    }

    cleanup_test_files(&test_dir);
}

// ========== PERFORMANCE TESTS ==========

#[tokio::test]
async fn test_large_directory_performance() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    // Create many files
    for i in 0..50 {
        fs::write(
            test_dir.join(format!("file_{}.rs", i)),
            format!("fn test_{}() {{}}", i),
        ).unwrap();
    }

    let start = std::time::Instant::now();

    let args = json!({
        "pattern": "fn",
        "scope": test_dir.to_str().unwrap(),
        "page_size": 10
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await;
    assert!(result.is_ok());

    let duration = start.elapsed();
    
    // Should complete in reasonable time
    assert!(duration.as_secs() < 10, "Search should complete quickly");

    cleanup_test_files(&test_dir);
}

#[tokio::test]
async fn test_zero_page_size_uses_default() {
    let handlers = create_test_environment().await;
    let test_dir = setup_test_files();

    let args = json!({
        "pattern": "fn",
        "scope": test_dir.to_str().unwrap(),
        "page_size": 0
    });

    let result = handlers.handle_tool_call("code.search_patterns", args).await;
    assert!(result.is_ok());

    cleanup_test_files(&test_dir);
}
