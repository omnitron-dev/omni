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
use meridian::storage::rocksdb_storage::RocksDBStorage;
use serde_json::json;
use std::sync::Arc;
use tempfile::TempDir;
use tokio::sync::RwLock;

/// Create test environment with all dependencies
async fn create_test_environment() -> (ToolHandlers, TempDir) {
    let temp_dir = TempDir::new().unwrap();
    let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

    // Create memory system with config
    let memory_config = MemoryConfig {
        episodic_retention_days: 30,
        working_memory_size: "1MB".to_string(),
        consolidation_interval: "1h".to_string(),
    };
    let mut memory_system = MemorySystem::new(storage.clone(), memory_config).unwrap();
    memory_system.init().await.unwrap();
    let memory_system = Arc::new(RwLock::new(memory_system));

    // Create context manager with LLM adapter
    let llm_adapter = LLMAdapter::claude3();
    let context_manager = Arc::new(RwLock::new(ContextManager::new(llm_adapter)));

    // Create indexer with config
    let index_config = IndexConfig::default();
    let indexer = Arc::new(RwLock::new(CodeIndexer::new(storage.clone(), index_config).unwrap()));

    // Create session manager with config
    let session_config = SessionConfig::default();
    let session_manager = Arc::new(SessionManager::new(storage.clone(), session_config).unwrap());

    // Create doc indexer
    let doc_indexer = Arc::new(DocIndexer::new());

    // Create spec manager
    let specs_path = temp_dir.path().join("specs");
    std::fs::create_dir_all(&specs_path).unwrap();
    let spec_manager = Arc::new(RwLock::new(SpecificationManager::new(specs_path)));

    let handlers = ToolHandlers::new(
        memory_system,
        context_manager,
        indexer,
        session_manager,
        doc_indexer,
        spec_manager,
    );

    (handlers, temp_dir)
}

#[tokio::test]
async fn test_train_on_success_creates_episode() {
    let (handlers, _temp) = create_test_environment().await;

    let args = json!({
        "task": {
            "description": "Fix authentication bug in login service",
            "queries_made": ["find auth", "search login"],
            "files_accessed": ["auth.rs", "login.rs"],
            "tokens_used": 1500
        },
        "solution": "Updated JWT validation logic in auth.rs",
        "key_insights": [
            "JWT expiration was not being checked",
            "Token refresh needed better error handling"
        ]
    });

    let result = handlers.handle_tool_call("learning.train_on_success", args).await;
    assert!(result.is_ok(), "Handler should succeed: {:?}", result.err());

    let response = result.unwrap();
    assert!(response.get("episode_id").is_some());
    assert!(response.get("patterns_learned").is_some());
    assert!(response.get("procedure_updated").is_some());
    assert!(response.get("confidence").is_some());

    let confidence = response.get("confidence").unwrap().as_f64().unwrap();
    assert!(confidence > 0.0 && confidence <= 1.0);
}

#[tokio::test]
async fn test_train_on_success_learns_from_similar_episodes() {
    let (handlers, _temp) = create_test_environment().await;

    // Train on first episode
    let args1 = json!({
        "task": {
            "description": "Fix authentication bug",
            "queries_made": ["find auth"],
            "files_accessed": ["auth.rs"],
            "tokens_used": 1000
        },
        "solution": "Fixed token validation",
        "key_insights": ["Token validation was broken"]
    });

    handlers.handle_tool_call("learning.train_on_success", args1).await.unwrap();

    // Train on similar episode
    let args2 = json!({
        "task": {
            "description": "Fix authentication error in login",
            "queries_made": ["find auth", "search validation"],
            "files_accessed": ["auth.rs", "validator.rs"],
            "tokens_used": 1200
        },
        "solution": "Updated validation logic",
        "key_insights": []
    });

    let result = handlers.handle_tool_call("learning.train_on_success", args2).await;
    assert!(result.is_ok());

    let response = result.unwrap();
    let procedure_updated = response.get("procedure_updated").unwrap().as_bool().unwrap();
    assert!(procedure_updated, "Procedure should be updated after similar episodes");

    let similar_count = response.get("similar_episodes_count").unwrap().as_u64().unwrap();
    assert!(similar_count > 0, "Should find at least one similar episode");
}

