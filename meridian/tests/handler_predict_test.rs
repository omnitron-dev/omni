//! Integration tests for the refactored predict_next_action handler
//!
//! Tests cover:
//! - Procedure-based prediction
//! - Episode-based prediction
//! - Fallback when no data
//! - Helper functions independently
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

/// Create test environment with all dependencies
async fn create_test_environment() -> ToolHandlers {
    let storage = Arc::new(MemoryStorage::new());

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
    let specs_path = std::env::temp_dir().join("meridian_test_specs_predict");
    std::fs::create_dir_all(&specs_path).unwrap();
    let spec_manager = Arc::new(RwLock::new(SpecificationManager::new(specs_path)));

    // Create progress manager
    let progress_storage = Arc::new(meridian::tasks::TaskStorage::new(storage.clone()));
    let progress_manager = Arc::new(RwLock::new(
        meridian::tasks::TaskManager::new(progress_storage)
    ));

    // Create links storage
    let links_storage: Arc<RwLock<dyn meridian::links::LinksStorage>> = Arc::new(RwLock::new(
        meridian::links::storage::RocksDBLinksStorage::new(storage.clone())
    ));

    // Create pattern search engine
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

// ========== PROCEDURE-BASED PREDICTION TESTS ==========

#[tokio::test]
async fn test_predict_with_procedure_basic() {
    let handlers = create_test_environment().await;

    // Train multiple similar tasks to build a procedure
    for i in 1..=3 {
        let args = json!({
            "task": {
                "description": format!("Add API endpoint {}", i),
                "queries_made": ["find routes", "search controller"],
                "files_accessed": ["routes.rs", "controller.rs"],
                "tokens_used": 1500
            },
            "solution": "Define route. Implement controller. Add tests",
            "key_insights": []
        });
        handlers.handle_tool_call("learning.train_on_success", args).await.unwrap();
    }

    // Predict for similar task
    let predict_args = json!({
        "current_context": {
            "task": "Add new API endpoint",
            "completed_steps": []
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(result.is_ok(), "Prediction should succeed: {:?}", result.err());

    let response = result.unwrap();
    assert!(response.get("has_procedure").unwrap().as_bool().unwrap());
    assert!(!response.get("predicted_actions").unwrap().as_array().unwrap().is_empty());
    assert!(!response.get("suggested_queries").unwrap().as_array().unwrap().is_empty());
    assert!(!response.get("confidence_scores").unwrap().as_array().unwrap().is_empty());
}

#[tokio::test]
async fn test_predict_with_completed_steps_filtering() {
    let handlers = create_test_environment().await;

    // Train procedure with specific steps
    for i in 1..=3 {
        let args = json!({
            "task": {
                "description": format!("Refactor module {}", i),
                "queries_made": [],
                "files_accessed": ["module.rs"],
                "tokens_used": 1200
            },
            "solution": "Analyze code. Extract functions. Update tests. Document changes",
            "key_insights": []
        });
        handlers.handle_tool_call("learning.train_on_success", args).await.unwrap();
    }

    // Predict with some steps completed
    let predict_args = json!({
        "current_context": {
            "task": "Refactor authentication module",
            "completed_steps": ["Analyze code", "Extract functions"]
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(result.is_ok());

    let response = result.unwrap();
    let actions = response.get("predicted_actions").unwrap().as_array().unwrap();

    // Verify completed steps are not included
    for action in actions {
        let desc = action.get("description").unwrap().as_str().unwrap().to_lowercase();
        assert!(!desc.contains("analyze code"), "Should not include completed step");
        assert!(!desc.contains("extract functions"), "Should not include completed step");
    }
}

#[tokio::test]
async fn test_predict_confidence_scores_match_actions() {
    let handlers = create_test_environment().await;

    // Train procedure
    for i in 1..=4 {
        let args = json!({
            "task": {
                "description": format!("Fix bug {}", i),
                "queries_made": [],
                "files_accessed": [],
                "tokens_used": 1000
            },
            "solution": "Reproduce bug. Write test. Fix code. Verify fix",
            "key_insights": []
        });
        handlers.handle_tool_call("learning.train_on_success", args).await.unwrap();
    }

    let predict_args = json!({
        "current_context": {
            "task": "Fix authentication bug"
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await.unwrap();
    
    let actions = result.get("predicted_actions").unwrap().as_array().unwrap();
    let confidences = result.get("confidence_scores").unwrap().as_array().unwrap();

    // Confidence scores should match number of actions
    assert_eq!(actions.len(), confidences.len());

    // All confidences should be valid (0.0 to 1.0)
    for confidence in confidences {
        let conf_val = confidence.as_f64().unwrap();
        assert!(conf_val >= 0.0 && conf_val <= 1.0);
    }
}

#[tokio::test]
async fn test_predict_with_optional_steps() {
    let handlers = create_test_environment().await;

    // Train tasks that might have optional steps
    for i in 1..=3 {
        let args = json!({
            "task": {
                "description": format!("Deploy service {}", i),
                "queries_made": [],
                "files_accessed": [],
                "tokens_used": 1000
            },
            "solution": "Build image. Run tests. Deploy to staging. Deploy to production",
            "key_insights": []
        });
        handlers.handle_tool_call("learning.train_on_success", args).await.unwrap();
    }

    let predict_args = json!({
        "current_context": {
            "task": "Deploy payment service"
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(result.is_ok());
    
    // Should have predicted actions with varying confidence
    let response = result.unwrap();
    assert!(!response.get("predicted_actions").unwrap().as_array().unwrap().is_empty());
}

// ========== EPISODE-BASED PREDICTION TESTS ==========

#[tokio::test]
async fn test_predict_from_episodes_fallback() {
    let handlers = create_test_environment().await;

    // Train a single unique task (not enough to build procedure)
    let args = json!({
        "task": {
            "description": "Optimize database query performance",
            "queries_made": ["search database", "find query"],
            "files_accessed": ["db.rs", "query.rs"],
            "tokens_used": 1800
        },
        "solution": "Analyze query. Add index. Test performance",
        "key_insights": []
    });
    handlers.handle_tool_call("learning.train_on_success", args).await.unwrap();

    // Predict for similar task (should use episode-based prediction)
    let predict_args = json!({
        "current_context": {
            "task": "Optimize slow database queries"
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(result.is_ok());

    let response = result.unwrap();
    // May or may not have procedure depending on similarity threshold
    assert!(response.get("predicted_actions").is_some());
    assert!(response.get("suggested_queries").is_some());
}

#[tokio::test]
async fn test_predict_from_multiple_similar_episodes() {
    let handlers = create_test_environment().await;

    // Train several varied episodes for the same task type
    let episodes = vec![
        ("Fix memory leak in cache", "Profile memory. Find leak. Fix allocation"),
        ("Fix memory leak in parser", "Profile memory. Identify issue. Update code"),
        ("Resolve memory leak", "Run profiler. Locate leak. Apply fix"),
    ];

    for (desc, solution) in episodes {
        let args = json!({
            "task": {
                "description": desc,
                "queries_made": ["memory", "profiler"],
                "files_accessed": ["memory.rs"],
                "tokens_used": 1500
            },
            "solution": solution,
            "key_insights": []
        });
        handlers.handle_tool_call("learning.train_on_success", args).await.unwrap();
    }

    let predict_args = json!({
        "current_context": {
            "task": "Fix memory leak in service"
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await.unwrap();
    
    let actions = result.get("predicted_actions").unwrap().as_array().unwrap();
    let queries = result.get("suggested_queries").unwrap().as_array().unwrap();

    // Should extract common patterns from episodes
    assert!(!actions.is_empty());
    assert!(!queries.is_empty());
    
    // Check for common actions
    let action_text = actions.iter()
        .filter_map(|a| a.get("description").and_then(|d| d.as_str()))
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    
    assert!(action_text.contains("profile") || action_text.contains("fix") || action_text.contains("leak"));
}

#[tokio::test]
async fn test_predict_frequency_based_ranking() {
    let handlers = create_test_environment().await;

    // Train episodes where some actions appear more frequently
    for i in 0..5 {
        let args = json!({
            "task": {
                "description": format!("Security task {}", i),
                "queries_made": ["security", "audit"],
                "files_accessed": ["auth.rs"],
                "tokens_used": 1000
            },
            "solution": "Review code. Run security scan. Fix vulnerabilities. Document changes",
            "key_insights": []
        });
        handlers.handle_tool_call("learning.train_on_success", args).await.unwrap();
    }

    let predict_args = json!({
        "current_context": {
            "task": "Security audit"
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await.unwrap();
    let actions = result.get("predicted_actions").unwrap().as_array().unwrap();

    // Actions should be sorted by frequency
    assert!(!actions.is_empty());

    // If using episode-based prediction, actions should have frequency field
    let has_procedure = result.get("has_procedure").unwrap().as_bool().unwrap();
    if !has_procedure {
        for action in actions {
            assert!(action.get("frequency").is_some());
        }
    }
}

// ========== FALLBACK AND EDGE CASES ==========

#[tokio::test]
async fn test_predict_with_no_training_data() {
    let handlers = create_test_environment().await;

    // Predict without any training
    let predict_args = json!({
        "current_context": {
            "task": "Completely new task type"
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(result.is_ok());

    let response = result.unwrap();
    assert_eq!(response.get("has_procedure").unwrap().as_bool().unwrap(), false);
    
    // Should return empty arrays gracefully
    let actions = response.get("predicted_actions").unwrap().as_array().unwrap();
    let queries = response.get("suggested_queries").unwrap().as_array().unwrap();
    let files = response.get("predicted_files").unwrap().as_array().unwrap();
    
    assert!(actions.is_empty());
    assert!(queries.is_empty());
    assert!(files.is_empty());
}

#[tokio::test]
async fn test_predict_with_empty_completed_steps() {
    let handlers = create_test_environment().await;

    // Train procedure
    for i in 1..=3 {
        let args = json!({
            "task": {
                "description": format!("Task {}", i),
                "queries_made": [],
                "files_accessed": [],
                "tokens_used": 1000
            },
            "solution": "Step one. Step two. Step three",
            "key_insights": []
        });
        handlers.handle_tool_call("learning.train_on_success", args).await.unwrap();
    }

    let predict_args = json!({
        "current_context": {
            "task": "Similar task",
            "completed_steps": []
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_predict_with_null_task_type() {
    let handlers = create_test_environment().await;

    let predict_args = json!({
        "current_context": {
            "task": "Test task"
        },
        "task_type": null
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_predict_missing_current_context_task() {
    let handlers = create_test_environment().await;

    let predict_args = json!({
        "current_context": {}
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(result.is_ok());
    
    // Should use default task description
}

#[tokio::test]
async fn test_predict_with_case_insensitive_step_matching() {
    let handlers = create_test_environment().await;

    // Train procedure
    for i in 1..=3 {
        let args = json!({
            "task": {
                "description": format!("Setup task {}", i),
                "queries_made": [],
                "files_accessed": [],
                "tokens_used": 1000
            },
            "solution": "Install Dependencies. Configure Settings. Run Tests",
            "key_insights": []
        });
        handlers.handle_tool_call("learning.train_on_success", args).await.unwrap();
    }

    let predict_args = json!({
        "current_context": {
            "task": "Setup new project",
            "completed_steps": ["install dependencies", "configure settings"]  // lowercase
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await.unwrap();
    let actions = result.get("predicted_actions").unwrap().as_array().unwrap();

    // Should filter out completed steps despite case difference (if we have procedure-based prediction)
    let has_procedure = result.get("has_procedure").unwrap().as_bool().unwrap();
    if has_procedure && !actions.is_empty() {
        for action in actions {
            let desc = action.get("description").unwrap().as_str().unwrap().to_lowercase();
            // Check that completed steps are not in the predicted actions
            assert!(
                !desc.contains("install dependencies") && !desc.contains("configure settings"),
                "Completed steps should be filtered out"
            );
        }
    }
}

// ========== JSON RESPONSE FORMAT TESTS ==========

#[tokio::test]
async fn test_predict_response_structure() {
    let handlers = create_test_environment().await;

    // Train minimal data
    let args = json!({
        "task": {
            "description": "Test task",
            "queries_made": ["test"],
            "files_accessed": ["test.rs"],
            "tokens_used": 1000
        },
        "solution": "Do something",
        "key_insights": []
    });
    handlers.handle_tool_call("learning.train_on_success", args).await.unwrap();

    let predict_args = json!({
        "current_context": {
            "task": "Test task"
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await.unwrap();

    // Verify all required fields are present
    assert!(result.get("predicted_actions").is_some());
    assert!(result.get("suggested_queries").is_some());
    assert!(result.get("confidence_scores").is_some());
    assert!(result.get("predicted_files").is_some());
    assert!(result.get("has_procedure").is_some());

    // Verify types
    assert!(result.get("predicted_actions").unwrap().is_array());
    assert!(result.get("suggested_queries").unwrap().is_array());
    assert!(result.get("confidence_scores").unwrap().is_array());
    assert!(result.get("predicted_files").unwrap().is_array());
    assert!(result.get("has_procedure").unwrap().is_boolean());
}

#[tokio::test]
async fn test_predict_action_structure() {
    let handlers = create_test_environment().await;

    // Train to get episodes
    let args = json!({
        "task": {
            "description": "Example task",
            "queries_made": [],
            "files_accessed": [],
            "tokens_used": 1000
        },
        "solution": "First action. Second action",
        "key_insights": []
    });
    handlers.handle_tool_call("learning.train_on_success", args).await.unwrap();

    let predict_args = json!({
        "current_context": {
            "task": "Example task"
        }
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await.unwrap();
    let actions = result.get("predicted_actions").unwrap().as_array().unwrap();

    if !actions.is_empty() {
        let action = &actions[0];
        assert!(action.get("description").is_some());
        // Episode-based actions should have these fields
        assert!(action.get("frequency").is_some() || action.get("typical_actions").is_some());
    }
}

// ========== INTEGRATION WITH MEMORY SYSTEM ==========

#[tokio::test]
async fn test_predict_integrates_with_memory_system() {
    let handlers = create_test_environment().await;

    // Use the full workflow: train -> predict
    let train_args = json!({
        "task": {
            "description": "Implement feature X",
            "queries_made": ["search feature"],
            "files_accessed": ["feature.rs"],
            "tokens_used": 2000
        },
        "solution": "Design API. Implement logic. Add tests",
        "key_insights": ["Use builder pattern"]
    });

    let train_result = handlers.handle_tool_call("learning.train_on_success", train_args).await;
    assert!(train_result.is_ok());

    // Predict should work with the trained data
    let predict_args = json!({
        "current_context": {
            "task": "Implement feature Y"
        }
    });

    let predict_result = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(predict_result.is_ok());
}

#[tokio::test]
async fn test_predict_with_task_type_parameter() {
    let handlers = create_test_environment().await;

    // Train data
    for i in 1..=3 {
        let args = json!({
            "task": {
                "description": format!("API development {}", i),
                "queries_made": [],
                "files_accessed": [],
                "tokens_used": 1000
            },
            "solution": "Define schema. Implement handler. Write docs",
            "key_insights": []
        });
        handlers.handle_tool_call("learning.train_on_success", args).await.unwrap();
    }

    // Use task_type instead of current_context.task
    let predict_args = json!({
        "current_context": {},
        "task_type": "API development"
    });

    let result = handlers.handle_tool_call("predict.next_action", predict_args).await;
    assert!(result.is_ok());
}