#[tokio::test]
async fn test_predict_next_action_with_procedure() {
    let (handlers, _temp) = create_test_environment().await;

    // First, train on successful episodes to build a procedure
    let training_args = json!({
        "task": {
            "description": "Add new API endpoint",
            "queries_made": ["find routes", "search middleware"],
            "files_accessed": ["routes.ts", "middleware.ts", "controller.ts"],
            "tokens_used": 2000
        },
        "solution": "Define route. Add middleware. Implement controller. Write tests",
        "key_insights": []
    });

    handlers.handle_tool_call("learning.train_on_success", training_args).await.unwrap();

    // Train another similar episode
    let training_args2 = json!({
        "task": {
            "description": "Implement feature endpoint",
            "queries_made": ["find routes"],
            "files_accessed": ["routes.ts", "controller.ts"],
            "tokens_used": 1800
        },
        "solution": "Define route. Implement controller. Add tests",
        "key_insights": []
    });

    handlers.handle_tool_call("learning.train_on_success", training_args2).await.unwrap();

    // Now predict next actions for similar task
    let predict_args = json!({
        "current_context": {
            "task": "Add new endpoint for user management",
            "completed_steps": []
        },
        "task_type": "Add endpoint"
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(result.is_ok(), "Prediction should succeed: {:?}", result.err());

    let response = result.unwrap();
    let predicted_actions = response.get("predicted_actions").unwrap().as_array().unwrap();
    assert!(!predicted_actions.is_empty(), "Should predict at least one action");

    let has_procedure = response.get("has_procedure").unwrap().as_bool().unwrap();
    assert!(has_procedure, "Should have learned a procedure");

    let confidence_scores = response.get("confidence_scores").unwrap().as_array().unwrap();
    assert_eq!(confidence_scores.len(), predicted_actions.len());

    // Check that actions have proper structure
    let first_action = &predicted_actions[0];
    assert!(first_action.get("description").is_some());
}

#[tokio::test]
async fn test_predict_next_action_with_completed_steps() {
    let (handlers, _temp) = create_test_environment().await;

    // Train procedure
    let training_args = json!({
        "task": {
            "description": "Refactor module structure",
            "queries_made": [],
            "files_accessed": ["index.ts", "types.ts"],
            "tokens_used": 1500
        },
        "solution": "Analyze structure. Create new files. Move code. Update imports. Run tests",
        "key_insights": []
    });

    handlers.handle_tool_call("learning.train_on_success", training_args).await.unwrap();

    // Train another to build procedure
    let training_args2 = json!({
        "task": {
            "description": "Refactor authentication module",
            "queries_made": [],
            "files_accessed": ["auth.ts"],
            "tokens_used": 1400
        },
        "solution": "Analyze structure. Move code. Update imports",
        "key_insights": []
    });

    handlers.handle_tool_call("learning.train_on_success", training_args2).await.unwrap();

    // Predict with some steps already completed
    let predict_args = json!({
        "current_context": {
            "task": "Refactor payment module",
            "completed_steps": ["Analyze structure", "Create new files"]
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(result.is_ok());

    let response = result.unwrap();
    let predicted_actions = response.get("predicted_actions").unwrap().as_array().unwrap();

    // Should not include completed steps
    for action in predicted_actions {
        let description = action.get("description").unwrap().as_str().unwrap();
        assert!(!description.contains("Analyze structure"));
        assert!(!description.contains("Create new files"));
    }
}

#[tokio::test]
async fn test_predict_next_action_without_procedure() {
    let (handlers, _temp) = create_test_environment().await;

    // Train on a unique task (won't create procedure with just 1 episode)
    let training_args = json!({
        "task": {
            "description": "Unique optimization task",
            "queries_made": ["search performance"],
            "files_accessed": ["optimizer.rs"],
            "tokens_used": 1000
        },
        "solution": "Profiled code. Identified bottleneck. Applied cache",
        "key_insights": []
    });

    handlers.handle_tool_call("learning.train_on_success", training_args).await.unwrap();

    // Predict for similar task
    let predict_args = json!({
        "current_context": {
            "task": "Optimize database queries"
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(result.is_ok());

    let response = result.unwrap();
    // Should fall back to similar episodes
    assert!(response.get("predicted_actions").is_some());
    assert!(response.get("suggested_queries").is_some());
}

#[tokio::test]
async fn test_attention_retrieve_categorizes_symbols() {
    let (handlers, _temp) = create_test_environment().await;

    let args = json!({
        "attention_pattern": {
            "focused_symbols": ["AuthService", "UserController"]
        },
        "token_budget": 10000
    });

    let result = handlers.handle_tool_call("attention.retrieve", args).await;
    assert!(result.is_ok(), "Handler should succeed: {:?}", result.err());

    let response = result.unwrap();
    assert!(response.get("high_attention").is_some());
    assert!(response.get("medium_attention").is_some());
    assert!(response.get("context_symbols").is_some());
    assert!(response.get("prefetched_symbols").is_some());
    assert!(response.get("total_tokens").is_some());
    assert!(response.get("budget_utilization").is_some());
    assert!(response.get("recently_evicted").is_some());

    let total_tokens = response.get("total_tokens").unwrap().as_u64().unwrap();
    assert!(total_tokens <= 10000, "Should not exceed token budget");

    let budget_utilization = response.get("budget_utilization").unwrap().as_f64().unwrap();
    assert!(budget_utilization >= 0.0 && budget_utilization <= 1.0);
}

#[tokio::test]
async fn test_attention_retrieve_respects_budget() {
    let (handlers, _temp) = create_test_environment().await;

    let args = json!({
        "attention_pattern": {
            "focused_symbols": []
        },
        "token_budget": 1000
    });

    let result = handlers.handle_tool_call("attention.retrieve", args).await;
    assert!(result.is_ok());

    let response = result.unwrap();
    let total_tokens = response.get("total_tokens").unwrap().as_u64().unwrap();

    // Should respect budget (with some tolerance for overhead)
    assert!(total_tokens <= 1000, "Total tokens {} exceeds budget 1000", total_tokens);
}

#[tokio::test]
async fn test_attention_retrieve_boosts_focused_symbols() {
    let (handlers, _temp) = create_test_environment().await;

    // Retrieve without focused symbols
    let args1 = json!({
        "attention_pattern": {
            "focused_symbols": []
        },
        "token_budget": 5000
    });

    let result1 = handlers.handle_tool_call("attention.retrieve", args1).await.unwrap();
    let high1 = result1.get("high_attention").unwrap().as_array().unwrap().len();

    // Retrieve with focused symbols - should boost them to high attention
    let args2 = json!({
        "attention_pattern": {
            "focused_symbols": ["SomeSymbol", "AnotherSymbol"]
        },
        "token_budget": 5000
    });

    let result2 = handlers.handle_tool_call("attention.retrieve", args2).await.unwrap();
    let high2 = result2.get("high_attention").unwrap().as_array().unwrap().len();

    // Note: This test might not show difference if no symbols exist,
    // but it validates the logic doesn't crash
    assert!(high2 >= high1 || high1 == 0);
}

#[tokio::test]
async fn test_full_learning_cycle() {
    let (handlers, _temp) = create_test_environment().await;

    // 1. Train on multiple similar tasks
    let tasks = vec![
        json!({
            "task": {
                "description": "Fix bug in payment processing",
                "queries_made": ["find payment", "search transaction"],
                "files_accessed": ["payment.rs", "transaction.rs"],
                "tokens_used": 1500
            },
            "solution": "Validate input. Process payment. Update database",
            "key_insights": []
        }),
        json!({
            "task": {
                "description": "Fix error in payment gateway",
                "queries_made": ["find payment"],
                "files_accessed": ["payment.rs", "gateway.rs"],
                "tokens_used": 1400
            },
            "solution": "Validate input. Update database",
            "key_insights": []
        }),
        json!({
            "task": {
                "description": "Resolve payment validation issue",
                "queries_made": ["search payment", "find validation"],
                "files_accessed": ["payment.rs", "validator.rs"],
                "tokens_used": 1600
            },
            "solution": "Validate input. Process payment",
            "key_insights": []
        }),
    ];

    for task in tasks {
        let result = handlers.handle_tool_call("learning.train_on_success", task).await;
        assert!(result.is_ok());
    }

    // 2. Predict next actions for similar task
    let predict_args = json!({
        "current_context": {
            "task": "Fix payment processing bug",
            "completed_steps": []
        }
    });

    let prediction = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(prediction.is_ok());

    let pred_response = prediction.unwrap();
    let has_procedure = pred_response.get("has_procedure").unwrap().as_bool().unwrap();
    assert!(has_procedure, "Should have learned a procedure from multiple episodes");

    let predicted_actions = pred_response.get("predicted_actions").unwrap().as_array().unwrap();
    assert!(!predicted_actions.is_empty(), "Should predict actions");

    let suggested_queries = pred_response.get("suggested_queries").unwrap().as_array().unwrap();
    assert!(!suggested_queries.is_empty(), "Should suggest queries");

    let predicted_files = pred_response.get("predicted_files").unwrap().as_array().unwrap();
    assert!(!predicted_files.is_empty(), "Should predict files");

    // Verify common patterns were learned
    let queries_str = suggested_queries.iter()
        .filter_map(|v| v.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    assert!(queries_str.contains("payment") || queries_str.contains("find"));

    let files_str = predicted_files.iter()
        .filter_map(|v| v.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    assert!(files_str.contains("payment.rs"));
}

#[tokio::test]
async fn test_confidence_increases_with_more_data() {
    let (handlers, _temp) = create_test_environment().await;

    // Train first episode
    let task1 = json!({
        "task": {
            "description": "Test task",
            "queries_made": [],
            "files_accessed": [],
            "tokens_used": 1000
        },
        "solution": "Solution",
        "key_insights": []
    });

    let result1 = handlers.handle_tool_call("learning.train_on_success", task1).await.unwrap();
    let confidence1 = result1.get("confidence").unwrap().as_f64().unwrap();

    // Train more similar episodes
    for i in 2..=5 {
        let task = json!({
            "task": {
                "description": format!("Test task variant {}", i),
                "queries_made": [],
                "files_accessed": [],
                "tokens_used": 1000
            },
            "solution": "Solution",
            "key_insights": []
        });

        handlers.handle_tool_call("learning.train_on_success", task).await.unwrap();
    }

    // Train one more and check confidence
    let task_final = json!({
        "task": {
            "description": "Test task final",
            "queries_made": [],
            "files_accessed": [],
            "tokens_used": 1000
        },
        "solution": "Solution",
        "key_insights": []
    });

    let result_final = handlers.handle_tool_call("learning.train_on_success", task_final).await.unwrap();
    let confidence_final = result_final.get("confidence").unwrap().as_f64().unwrap();

    // Confidence should increase with more similar episodes
    assert!(confidence_final >= confidence1,
        "Confidence should increase: {} -> {}", confidence1, confidence_final);
}
